import { randomUUID } from 'node:crypto';
import { pool, withTransaction, type Queryable } from '../../../db/pool.js';
import { appendAuditEntry } from '../../../domain/audit.js';
import { normaliseEmail } from '../../../domain/candidate.js';
import { REGIONS, findOffice, isDiscipline } from '../../../domain/careers.js';
import {
  ACTIVE_APPLICATION_STAGES,
  APPLICATION_STAGES,
  applicationMoveAllowed,
  isApplicationStage,
  requisitionMoveAllowed,
  type ApplicationStage,
  type RequisitionStatus,
} from '../../../domain/lifecycle.js';
import { isRealDateString } from '../../../domain/london.js';
import { removeSearchEntry, upsertSearchEntry } from '../../../domain/content.js';
import { issueTrackingToken, liveTrackingToken } from '../../../domain/tracking.js';
import { config } from '../../../config.js';
import { queueReissuedLink, queueStageNotice } from '../../../services/notifications.js';
import { storageIsUp } from '../../../services/probes.js';
import { StorageObjectMissing, getObject } from '../../../services/storage.js';
import { errors } from '../../errors.js';
import { bytesReply, jsonReply } from '../../reply.js';
import { route } from '../../server.js';
import {
  consoleRead,
  consoleWrite,
  etag,
  ifMatch,
  objectBody,
  onlyKeys,
  requireRole,
  requireText,
  type Session,
} from './guard.js';

type RequisitionRow = {
  id: string;
  slug: string;
  title: string;
  discipline: string;
  office: string;
  description: string;
  status: RequisitionStatus;
  recruiters: string[];
  opened_at: Date | null;
  closed_at: Date | null;
  close_reason: string | null;
  version: number;
};

const REQUISITION_COLUMNS = `id, slug, title, discipline, office, description, status,
  recruiters, opened_at, closed_at, close_reason, version`;

type ApplicationRow = {
  id: string;
  requisition_id: string;
  reference: string;
  name: string;
  email: string;
  stage: ApplicationStage;
  resume_key: string | null;
  submitted_at: Date;
  stage_changed_at: Date;
  version: number;
};

const APPLICATION_COLUMNS = `id, requisition_id, reference, name, email, stage, resume_key,
  submitted_at, stage_changed_at, version`;

async function stageCounts(
  tx: Queryable,
  requisitionId: string,
): Promise<Record<string, number>> {
  const result = await tx.query<{ stage: ApplicationStage; count: number }>(
    'SELECT stage, count(*)::int AS count FROM applications WHERE requisition_id = $1 GROUP BY stage',
    [requisitionId],
  );
  const counts: Record<string, number> = {};
  for (const stage of APPLICATION_STAGES) counts[stage] = 0;
  for (const row of result.rows) counts[row.stage] = row.count;
  return counts;
}

async function requisitionObject(
  tx: Queryable,
  row: RequisitionRow,
  withDescription: boolean,
): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    discipline: row.discipline,
    office: row.office,
    recruiters: row.recruiters,
    version: row.version,
    counts: await stageCounts(tx, row.id),
  };
  if (withDescription) base.description = row.description;
  return base;
}

async function assignedRequisition(
  tx: Queryable,
  id: string,
  session: Session,
): Promise<RequisitionRow> {
  const result = await tx.query<RequisitionRow>(
    `SELECT ${REQUISITION_COLUMNS} FROM requisitions WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (row === undefined || !row.recruiters.includes(session.staff.email)) {
    throw errors.consoleNotFound();
  }
  return row;
}

async function assignedApplication(
  tx: Queryable,
  id: string,
  session: Session,
): Promise<{ application: ApplicationRow; requisition: RequisitionRow }> {
  const result = await tx.query<ApplicationRow>(
    `SELECT ${APPLICATION_COLUMNS} FROM applications WHERE id = $1`,
    [id],
  );
  const application = result.rows[0];
  if (application === undefined) throw errors.consoleNotFound();
  const requisition = await assignedRequisition(tx, application.requisition_id, session);
  return { application, requisition };
}

function applicationObject(
  application: ApplicationRow,
  decisions: readonly {
    from_stage: string;
    to_stage: string;
    rationale: string;
    actor: string;
    at: Date;
  }[],
  notes: readonly { id: string; body: string; author: string; at: Date }[],
): Record<string, unknown> {
  return {
    id: application.id,
    reference: application.reference,
    name: application.name,
    email: application.email,
    stage: application.stage,
    version: application.version,
    submitted_at: application.submitted_at.toISOString(),
    decisions: decisions.map((decision) => ({
      from: decision.from_stage,
      to: decision.to_stage,
      rationale: decision.rationale,
      by: decision.actor,
      at: decision.at.toISOString(),
    })),
    notes: notes.map((note) => ({
      id: note.id,
      body: note.body,
      by: note.author,
      at: note.at.toISOString(),
    })),
  };
}

async function applicationReply(
  tx: Queryable,
  id: string,
  status: number,
): Promise<ReturnType<typeof jsonReply>> {
  const result = await tx.query<ApplicationRow>(
    `SELECT ${APPLICATION_COLUMNS} FROM applications WHERE id = $1`,
    [id],
  );
  const application = result.rows[0];
  if (application === undefined) throw errors.consoleNotFound();
  const decisions = await tx.query<{
    from_stage: string;
    to_stage: string;
    rationale: string;
    actor: string;
    at: Date;
  }>(
    `SELECT from_stage, to_stage, rationale, actor, at FROM stage_decisions
      WHERE application_id = $1 ORDER BY at, id`,
    [id],
  );
  const notes = await tx.query<{ id: string; body: string; author: string; at: Date }>(
    `SELECT id, body, author, at FROM application_notes
      WHERE application_id = $1 ORDER BY at, id`,
    [id],
  );
  return jsonReply(
    status,
    { application: applicationObject(application, decisions.rows, notes.rows) },
    etag(application.version),
  );
}

async function moveApplication(
  tx: Queryable,
  input: {
    readonly application: ApplicationRow;
    readonly requisition: RequisitionRow;
    readonly to: ApplicationStage;
    readonly rationale: string;
    readonly actor: string;
    readonly version: number;
  },
): Promise<void> {
  const moved = await tx.query(
    `UPDATE applications SET stage = $3, stage_changed_at = now(), version = version + 1
      WHERE id = $1 AND version = $2`,
    [input.application.id, input.version, input.to],
  );
  if ((moved.rowCount ?? 0) === 0) throw errors.staleVersion();
  await tx.query(
    `INSERT INTO stage_decisions (id, application_id, from_stage, to_stage, rationale, actor, at)
     VALUES ($1,$2,$3,$4,$5,$6, now())`,
    [
      randomUUID(),
      input.application.id,
      input.application.stage,
      input.to,
      input.rationale,
      input.actor,
    ],
  );
  await queueStageNotice(tx, {
    to: { name: input.application.name, email: input.application.email },
    roleTitle: input.requisition.title,
    stage: input.to,
    token: await liveTrackingToken(tx, input.application.id),
  });
  await appendAuditEntry(tx, {
    actor: input.actor,
    action: 'application.stage',
    targetType: 'application',
    targetId: input.application.id,
    detail: {
      reference: input.application.reference,
      from: input.application.stage,
      to: input.to,
    },
  });
}

export function registerConsoleCareersApi(): void {
  route('GET', '/api/console/requisitions', null, async (ctx) =>
    consoleRead(ctx, async (session) => {
      requireRole(session, 'recruiter');
      const result = await pool.query<RequisitionRow>(
        `SELECT ${REQUISITION_COLUMNS} FROM requisitions
          WHERE $1 = ANY(recruiters) ORDER BY created_at DESC, id`,
        [session.staff.email],
      );
      const requisitions = [];
      for (const row of result.rows) {
        requisitions.push(await requisitionObject(pool, row, false));
      }
      return jsonReply(200, { requisitions });
    }),
  );

  route('GET', '/api/console/requisitions/:id', null, async (ctx) =>
    consoleRead(ctx, async (session) => {
      const row = await assignedRequisition(pool, ctx.params.id as string, session);
      requireRole(session, 'recruiter');
      return jsonReply(
        200,
        { requisition: await requisitionObject(pool, row, true) },
        etag(row.version),
      );
    }),
  );

  route('POST', '/api/console/requisitions', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      requireRole(session, 'recruiter');
      const payload = objectBody(ctx.json());
      onlyKeys(payload, ['slug', 'title', 'discipline', 'office', 'description', 'recruiters']);

      const slug = typeof payload.slug === 'string' ? payload.slug.trim() : '';
      const discipline = typeof payload.discipline === 'string' ? payload.discipline.trim() : '';
      const office = typeof payload.office === 'string' ? payload.office.trim() : '';
      const fields: Record<string, string> = {};
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
        fields.slug = 'Use lowercase letters, numbers and single hyphens, up to 80 characters.';
      }
      const title = typeof payload.title === 'string' ? payload.title.trim() : '';
      if ([...title].length < 1 || [...title].length > 120) {
        fields.title = 'Enter a title of at most 120 characters.';
      }
      const description =
        typeof payload.description === 'string' ? payload.description.trim() : '';
      if ([...description].length < 1 || [...description].length > 8000) {
        fields.description = 'Enter a description of at most 8,000 characters.';
      }
      if (!isDiscipline(discipline)) {
        fields.discipline = 'Choose research, engineering, policy or operations.';
      }
      if (findOffice(office) === undefined) fields.office = 'Choose a listed office.';

      const rawRecruiters = payload.recruiters;
      const recruiters = Array.isArray(rawRecruiters)
        ? rawRecruiters
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => normaliseEmail(entry))
        : [];
      if (
        rawRecruiters !== undefined &&
        (!Array.isArray(rawRecruiters) || recruiters.length !== rawRecruiters.length)
      ) {
        fields.recruiters = 'Each recruiter must hold the recruiter role.';
      } else if (recruiters.length > 0) {
        const holders = await pool.query<{ staff_email: string }>(
          `SELECT DISTINCT staff_email FROM role_grants
            WHERE role = 'recruiter' AND revoked_at IS NULL AND expires_at > now()
              AND staff_email = ANY($1::text[])`,
          [recruiters],
        );
        const held = new Set(holders.rows.map((row) => row.staff_email));
        if (recruiters.some((email) => !held.has(email))) {
          fields.recruiters = 'Each recruiter must hold the recruiter role.';
        }
      }
      if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

      const assigned = Array.from(new Set([...recruiters, session.staff.email]));
      const created = await withTransaction(async (tx) => {
        const clash = await tx.query('SELECT 1 FROM requisitions WHERE slug = $1', [slug]);
        if ((clash.rowCount ?? 0) > 0) {
          throw errors.validationFailed({ slug: 'That slug is already in use.' });
        }
        const id = randomUUID();
        const inserted = await tx.query<RequisitionRow>(
          `INSERT INTO requisitions (id, slug, title, discipline, office, description, status,
             recruiters, version, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,1, now())
           RETURNING ${REQUISITION_COLUMNS}`,
          [id, slug, title, discipline, office, description, assigned],
        );
        await appendAuditEntry(tx, {
          actor: session.staff.email,
          action: 'requisition.create',
          targetType: 'requisition',
          targetId: id,
          detail: { slug, title, discipline, office },
        });
        return inserted.rows[0] as RequisitionRow;
      });
      return jsonReply(
        201,
        { requisition: await requisitionObject(pool, created, true) },
        etag(created.version),
      );
    }),
  );

  route('POST', '/api/console/requisitions/:id/open', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      const id = ctx.params.id as string;
      await assignedRequisition(pool, id, session);
      requireRole(session, 'recruiter');
      const version = ifMatch(ctx);
      onlyKeys(objectBody(ctx.json()), []);

      const opened = await withTransaction(async (tx) => {
        const locked = await tx.query<RequisitionRow>(
          `SELECT ${REQUISITION_COLUMNS} FROM requisitions WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const row = locked.rows[0] as RequisitionRow;
        if (row.version !== version) throw errors.staleVersion();
        if (!requisitionMoveAllowed(row.status, 'open')) {
          throw errors.illegalTransition(row.status, 'open');
        }
        const updated = await tx.query<RequisitionRow>(
          `UPDATE requisitions SET status='open', opened_at = now(), version = version + 1
            WHERE id = $1 AND version = $2
            RETURNING ${REQUISITION_COLUMNS}`,
          [id, version],
        );
        const result = updated.rows[0];
        if (result === undefined) throw errors.staleVersion();
        await upsertSearchEntry(tx, {
          kind: 'role',
          slug: result.slug,
          refId: result.id,
          title: result.title,
          summary: '',
          body: result.description,
          publishedAt: result.opened_at ?? new Date(),
        });
        await appendAuditEntry(tx, {
          actor: session.staff.email,
          action: 'requisition.open',
          targetType: 'requisition',
          targetId: id,
          detail: { slug: result.slug },
        });
        return result;
      });
      return jsonReply(
        200,
        { requisition: await requisitionObject(pool, opened, true) },
        etag(opened.version),
      );
    }),
  );

  route('POST', '/api/console/requisitions/:id/close', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      const id = ctx.params.id as string;
      await assignedRequisition(pool, id, session);
      requireRole(session, 'recruiter');
      const version = ifMatch(ctx);
      const payload = objectBody(ctx.json());
      onlyKeys(payload, ['reason']);
      const reason = requireText(payload, 'reason', {
        min: 1,
        max: 2000,
        message: 'Say why this requisition is closing.',
      });

      const closed = await withTransaction(async (tx) => {
        const locked = await tx.query<RequisitionRow>(
          `SELECT ${REQUISITION_COLUMNS} FROM requisitions WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const row = locked.rows[0] as RequisitionRow;
        if (row.version !== version) throw errors.staleVersion();
        if (!requisitionMoveAllowed(row.status, 'closed')) {
          throw errors.illegalTransition(row.status, 'closed');
        }
        const updated = await tx.query<RequisitionRow>(
          `UPDATE requisitions
              SET status='closed', closed_at = now(), close_reason = $3,
                  retention_deadline = now() + ($4 || ' seconds')::interval,
                  version = version + 1
            WHERE id = $1 AND version = $2
            RETURNING ${REQUISITION_COLUMNS}`,
          [id, version, reason, String(config.applicationRetentionSeconds)],
        );
        const result = updated.rows[0];
        if (result === undefined) throw errors.staleVersion();
        await removeSearchEntry(tx, 'role', result.slug);
        await appendAuditEntry(tx, {
          actor: session.staff.email,
          action: 'requisition.close',
          targetType: 'requisition',
          targetId: id,
          detail: { slug: result.slug, reason },
        });

        const active = await tx.query<ApplicationRow>(
          `SELECT ${APPLICATION_COLUMNS} FROM applications
            WHERE requisition_id = $1 AND stage = ANY($2::text[]) FOR UPDATE`,
          [id, [...ACTIVE_APPLICATION_STAGES]],
        );
        for (const application of active.rows) {
          await moveApplication(tx, {
            application,
            requisition: result,
            to: 'declined',
            rationale: `Requisition closed: ${reason}`,
            actor: session.staff.email,
            version: application.version,
          });
        }
        return result;
      });
      return jsonReply(
        200,
        { requisition: await requisitionObject(pool, closed, true) },
        etag(closed.version),
      );
    }),
  );

  route('GET', '/api/console/requisitions/:id/applications', null, async (ctx) =>
    consoleRead(ctx, async (session) => {
      const row = await assignedRequisition(pool, ctx.params.id as string, session);
      requireRole(session, 'recruiter');
      const result = await pool.query<ApplicationRow>(
        `SELECT ${APPLICATION_COLUMNS} FROM applications
          WHERE requisition_id = $1 ORDER BY submitted_at, id`,
        [row.id],
      );
      return jsonReply(200, {
        applications: result.rows.map((application) => ({
          id: application.id,
          reference: application.reference,
          name: application.name,
          email: application.email,
          stage: application.stage,
          submitted_at: application.submitted_at.toISOString(),
          version: application.version,
        })),
      });
    }),
  );

  route('GET', '/api/console/applications/:id', null, async (ctx) =>
    consoleRead(ctx, async (session) => {
      await assignedApplication(pool, ctx.params.id as string, session);
      requireRole(session, 'recruiter');
      return applicationReply(pool, ctx.params.id as string, 200);
    }),
  );

  route('POST', '/api/console/applications/:id/stage', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      const id = ctx.params.id as string;
      await assignedApplication(pool, id, session);
      requireRole(session, 'recruiter');
      const version = ifMatch(ctx);
      const payload = objectBody(ctx.json());
      onlyKeys(payload, ['to', 'rationale']);
      const to = typeof payload.to === 'string' ? payload.to.trim() : '';
      if (!isApplicationStage(to)) {
        throw errors.validationFailed({ to: 'Choose a listed stage.' });
      }
      const rationale = requireText(payload, 'rationale', {
        min: 1,
        max: 2000,
        message: 'Record the reason for this decision.',
      });

      await withTransaction(async (tx) => {
        const locked = await tx.query<ApplicationRow>(
          `SELECT ${APPLICATION_COLUMNS} FROM applications WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const application = locked.rows[0];
        if (application === undefined) throw errors.consoleNotFound();
        const requisition = await assignedRequisition(tx, application.requisition_id, session);
        if (application.version !== version) throw errors.staleVersion();
        if (!applicationMoveAllowed(application.stage, to)) {
          throw errors.illegalTransition(application.stage, to);
        }
        await moveApplication(tx, {
          application,
          requisition,
          to,
          rationale,
          actor: session.staff.email,
          version,
        });
      });
      return applicationReply(pool, id, 200);
    }),
  );

  route('POST', '/api/console/applications/:id/notes', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      const id = ctx.params.id as string;
      await assignedApplication(pool, id, session);
      requireRole(session, 'recruiter');
      const payload = objectBody(ctx.json());
      onlyKeys(payload, ['body']);
      const body = requireText(payload, 'body', {
        min: 1,
        max: 4000,
        message: 'Enter a note of at most 4,000 characters.',
      });
      const note = await withTransaction(async (tx) => {
        const noteId = randomUUID();
        const inserted = await tx.query<{ at: Date }>(
          `INSERT INTO application_notes (id, application_id, body, author, at)
           VALUES ($1,$2,$3,$4, now()) RETURNING at`,
          [noteId, id, body, session.staff.email],
        );
        await appendAuditEntry(tx, {
          actor: session.staff.email,
          action: 'application.note',
          targetType: 'application',
          targetId: id,
          detail: { note_id: noteId },
        });
        return {
          id: noteId,
          body,
          by: session.staff.email,
          at: (inserted.rows[0]?.at ?? new Date()).toISOString(),
        };
      });
      return jsonReply(201, { note });
    }),
  );

  route('GET', '/api/console/applications/:id/resume', null, async (ctx) =>
    consoleRead(ctx, async (session) => {
      const { application } = await assignedApplication(
        pool,
        ctx.params.id as string,
        session,
      );
      requireRole(session, 'recruiter');
      if (application.resume_key === null) throw errors.consoleNotFound();
      if (!storageIsUp()) {
        throw errors.storageUnavailable('Résumés are unavailable right now.');
      }
      try {
        const object = await getObject(application.resume_key);
        return bytesReply(200, 'application/pdf', object.body, {
          'Content-Disposition': `attachment; filename="resume-${application.reference}.pdf"`,
          'Cache-Control': 'no-store',
        });
      } catch (error) {
        if (error instanceof StorageObjectMissing) throw errors.consoleNotFound();
        throw errors.storageUnavailable('Résumés are unavailable right now.');
      }
    }),
  );

  route(
    'POST',
    '/api/console/applications/:id/tracking-link/reissue',
    'console_writes',
    async (ctx) =>
      consoleWrite(ctx, async (session) => {
        const id = ctx.params.id as string;
        const { application, requisition } = await assignedApplication(pool, id, session);
        requireRole(session, 'recruiter');
        onlyKeys(objectBody(ctx.json()), []);
        const reissuedAt = await withTransaction(async (tx) => {
          const state = await tx.query<{ retired: boolean }>(
            `SELECT (a.erased_at IS NOT NULL
                     OR (r.status = 'closed' AND r.retention_deadline IS NOT NULL
                         AND r.retention_deadline <= now())) AS retired
               FROM applications a JOIN requisitions r ON r.id = a.requisition_id
              WHERE a.id = $1`,
            [id],
          );
          if (state.rows[0]?.retired !== false) {
            throw errors.conflict(
              'link_retired',
              "This application's retention period has ended.",
            );
          }
          const token = await issueTrackingToken(tx, id);
          await queueReissuedLink(tx, {
            to: { name: application.name, email: application.email },
            roleTitle: requisition.title,
            token,
          });
          await appendAuditEntry(tx, {
            actor: session.staff.email,
            action: 'tracking_link.reissue',
            targetType: 'application',
            targetId: id,
            detail: { reference: application.reference },
          });
          return new Date();
        });
        return jsonReply(200, { reissued_at: reissuedAt.toISOString() });
      }),
  );

  route('POST', '/api/console/benefits', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      requireRole(session, 'recruiter');
      const payload = objectBody(ctx.json());
      onlyKeys(payload, ['region', 'effective_from', 'summary']);
      const region = typeof payload.region === 'string' ? payload.region.trim() : '';
      const effectiveFrom =
        typeof payload.effective_from === 'string' ? payload.effective_from.trim() : '';
      const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
      const fields: Record<string, string> = {};
      if (!REGIONS.some((entry) => entry.value === region)) {
        fields.region = 'Choose a listed region.';
      }
      if (!isRealDateString(effectiveFrom)) {
        fields.effective_from = 'Use a real date in the form YYYY-MM-DD.';
      }
      if ([...summary].length < 1 || [...summary].length > 500) {
        fields.summary = 'Enter a summary of at most 500 characters.';
      }
      if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

      const entry = await withTransaction(async (tx) => {
        const clash = await tx.query(
          'SELECT 1 FROM benefits_entries WHERE region = $1 AND effective_from = $2',
          [region, effectiveFrom],
        );
        if ((clash.rowCount ?? 0) > 0) {
          throw errors.conflict('entry_exists', 'That region already has an entry from this date.');
        }
        const id = randomUUID();
        await tx.query(
          `INSERT INTO benefits_entries (id, region, effective_from, summary, created_at)
           VALUES ($1,$2,$3,$4, now())`,
          [id, region, effectiveFrom, summary],
        );
        await appendAuditEntry(tx, {
          actor: session.staff.email,
          action: 'benefits.create',
          targetType: 'benefits_entry',
          targetId: id,
          detail: { region, effective_from: effectiveFrom },
        });
        return { id, region, effective_from: effectiveFrom, summary };
      });
      return jsonReply(201, { entry });
    }),
  );
}
