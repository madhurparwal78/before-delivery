import { randomUUID } from 'node:crypto';
import { hashPassword } from '../auth.ts';
import { config } from '../config.ts';
import { query, withTransaction } from '../db/pool.ts';
import { appendAudit } from '../domain/audit.ts';
import { ApiError, notFound, storageUnavailable, validation } from '../http/errors.ts';
import { isEmail, isTimeZone, readObjectArray, readString } from '../http/read.ts';
import { sendBytes, sendJson, type HttpApp } from '../http/server.ts';
import { isBoxValid, round4 } from '../../shared/geometry.ts';
import { defaultLabel } from '../../shared/fields.ts';
import type { DocumentStatus, FieldKind, Role } from '../../shared/types.ts';
import { isSampleName, sample } from '../pdf/samples.ts';
import { originalKey, putObject } from '../services/storage.ts';
import { loadAggregate } from '../model/document.ts';
import { attemptSeal, beginTurn, dateInZone, recordVoid } from '../model/flow.ts';
import { deliverAllOrHold } from '../model/mailer.ts';

import { initialsOf } from '../../shared/fields.ts';

const isRole = (value: string | null): value is Role =>
  value === 'owner' || value === 'member' || value === 'viewer';

const isKind = (value: string | null): value is FieldKind =>
  value === 'signature' || value === 'initials' || value === 'date' || value === 'text';

const isSeedState = (value: string | null): value is DocumentStatus =>
  value === 'draft' ||
  value === 'in_progress' ||
  value === 'completed' ||
  value === 'declined' ||
  value === 'voided';

interface SeedMember {
  email: string;
  name: string;
  password: string;
  role: Role;
}

interface SeedTeam {
  name: string;
  members: SeedMember[];
}

interface SeedField {
  recipient: number;
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
}

interface SeedDocument {
  title: string;
  team: string;
  owner: string;
  sampleName: 'letter-1' | 'letter-3' | 'a4-12';
  timeZone: string;
  recipients: Array<{ name: string; email: string }>;
  fields: SeedField[];
  state: DocumentStatus;
  signed: number;
}

const invalidSetup = (): ApiError => validation({ setup: 'Check the grading setup payload.' });

const text = (source: Record<string, unknown>, key: string): string => {
  const value = readString(source, key);
  if (value === null || value.trim() === '') throw invalidSetup();
  return value;
};

const lowerEmail = (source: Record<string, unknown>, key: string): string => {
  const value = (readString(source, key) ?? '').trim().toLowerCase();
  if (!isEmail(value)) throw invalidSetup();
  return value;
};

const wholeNumber = (source: Record<string, unknown>, key: string, fallback: number): number => {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw invalidSetup();
  return value;
};

const fraction = (source: Record<string, unknown>, key: string): number => {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidSetup();
  return round4(value);
};

const parseTeams = (raw: Array<Record<string, unknown>>): SeedTeam[] =>
  raw.map((team) => {
    const members = readObjectArray(team, 'members');
    if (members === null || members.length === 0) throw invalidSetup();
    return {
      name: text(team, 'name'),
      members: members.map((member) => {
        const role = readString(member, 'role');
        if (!isRole(role)) throw invalidSetup();
        return {
          email: lowerEmail(member, 'email'),
          name: text(member, 'name'),
          password: text(member, 'password'),
          role,
        };
      }),
    };
  });

const parseDocuments = (raw: Array<Record<string, unknown>>): SeedDocument[] =>
  raw.map((document) => {
    const sampleName = readString(document, 'sample');
    if (sampleName === null || !isSampleName(sampleName)) throw invalidSetup();
    const state = readString(document, 'state') ?? 'draft';
    if (!isSeedState(state)) throw invalidSetup();
    const timeZone = readString(document, 'timeZone') ?? 'UTC';
    if (!isTimeZone(timeZone)) throw invalidSetup();
    const recipients = readObjectArray(document, 'recipients') ?? [];
    const fields = readObjectArray(document, 'fields') ?? [];
    return {
      title: text(document, 'title'),
      team: text(document, 'team'),
      owner: lowerEmail(document, 'owner'),
      sampleName,
      timeZone,
      recipients: recipients.map((recipient) => ({
        name: text(recipient, 'name'),
        email: lowerEmail(recipient, 'email'),
      })),
      fields: fields.map((field) => {
        const kind = readString(field, 'kind');
        if (!isKind(kind)) throw invalidSetup();
        const box = {
          x: fraction(field, 'x'),
          y: fraction(field, 'y'),
          w: fraction(field, 'w'),
          h: fraction(field, 'h'),
        };
        const page = wholeNumber(field, 'page', 0);
        if (page < 1 || !isBoxValid(box)) throw invalidSetup();
        return {
          recipient: wholeNumber(field, 'recipient', 1),
          kind,
          page,
          ...box,
          required: field['required'] !== false,
        };
      }),
      state,
      signed: wholeNumber(document, 'signed', 0),
    };
  });

export const registerGradingRoutes = (app: HttpApp): void => {
  const guard = (ctx: { req: { headers: Record<string, unknown> } }): void => {
    const key = ctx.req.headers['x-grading-key'];
    if (config.gradingKey === null || typeof key !== 'string' || key !== config.gradingKey) {
      throw notFound();
    }
  };

  app.on('GET', '/api/grading/samples/:name', async (ctx) => {
    guard(ctx);
    const name = ctx.params['name'] ?? '';
    if (!isSampleName(name)) throw notFound();
    sendBytes(ctx.res, 200, 'application/pdf', sample(name).bytes);
  });

  app.on('POST', '/api/grading/setup', async (ctx) => {
    guard(ctx);
    const body = await ctx.body();
    const teams = parseTeams(readObjectArray(body, 'teams') ?? []);
    const documents = parseDocuments(readObjectArray(body, 'documents') ?? []);

    const emails = teams.flatMap((team) => team.members.map((member) => member.email));
    if (new Set(emails).size !== emails.length) throw new ApiError(409, { error: 'email_taken' });
    const taken = await query<{ email: string }>(
      'SELECT email FROM users WHERE email = ANY($1::text[])',
      [emails],
    );
    if (taken.length > 0) throw new ApiError(409, { error: 'email_taken' });

    const teamIds = new Map<string, string>();
    const userIds = new Map<string, string>();
    await withTransaction(async (client) => {
      for (const team of teams) {
        const teamId = randomUUID();
        teamIds.set(team.name, teamId);
        await client.query('INSERT INTO teams (id, name) VALUES ($1, $2)', [teamId, team.name]);
        for (const member of team.members) {
          const userId = randomUUID();
          userIds.set(member.email, userId);
          await client.query(
            'INSERT INTO users (id, team_id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)',
            [userId, teamId, member.email, member.name, hashPassword(member.password), member.role],
          );
        }
      }
    });

    const created: Array<{ title: string; id: string }> = [];
    for (const seed of documents) {
      const teamId = teamIds.get(seed.team);
      const ownerId = userIds.get(seed.owner);
      if (teamId === undefined || ownerId === undefined) throw validation({ documents: 'Unknown team or owner.' });
      const id = await seedDocument(seed, teamId, ownerId);
      created.push({ title: seed.title, id });
    }

    sendJson(ctx.res, 201, {
      teams: teams.map((team) => ({ name: team.name, id: teamIds.get(team.name) ?? '' })),
      users: [...userIds].map(([email, id]) => ({ email, id })),
      documents: created,
    });
  });
};

const seedDocument = async (
  seed: SeedDocument,
  teamId: string,
  ownerId: string,
): Promise<string> => {
  const documentId = randomUUID();
  const built = sample(seed.sampleName);
  try {
    await putObject(originalKey(documentId), built.bytes);
  } catch {
    throw storageUnavailable();
  }

  const now = new Date();
  const outcome = await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO documents (id, team_id, owner_id, title, status, time_zone, page_count, original_sha256)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7)`,
      [documentId, teamId, ownerId, seed.title, seed.timeZone, built.pageCount, built.sha256],
    );
    const owner = await client.query<{ email: string; name: string }>(
      'SELECT email, name FROM users WHERE id = $1',
      [ownerId],
    );
    const ownerEmail = owner.rows[0]?.email ?? 'system';
    await appendAudit(client, { documentId, type: 'document.created', actor: ownerEmail });

    const recipientIds: string[] = [];
    for (const [index, recipient] of seed.recipients.entries()) {
      const recipientId = randomUUID();
      recipientIds.push(recipientId);
      await client.query(
        `INSERT INTO recipients (id, document_id, name, email, order_index, status)
         VALUES ($1, $2, $3, $4, $5, 'waiting')`,
        [recipientId, documentId, recipient.name, recipient.email, index + 1],
      );
    }
    const kindCounts = new Map<FieldKind, number>();
    for (const field of seed.fields) {
      const count = (kindCounts.get(field.kind) ?? 0) + 1;
      kindCounts.set(field.kind, count);
      const recipientId = recipientIds[field.recipient - 1];
      if (recipientId === undefined) continue;
      await client.query(
        `INSERT INTO fields (id, document_id, recipient_id, kind, label, required, page, x, y, w, h)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          randomUUID(),
          documentId,
          recipientId,
          field.kind,
          defaultLabel(field.kind, count),
          field.required,
          field.page,
          field.x,
          field.y,
          field.w,
          field.h,
        ],
      );
    }
    if (seed.state === 'draft') return { kind: 'draft' as const };

    const aggregate = await loadAggregate(documentId, teamId, client);
    if (!aggregate) throw notFound();
    await client.query("UPDATE documents SET status = 'in_progress' WHERE id = $1", [documentId]);
    await appendAudit(client, { documentId, type: 'document.sent', actor: ownerEmail });

    const signedCount =
      seed.state === 'completed' ? aggregate.recipients.length : Math.max(0, seed.signed);
    const dateValue = dateInZone(now, seed.timeZone);
    for (let index = 0; index < signedCount && index < aggregate.recipients.length; index += 1) {
      const recipient = aggregate.recipients[index];
      if (!recipient) continue;
      await client.query(
        `UPDATE fields SET value = CASE
            WHEN kind = 'signature' THEN 'typed:' || $3
            WHEN kind = 'initials' THEN 'typed:' || $4
            WHEN kind = 'date' THEN $5
            ELSE $3 END
          WHERE document_id = $1 AND recipient_id = $2`,
        [documentId, recipient.id, recipient.name, initialsOf(recipient.name), dateValue],
      );
      await client.query("UPDATE recipients SET status = 'signed', signed_at = $2 WHERE id = $1", [
        recipient.id,
        now,
      ]);
      await appendAudit(client, {
        documentId,
        type: 'recipient.signed',
        actor: recipient.email,
        recipientId: recipient.id,
      });
    }

    const fresh = await loadAggregate(documentId, teamId, client);
    if (!fresh) throw notFound();
    const next = fresh.recipients.find((row) => row.stored_status !== 'signed');

    if (seed.state === 'completed') {
      await client.query("UPDATE documents SET status = 'sealing' WHERE id = $1", [documentId]);
      return { kind: 'seal' as const };
    }
    if (seed.state === 'declined') {
      if (!next) throw validation({ documents: 'A declined document needs a signer left.' });
      await client.query(
        "UPDATE recipients SET status = 'declined', decline_reason = 'Seeded decline' WHERE id = $1",
        [next.id],
      );
      await client.query(
        `UPDATE documents SET status = 'declined', declined_by = $2, decline_reason = 'Seeded decline'
         WHERE id = $1`,
        [documentId, next.id],
      );
      await client.query('UPDATE recipients SET binding = false WHERE document_id = $1', [
        documentId,
      ]);
      await appendAudit(client, {
        documentId,
        type: 'recipient.declined',
        actor: next.email,
        recipientId: next.id,
      });
      return { kind: 'closed' as const };
    }
    if (seed.state === 'voided') {
      await recordVoid(client, fresh, ownerEmail, ownerId, 'Seeded void');
      return { kind: 'closed' as const };
    }
    if (!next) throw validation({ documents: 'An in-progress document needs a signer left.' });
    const invitation = await beginTurn(client, fresh, next, now);
    return { kind: 'invite' as const, invitation };
  });

  if (outcome.kind === 'seal') {
    await attemptSeal(documentId);
  }
  if (outcome.kind === 'invite') {
    await deliverAllOrHold([outcome.invitation]);
  }
  return documentId;
};
