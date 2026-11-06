import { config } from '../config.js';
import { now } from '../clock.js';
import { query, queryOne, withClient, withTransaction, type Db } from '../db.js';
import { json, route, type Ctx } from '../http.js';
import { ApiError, ValidationError, conflict, fieldMessages, notFound } from '../errors.js';
import { newId, newToken, sha256, isEmail } from '../util.js';
import { callerActor } from '../auth.js';
import { writeAudit } from '../audit.js';
import { recordVetMiss } from '../ratelimit.js';
import { queueRequestEmail } from '../services/mail.js';
import { vetLinkEmail } from '../services/emails.js';
import { practice } from '../domain/practice.js';
import { formatInstant, wallTimeAt } from '../domain/time.js';
import { HOOVES } from '../domain/marks.js';
import { buildComparison } from './comparison.js';
import { visibleHorse } from './shared.js';

/**
 * Vet links. A link always shows its horse's two most recent visits that are not open,
 * judged at each read, and its photo paths work only for that live pair.
 */
interface VetLinkRow {
  id: string;
  horse_id: string;
  horse_name: string;
  vet_name: string;
  vet_email: string;
  expires_at: Date;
  revoked_at: Date | null;
}

const VET_LINK_COLUMNS = `l.id, l.horse_id, h.name AS horse_name, l.vet_name, l.vet_email,
  l.expires_at, l.revoked_at`;

export interface LivePair {
  previousVisitId: string;
  previousDate: string;
  currentVisitId: string;
  currentDate: string;
}

/** The two most recent visits of a horse that are not open. */
export async function livePair(db: Db, horseId: string): Promise<LivePair | null> {
  const rows = await query<{ id: string; business_date: string }>(
    db,
    `SELECT id, to_char(business_date,'YYYY-MM-DD') AS business_date FROM visits
     WHERE horse_id = $1 AND status <> 'open'
     ORDER BY business_date DESC, created_at DESC LIMIT 2`,
    [horseId],
  );
  if (rows.length < 2) return null;
  const current = rows[0] as { id: string; business_date: string };
  const previous = rows[1] as { id: string; business_date: string };
  return {
    previousVisitId: previous.id,
    previousDate: previous.business_date,
    currentVisitId: current.id,
    currentDate: current.business_date,
  };
}

function linkStatus(link: VetLinkRow, at: Date): 'active' | 'revoked' | 'expired' {
  if (link.revoked_at !== null) return 'revoked';
  if (at.getTime() >= link.expires_at.getTime()) return 'expired';
  return 'active';
}

/** A vet photo path serves only an after photo of the link's current pair. */
export async function vetLinkServesPhoto(
  db: Db,
  vetLinkId: string,
  visitId: string,
  phase: string,
): Promise<boolean> {
  if (phase !== 'after') return false;
  const link = await queryOne<VetLinkRow>(
    db,
    `SELECT ${VET_LINK_COLUMNS} FROM vet_links l JOIN horses h ON h.id = l.horse_id WHERE l.id = $1`,
    [vetLinkId],
  );
  if (link === null) return false;
  if (linkStatus(link, now()) !== 'active') return false;
  const pair = await livePair(db, link.horse_id);
  if (pair === null) return false;
  return pair.previousVisitId === visitId || pair.currentVisitId === visitId;
}

function issuedBody(
  link: { id: string; expires_at: Date },
  token: string,
  pair: LivePair,
  timeZone: string,
): Record<string, unknown> {
  return {
    id: link.id,
    url: `/vet/${token}`,
    expires_at: formatInstant(link.expires_at, timeZone),
    previous_visit_id: pair.previousVisitId,
    current_visit_id: pair.currentVisitId,
  };
}

function expiryWall(expiresAt: Date, timeZone: string): string {
  return `${formatInstant(expiresAt, timeZone).slice(0, 10)} ${wallTimeAt(expiresAt, timeZone)}`;
}

export function registerVetLinkRoutes(): void {
  route({
    method: 'POST',
    path: '/api/horses/:id/vet-links',
    roles: ['farrier'],
    bodyKind: 'json',
    handler: async (ctx: Ctx) => {
      const body = ctx.body<{ vet_name?: unknown; vet_email?: unknown }>();
      const result = await withTransaction(async (db) => {
        const at = now();
        const { timeZone } = await practice(db);
        const horse = await visibleHorse(db, ctx.caller, ctx.params.id as string);
        const pair = await livePair(db, horse.id);
        if (pair === null) throw conflict('not_enough_visits');

        const errors: Record<string, string> = {};
        const vetName = typeof body.vet_name === 'string' ? body.vet_name.trim() : '';
        const vetEmail = typeof body.vet_email === 'string' ? body.vet_email.trim() : '';
        if (vetName === '') errors.vet_name = fieldMessages.required;
        if (vetEmail === '') errors.vet_email = fieldMessages.required;
        else if (!isEmail(vetEmail)) errors.vet_email = fieldMessages.email;
        if (Object.keys(errors).length > 0) throw new ValidationError(errors);

        const token = newToken(32);
        const id = newId();
        const expiresAt = new Date(at.getTime() + config.vetLinkTtlSeconds * 1000);
        await query(
          db,
          `INSERT INTO vet_links (id, horse_id, vet_name, vet_email, token_hash,
                                  issued_previous_visit_id, issued_current_visit_id,
                                  expires_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, horse.id, vetName, vetEmail, sha256(token), pair.previousVisitId, pair.currentVisitId, expiresAt, at],
        );
        await writeAudit(db, {
          actor: callerActor(ctx.caller),
          action: 'issue',
          entityType: 'vet_link',
          entityId: id,
          to: 'active',
          at,
          requestId: ctx.requestId,
        });
        const message = vetLinkEmail(horse.name, `/vet/${token}`, expiryWall(expiresAt, timeZone), timeZone);
        await queueRequestEmail(db, {
          to: vetEmail,
          subject: message.subject,
          body: message.body,
          dedupeKey: `vet_link:${id}`,
        });
        return issuedBody({ id, expires_at: expiresAt }, token, pair, timeZone);
      });
      return json(201, result);
    },
  });

  route({
    method: 'GET',
    path: '/api/horses/:id/vet-links',
    roles: ['farrier'],
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) => {
      const rows = await withClient(async (db) => {
        const at = now();
        const { timeZone } = await practice(db);
        const horse = await visibleHorse(db, ctx.caller, ctx.params.id as string);
        const links = await query<VetLinkRow>(
          db,
          `SELECT ${VET_LINK_COLUMNS} FROM vet_links l JOIN horses h ON h.id = l.horse_id
           WHERE l.horse_id = $1 ORDER BY l.created_at DESC`,
          [horse.id],
        );
        const pair = await livePair(db, horse.id);
        const bodies: Record<string, unknown>[] = [];
        for (const link of links) {
          const views = await queryOne<{ count: number }>(
            db,
            'SELECT COUNT(*)::int AS count FROM vet_link_views WHERE vet_link_id = $1',
            [link.id],
          );
          bodies.push({
            id: link.id,
            vet_name: link.vet_name,
            vet_email: link.vet_email,
            status: linkStatus(link, at),
            expires_at: formatInstant(link.expires_at, timeZone),
            view_count: views?.count ?? 0,
            previous_date: pair?.previousDate ?? null,
            current_date: pair?.currentDate ?? null,
          });
        }
        return bodies;
      });
      return json(200, rows);
    },
  });

  route({
    method: 'POST',
    path: '/api/vet-links/:id/revoke',
    roles: ['farrier'],
    bodyKind: 'json',
    handler: async (ctx: Ctx) => {
      const body = await withTransaction(async (db) => {
        const at = now();
        const { timeZone } = await practice(db);
        const link = await queryOne<VetLinkRow>(
          db,
          `SELECT ${VET_LINK_COLUMNS} FROM vet_links l JOIN horses h ON h.id = l.horse_id WHERE l.id = $1`,
          [ctx.params.id as string],
        );
        if (link === null) throw notFound();
        await query(db, 'UPDATE vet_links SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [
          link.id,
          at,
        ]);
        await writeAudit(db, {
          actor: callerActor(ctx.caller),
          action: 'revoke',
          entityType: 'vet_link',
          entityId: link.id,
          to: 'revoked',
          at,
          requestId: ctx.requestId,
        });
        const views = await queryOne<{ count: number }>(
          db,
          'SELECT COUNT(*)::int AS count FROM vet_link_views WHERE vet_link_id = $1',
          [link.id],
        );
        const pair = await livePair(db, link.horse_id);
        return {
          id: link.id,
          vet_name: link.vet_name,
          vet_email: link.vet_email,
          status: 'revoked',
          expires_at: formatInstant(link.expires_at, timeZone),
          view_count: views?.count ?? 0,
          previous_date: pair?.previousDate ?? null,
          current_date: pair?.currentDate ?? null,
        };
      });
      return json(200, body);
    },
  });

  route({
    method: 'POST',
    path: '/api/vet-links/:id/regenerate',
    roles: ['farrier'],
    bodyKind: 'json',
    handler: async (ctx: Ctx) => {
      const body = await withTransaction(async (db) => {
        const at = now();
        const { timeZone } = await practice(db);
        const link = await queryOne<VetLinkRow>(
          db,
          `SELECT ${VET_LINK_COLUMNS} FROM vet_links l JOIN horses h ON h.id = l.horse_id WHERE l.id = $1`,
          [ctx.params.id as string],
        );
        if (link === null) throw notFound();
        const pair = await livePair(db, link.horse_id);
        if (pair === null) throw conflict('not_enough_visits');

        const token = newToken(32);
        const expiresAt = new Date(at.getTime() + config.vetLinkTtlSeconds * 1000);
        await query(
          db,
          `UPDATE vet_links SET token_hash = $2, expires_at = $3, revoked_at = NULL,
                                issued_previous_visit_id = $4, issued_current_visit_id = $5
           WHERE id = $1`,
          [link.id, sha256(token), expiresAt, pair.previousVisitId, pair.currentVisitId],
        );
        await writeAudit(db, {
          actor: callerActor(ctx.caller),
          action: 'regenerate',
          entityType: 'vet_link',
          entityId: link.id,
          to: 'active',
          at,
          requestId: ctx.requestId,
        });
        const message = vetLinkEmail(
          link.horse_name,
          `/vet/${token}`,
          expiryWall(expiresAt, timeZone),
          timeZone,
        );
        await queueRequestEmail(db, {
          to: link.vet_email,
          subject: message.subject,
          body: message.body,
          dedupeKey: `vet_link:${link.id}:${at.getTime()}`,
        });
        return issuedBody({ id: link.id, expires_at: expiresAt }, token, pair, timeZone);
      });
      return json(200, body);
    },
  });

  route({
    method: 'GET',
    path: '/api/vet-links/:id/views',
    roles: ['farrier'],
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) => {
      const rows = await withClient(async (db) => {
        const { timeZone } = await practice(db);
        const link = await queryOne<{ id: string }>(db, 'SELECT id FROM vet_links WHERE id = $1', [
          ctx.params.id as string,
        ]);
        if (link === null) throw notFound();
        const views = await query<{
          at: Date;
          address: string;
          outcome: string;
          user_agent: string;
          previous_date: string | null;
          current_date: string | null;
        }>(
          db,
          `SELECT v.at, v.address, v.outcome, v.user_agent,
                  to_char(pv.business_date,'YYYY-MM-DD') AS previous_date,
                  to_char(cv.business_date,'YYYY-MM-DD') AS current_date
           FROM vet_link_views v
           LEFT JOIN visits pv ON pv.id = v.previous_visit_id
           LEFT JOIN visits cv ON cv.id = v.current_visit_id
           WHERE v.vet_link_id = $1 ORDER BY v.at DESC`,
          [link.id],
        );
        return views.map((view) => ({
          at: formatInstant(view.at, timeZone),
          address: view.address,
          outcome: view.outcome,
          user_agent: view.user_agent,
          previous_date: view.previous_date,
          current_date: view.current_date,
        }));
      });
      return json(200, rows);
    },
  });

  route({
    method: 'GET',
    path: '/api/vet/:token',
    openToVets: true,
    rate: 'vet',
    handler: async (ctx: Ctx) => {
      const token = ctx.params.token as string;
      const at = now();
      const found = await withClient(async (db) =>
        queryOne<VetLinkRow>(
          db,
          `SELECT ${VET_LINK_COLUMNS} FROM vet_links l JOIN horses h ON h.id = l.horse_id
           WHERE l.token_hash = $1`,
          [sha256(token)],
        ),
      );

      if (found === null) {
        // An unknown token is a miss and adds no view row.
        await recordVetMiss(ctx.address);
        throw notFound();
      }

      const status = linkStatus(found, at);
      if (status !== 'active') {
        await withTransaction(async (db) => {
          await query(
            db,
            `INSERT INTO vet_link_views (id, vet_link_id, at, address, outcome, user_agent)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [newId(), found.id, at, ctx.address, status, ctx.userAgent],
          );
        });
        await recordVetMiss(ctx.address);
        throw notFound();
      }

      const body = await withTransaction(async (db) => {
        const { timeZone } = await practice(db);
        const pair = await livePair(db, found.horse_id);
        if (pair === null) throw notFound();

        const hooves: Record<string, unknown> = {};
        for (const hoof of HOOVES) {
          const outcome = await buildComparison(
            db,
            { id: found.horse_id, name: found.horse_name },
            {
              hoof,
              previousVisitId: pair.previousVisitId,
              currentVisitId: pair.currentVisitId,
              includeOpen: false,
              forVet: true,
              vetLinkId: found.id,
            },
          );
          hooves[hoof] = outcome.kind === 'ok' ? outcome.body : null;
        }

        await query(
          db,
          `INSERT INTO vet_link_views (id, vet_link_id, at, address, outcome, user_agent,
                                       previous_visit_id, current_visit_id)
           VALUES ($1,$2,$3,$4,'viewed',$5,$6,$7)`,
          [newId(), found.id, at, ctx.address, ctx.userAgent, pair.previousVisitId, pair.currentVisitId],
        );

        return {
          horse: { name: found.horse_name },
          previous_date: pair.previousDate,
          current_date: pair.currentDate,
          expires_at: formatInstant(found.expires_at, timeZone),
          hooves,
        };
      });
      return json(200, body);
    },
  });

  // Every method other than GET on a vet path answers the read-only 405.
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    route({
      method,
      path: '/api/vet/:token',
      openToVets: true,
      handler: async () => {
        throw new ApiError(405, 'read_only');
      },
    });
  }
}
