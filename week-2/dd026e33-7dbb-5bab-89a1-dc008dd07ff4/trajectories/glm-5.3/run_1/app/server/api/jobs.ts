import type { Route, RouteContext } from '../router.ts';
import { route } from '../router.ts';
import { ERRORS } from '../errors.ts';
import { asRecord, str, trimmed, Validator, validateLines, validatePanel, validateFilmReading, text1to120 } from '../validation.ts';
import { requireRole, STAFF, WORKSHOP, CONCIERGE } from './guards.ts';
import { lockKey, q, type Tx } from '../db.ts';
import { jobStatusAllows, jobBlocksRelease, effectiveStatus, type JobStatus } from '../domain/jobs.ts';
import { STAGE_NAMES, PANELS, bandOf, BAND_LABELS, deriveLayers, filmBuildAt } from '../../shared/coat.ts';
import { lineNetMinor, lineVatMinor, computeTotals, fromMinor } from '../../shared/money.ts';
import { filmValueDisplay } from '../../shared/units.ts';
import { visibleCarTx } from './cars.ts';
import { withIdempotency, requireIdempotencyKey } from '../idemwrap.ts';
import { enqueue } from '../queue.ts';
import { estimateEmail, invoiceEmail } from '../email.ts';
import { isBillingDown } from '../providers/status.ts';
import { KillBillError } from '../providers/killbill.ts';
import { projectActor, type ActorRow } from '../objects.ts';

function bodyOf(rc: RouteContext): Record<string, unknown> {
  return asRecord(rc.body);
}

export interface JobFullRow {
  id: string;
  number: string;
  car_id: string;
  car_name: string;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  title: string;
  status: string;
  version: number;
  sent_at: string | null;
  expires_at: string | null;
  approved_at: string | null;
  declined_at: string | null;
  finished_at: string | null;
  created_at: string;
  invoice_id: string | null;
}

const JOB_SELECT = `
  SELECT j.id, j.number, j.car_id,
    concat(c.year, ' ', c.make, ' ', c.model) AS car_name,
    c.owner_id, u.name AS owner_name, u.email AS owner_email,
    j.title, j.status, j.version, j.sent_at, j.expires_at, j.approved_at, j.declined_at,
    j.finished_at, j.created_at,
    (SELECT i.id FROM invoices i WHERE i.job_id = j.id ORDER BY i.issued_at DESC LIMIT 1) AS invoice_id
  FROM jobs j
  JOIN cars c ON c.id = j.car_id
  JOIN users u ON u.id = c.owner_id
`;

async function visibleJob(rc: RouteContext, tx: Tx | null, jobId: string): Promise<JobFullRow> {
  const rows = await q<JobFullRow>(rc.ctx.db, tx, `${JOB_SELECT} WHERE j.id = $1`, [jobId]);
  const job = rows[0];
  if (!job) throw ERRORS.notFound();
  if (rc.viewer.isOwner()) {
    if (job.owner_id !== rc.viewer.id) throw ERRORS.notFound();
    const status = effectiveStatus(job.status as JobStatus, Date.now(), job.expires_at ? Date.parse(job.expires_at) : null);
    if (status === 'draft') throw ERRORS.notFound();
  }
  return job;
}

interface LineRow {
  id: string;
  kind: string;
  description: string;
  quantity: string;
  unit_price: string;
  net: string;
  vat: string;
  position: number;
}

async function jobLines(rc: RouteContext, tx: Tx | null, jobId: string): Promise<LineRow[]> {
  const sql = `SELECT l.id, l.kind, l.description, l.quantity, l.unit_price, l.position
    FROM job_lines l WHERE l.job_id = $1 ORDER BY l.position`;
  const list = await q<{ id: string; kind: string; description: string; quantity: string; unit_price: string; position: number }>(rc.ctx.db, tx, sql, [jobId]);
  return list.map((record) => {
    const netMinor = lineNetMinor(record.quantity, record.unit_price);
    return {
      id: record.id,
      kind: record.kind,
      description: record.description,
      quantity: record.quantity,
      unit_price: record.unit_price,
      net: fromMinor(netMinor),
      vat: fromMinor(lineVatMinor(netMinor)),
      position: record.position,
    };
  });
}

export async function totalsOf(lines: LineRow[]): Promise<{ net_total: string; vat_total: string; rounding: string; total: string }> {
  return computeTotals(lines.map((line) => line.net), lines.map((line) => line.vat));
}

interface StageFullRow {
  id: string;
  job_id: string;
  name: string;
  logged_at: string;
}

export async function jobStages(rc: RouteContext, tx: Tx | null, jobId: string): Promise<StageFullRow[]> {
  const sql = `SELECT s.id, s.job_id, s.name, s.logged_at FROM stages s
    WHERE s.job_id = $1
    ORDER BY array_position(ARRAY['Intake','Stripped','Epoxy primer','Guide coat','2K primer','Base','Clear','Cut and polish']::text[], s.name)`;
  const list = await q<StageFullRow>(rc.ctx.db, tx, sql, [jobId]);
  return list.map((record) => ({
    id: String(record.id),
    job_id: String(record.job_id),
    name: String(record.name),
    logged_at: String(record.logged_at),
  }));
}

export async function buildJobObject(rc: RouteContext, tx: Tx | null, job: JobFullRow): Promise<Record<string, unknown>> {
  const lines = await jobLines(rc, tx, job.id);
  const totals = await totalsOf(lines);
  const stages = await jobStages(rc, tx, job.id);
  const counts = await q<{ stage_id: string; readings: number }>(
    rc.ctx.db, tx,
    `SELECT stage_id, count(*)::int AS readings FROM readings WHERE job_id = $1 GROUP BY stage_id`,
    [job.id],
  );
  const readingsCounts = new Map(counts.map((row) => [row.stage_id, row.readings]));
  const status = effectiveStatus(job.status as JobStatus, Date.now(), job.expires_at ? Date.parse(job.expires_at) : null);
  return {
    id: job.id,
    number: job.number,
    version: job.version,
    car: { id: job.car_id, name: job.car_name },
    owner: { id: job.owner_id, name: job.owner_name },
    title: job.title,
    status,
    lines: lines.map((line) => ({
      id: line.id,
      kind: line.kind,
      description: line.description,
      quantity: Number(line.quantity).toFixed(2),
      unit_price: line.unit_price,
      net: line.net,
      vat: line.vat,
    })),
    ...totals,
    currency: 'CHF',
    sent_at: job.sent_at,
    expires_at: job.expires_at,
    approved_at: job.approved_at,
    declined_at: job.declined_at,
    finished_at: job.finished_at,
    stages: stages.map((stage) => ({
      id: stage.id,
      index: stages.indexOf(stage),
      name: stage.name,
      logged_at: stage.logged_at,
      readings_count: readingsCounts.get(stage.id) ?? 0,
    })),
    invoice_id: job.invoice_id,
  };
}

async function assertIfMatch(rc: RouteContext, tx: Tx, job: JobFullRow): Promise<void> {
  const ifMatch = (rc.req.headers['if-match'] as string | undefined) ?? '';
  if (!ifMatch) {
    throw ERRORS.validation({ if_match: 'Send the estimate version you edited.' });
  }
  const version = ifMatch.replace(/^"|"$/g, '');
  if (version !== String(job.version)) {
    throw ERRORS.estimateChanged();
  }
}

export const jobRoutes: Route[] = [
  route('GET', '/api/jobs', {}, async (rc) => {
    if (rc.viewer.isOwner()) {
      const rows = await rc.ctx.db.query<JobFullRow>(
        `${JOB_SELECT} WHERE c.owner_id = $1 AND j.status NOT IN ('draft') ORDER BY j.created_at DESC`,
        [rc.viewer.id],
      );
      const jobs = [];
      for (const job of rows) {
        jobs.push(await buildJobObject(rc, null, job));
      }
      return { status: 200, body: { jobs } };
    }
    requireRole(rc.viewer, STAFF);
    const rows = await rc.ctx.db.query<JobFullRow>(`${JOB_SELECT} ORDER BY j.created_at DESC`);
    const jobs = [];
    for (const job of rows) {
      jobs.push(await buildJobObject(rc, null, job));
    }
    return { status: 200, body: { jobs } };
  }),

  route('POST', '/api/jobs', {}, async (rc) => {
    const record = bodyOf(rc);
    const v = new Validator();
    const carId = str(record['car_id']).trim();
    const car = await visibleCarTx(rc, null, carId);
    requireRole(rc.viewer, WORKSHOP);
    const title = text1to120(v, 'title', record['title']);
    const lines = validateLines(v, record['lines'], '145.00');
    v.throwIfInvalid();

    const existing = await rc.ctx.db.query<{ id: string }>(
      `SELECT id FROM jobs WHERE car_id = $1 AND status IN ('draft','sent','approved','declined','expired','in_progress','finished')`,
      [car.id],
    );
    if (existing.length > 0) {
      throw ERRORS.conflict('job_already_open');
    }
    if (car.status !== 'stored') {
      throw ERRORS.conflict('car_not_stored');
    }

    const nextNumber = await nextJobNumber(rc);
    const jobId = `j-${crypto.randomUUID().slice(0, 12)}`;
    await rc.ctx.db.withTx(async (tx) => {
      await lockKey(tx, 'job_number', 'jobs');
      await tx.query(
        `INSERT INTO jobs (id, number, car_id, title, status, version, created_at) VALUES ($1,$2,$3,$4,'draft',1,now())`,
        [jobId, nextNumber, car.id, title],
      );
      let position = 0;
      for (const line of lines) {
        position += 1;
        await tx.query(
          `INSERT INTO job_lines (id, job_id, kind, description, quantity, unit_price, position) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [`l-${crypto.randomUUID().slice(0, 12)}`, jobId, line.kind, line.description, line.quantity, line.unit_price, position],
        );
      }
    });
    const job = await rc.ctx.db.query<JobFullRow>(`${JOB_SELECT} WHERE j.id = $1`, [jobId]);
    return { status: 201, body: { job: await buildJobObject(rc, null, job[0]) } };
  }),

  route('GET', '/api/jobs/{id}', {}, async (rc) => {
    const job = await visibleJob(rc, null, rc.params['id'] as string);
    return {
      status: 200,
      body: { job: await buildJobObject(rc, null, job) },
      headers: { ETag: `"${job.version}"` },
    };
  }),

  route('PATCH', '/api/jobs/{id}', {}, async (rc) => {
    const record = bodyOf(rc);
    return rc.ctx.db.withTx(async (tx) => {
      await lockKey(tx, 'job', rc.params['id'] as string);
      const job = await visibleJob(rc, tx, rc.params['id'] as string);
      requireRole(rc.viewer, WORKSHOP);
      const v = new Validator();
      const title = text1to120(v, 'title', record['title']);
      const lines = validateLines(v, record['lines'], '145.00');
      const allows = jobStatusAllows('edit', job.status as JobStatus, false, lines.length > 0, true);
      if (!allows.ok) throw ERRORS.conflict(allows.code ?? 'invalid_transition');
      await assertIfMatch(rc, tx, job);
      v.throwIfInvalid();

      await tx.query('DELETE FROM job_lines WHERE job_id = $1', [job.id]);
      await tx.query(
        `UPDATE jobs SET title = $2, version = version + 1 WHERE id = $1`,
        [job.id, title],
      );
      let position = 0;
      for (const line of lines) {
        position += 1;
        await tx.query(
          `INSERT INTO job_lines (id, job_id, kind, description, quantity, unit_price, position) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [`l-${crypto.randomUUID().slice(0, 12)}`, job.id, line.kind, line.description, line.quantity, line.unit_price, position],
        );
      }
      const fresh = (await tx.query<JobFullRow>(`${JOB_SELECT} WHERE j.id = $1`, [job.id])).rows[0];
      return {
        status: 200,
        body: { job: await buildJobObject(rc, tx, fresh) },
        headers: { ETag: `"${fresh.version}"` },
      };
    });
  }),

  route('POST', '/api/jobs/{id}/send', {}, async (rc) => {
    return rc.ctx.db.withTx(async (tx) => {
      await lockKey(tx, 'job', rc.params['id'] as string);
      const job = await visibleJob(rc, tx, rc.params['id'] as string);
      requireRole(rc.viewer, WORKSHOP);
      const lines = await jobLines(rc, tx, job.id);
      const allows = jobStatusAllows('send', job.status as JobStatus, false, lines.length > 0, true);
      if (!allows.ok) throw ERRORS.conflict(allows.code ?? 'invalid_transition');
      await assertIfMatch(rc, tx, job);

      const expiresAt = new Date(Date.now() + rc.ctx.env.timers.estimateExpirySeconds * 1000).toISOString();
      await tx.query(
        `UPDATE jobs SET status = 'sent', sent_at = now(), expires_at = $2, version = version + 1 WHERE id = $1`,
        [job.id, expiresAt],
      );
      // queue the approval email (sends even while mail is down)
      const lines2 = await jobLines(rc, tx, job.id);
      const totals = await totalsOf(lines2);
      const emailData = {
        jobNumber: job.number,
        carName: job.car_name,
        title: job.title,
        total: totals.total,
        expiresAt,
        jobId: job.id,
      };
      const email = estimateEmail(rc.ctx.env, emailData);
      await enqueueEmail(tx, {
        to: job.owner_email,
        subject: email.subject,
        text: email.text,
      });
      const fresh = (await tx.query<JobFullRow>(`${JOB_SELECT} WHERE j.id = $1`, [job.id])).rows[0];
      return {
        status: 200,
        body: { job: await buildJobObject(rc, tx, fresh) },
        headers: { ETag: `"${fresh.version}"` },
      };
    });
  }),

  route('POST', '/api/jobs/{id}/revise', {}, async (rc) => {
    return rc.ctx.db.withTx(async (tx) => {
      await lockKey(tx, 'job', rc.params['id'] as string);
      const job = await visibleJob(rc, tx, rc.params['id'] as string);
      requireRole(rc.viewer, WORKSHOP);
      const allows = jobStatusAllows('revise', job.status as JobStatus, false, true, true);
      if (!allows.ok) throw ERRORS.conflict(allows.code ?? 'invalid_transition');
      await tx.query(
        `UPDATE jobs SET status = 'draft', sent_at = NULL, expires_at = NULL, approved_at = NULL, declined_at = NULL, version = version + 1 WHERE id = $1`,
        [job.id],
      );
      const fresh = (await tx.query<JobFullRow>(`${JOB_SELECT} WHERE j.id = $1`, [job.id])).rows[0];
      return {
        status: 200,
        body: { job: await buildJobObject(rc, tx, fresh) },
        headers: { ETag: `"${fresh.version}"` },
      };
    });
  }),

  route('POST', '/api/jobs/{id}/approve', {}, async (rc) => {
    return rc.ctx.db.withTx(async (tx) => {
      const job = await visibleJob(rc, tx, rc.params['id'] as string);
      if (!rc.viewer.isOwner() || job.owner_id !== rc.viewer.id) {
        requireRole(rc.viewer, ['owner']);
      }
      const isExpired = job.expires_at !== null && Date.now() >= Date.parse(job.expires_at);
      const allows = jobStatusAllows('approve', job.status as JobStatus, isExpired, true, true);
      if (!allows.ok) {
        if (allows.code === 'estimate_expired') {
          throw ERRORS.conflict('estimate_expired', { expires_at: job.expires_at });
        }
        throw ERRORS.conflict(allows.code ?? 'invalid_transition');
      }
      await tx.query(
        `UPDATE jobs SET status = 'approved', approved_at = now(), version = version + 1 WHERE id = $1`,
        [job.id],
      );
      const fresh = (await tx.query<JobFullRow>(`${JOB_SELECT} WHERE j.id = $1`, [job.id])).rows[0];
      return {
        status: 200,
        body: { job: await buildJobObject(rc, tx, fresh) },
        headers: { ETag: `"${fresh.version}"` },
      };
    });
  }),

  route('POST', '/api/jobs/{id}/decline', {}, async (rc) => {
    return rc.ctx.db.withTx(async (tx) => {
      const job = await visibleJob(rc, tx, rc.params['id'] as string);
      if (!rc.viewer.isOwner() || job.owner_id !== rc.viewer.id) {
        requireRole(rc.viewer, ['owner']);
      }
      const isExpired = job.expires_at !== null && Date.now() >= Date.parse(job.expires_at);
      const allows = jobStatusAllows('decline', job.status as JobStatus, isExpired, true, true);
      if (!allows.ok) {
        if (allows.code === 'estimate_expired') {
          throw ERRORS.conflict('estimate_expired', { expires_at: job.expires_at });
        }
        throw ERRORS.conflict(allows.code ?? 'invalid_transition');
      }
      await tx.query(
        `UPDATE jobs SET status = 'declined', declined_at = now(), version = version + 1 WHERE id = $1`,
        [job.id],
      );
      const fresh = (await tx.query<JobFullRow>(`${JOB_SELECT} WHERE j.id = $1`, [job.id])).rows[0];
      return {
        status: 200,
        body: { job: await buildJobObject(rc, tx, fresh) },
        headers: { ETag: `"${fresh.version}"` },
      };
    });
  }),

  route('POST', '/api/jobs/{id}/stages', {}, async (rc) => {
    const record = bodyOf(rc);
    return rc.ctx.db.withTx(async (tx) => {
      await lockKey(tx, 'job', rc.params['id'] as string);
      const job = await visibleJob(rc, tx, rc.params['id'] as string);
      requireRole(rc.viewer, WORKSHOP);
      const v = new Validator();
      const stageName = str(record['name']).trim();
      v.check((STAGE_NAMES as readonly string[]).includes(stageName), 'name', 'Choose a stage from the list.');
      const rawReadings = Array.isArray(record['readings']) ? (record['readings'] as unknown[]) : [];
      const readings: { panel: string; film_um: number }[] = [];
      const seenPanels = new Set<string>();
      rawReadings.forEach((item, index) => {
        const row = asRecord(item);
        const panel = validatePanel(v, `readings[${index}].panel`, row['panel']);
        if (panel && seenPanels.has(panel)) {
          v.error(`readings[${index}].panel`, 'Choose a panel from the list.');
        } else if (panel) {
          seenPanels.add(panel);
        }
        const unit = str(row['unit']) === 'mil' ? 'mil' : 'um';
        const value = validateFilmReading(v, `readings[${index}].value`, row['value'], unit);
        if (panel !== null && value !== null) {
          readings.push({ panel, film_um: value });
        }
      });
      if (stageName === 'Intake') {
        v.check(seenPanels.size === PANELS.length, 'readings', 'Intake needs a reading for every panel.');
      } else {
        v.check(readings.length >= 1, 'readings', 'Add at least one reading.');
      }
      const allows = jobStatusAllows('log_stage', job.status as JobStatus, false, true, true);
      if (!allows.ok) throw ERRORS.conflict(allows.code ?? 'invalid_transition');

      // conflict order within stages: already_logged, out_of_order
      const existing = await tx.query<{ name: string }>('SELECT name FROM stages WHERE job_id = $1', [job.id]);
      const names = existing.rows.map((row) => row.name);
      if (names.includes(stageName)) {
        throw ERRORS.conflict('stage_already_logged', { stage: stageName });
      }
      const stageIndex = (STAGE_NAMES as readonly string[]).indexOf(stageName);
      const laterLogged = names.some((name) => (STAGE_NAMES as readonly string[]).indexOf(name) > stageIndex);
      if (laterLogged) {
        throw ERRORS.conflict('stage_out_of_order', { stage: stageName });
      }
      v.throwIfInvalid();

      const stageId = `st-${crypto.randomUUID().slice(0, 12)}`;
      const loggedAt = new Date();
      await tx.query(
        `INSERT INTO stages (id, job_id, name, logged_at) VALUES ($1,$2,$3,$4)`,
        [stageId, job.id, stageName, loggedAt.toISOString()],
      );
      for (const reading of readings) {
        await tx.query(
          `INSERT INTO readings (id, stage_id, job_id, panel, film_um, logged_at, logged_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [`r-${crypto.randomUUID().slice(0, 12)}`, stageId, job.id, reading.panel, reading.film_um, loggedAt.toISOString(), rc.viewer.id],
        );
      }
      await tx.query(
        `UPDATE jobs SET status = 'in_progress', version = version + 1 WHERE id = $1`,
        [job.id],
      );
      const fresh = (await tx.query<JobFullRow>(`${JOB_SELECT} WHERE j.id = $1`, [job.id])).rows[0];
      return {
        status: 201,
        body: {
          stage: { id: stageId, index: names.length, name: stageName, logged_at: loggedAt.toISOString(), readings_count: readings.length },
          job: await buildJobObject(rc, tx, fresh),
        },
      };
    });
  }),

  route('POST', '/api/jobs/{id}/stages/{stageId}/readings', {}, async (rc) => {
    const record = bodyOf(rc);
    return rc.ctx.db.withTx(async (tx) => {
      await lockKey(tx, 'job', rc.params['id'] as string);
      const job = await visibleJob(rc, tx, rc.params['id'] as string);
      requireRole(rc.viewer, WORKSHOP);
      const stage = await tx.query<{ id: string; name: string }>(
        'SELECT id, name FROM stages WHERE id = $1 AND job_id = $2',
        [rc.params['stageId'] as string, job.id],
      );
      if (!stage.rows[0]) throw ERRORS.notFound();
      const v = new Validator();
      const panel = validatePanel(v, 'panel', record['panel']);
      const unit = str(record['unit']) === 'mil' ? 'mil' : 'um';
      const value = validateFilmReading(v, 'value', record['value'], unit);
      const allows = jobStatusAllows('add_reading', job.status as JobStatus, false, true, true);
      if (!allows.ok) throw ERRORS.conflict(allows.code ?? 'invalid_transition');
      v.throwIfInvalid();

      const readingId = `r-${crypto.randomUUID().slice(0, 12)}`;
      const loggedAt = new Date().toISOString();
      await tx.query(
        `INSERT INTO readings (id, stage_id, job_id, panel, film_um, logged_at, logged_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [readingId, stage.rows[0].id, job.id, panel, value, loggedAt, rc.viewer.id],
      );
      await tx.query(`UPDATE jobs SET version = version + 1 WHERE id = $1`, [job.id]);
      return {
        status: 201,
        body: {
          reading: {
            id: readingId,
            panel,
            stage: stage.rows[0].name,
            film_um: value,
            logged_at: loggedAt,
            logged_by: projectActor({ id: rc.viewer.id, name: rc.viewer.name }, rc.viewer),
          },
        },
      };
    });
  }),

  route('GET', '/api/jobs/{id}/coat-stack', {}, async (rc) => {
    const job = await visibleJob(rc, null, rc.params['id'] as string);
    const stages = await jobStages(rc, null, job.id);
    const readings = await rc.ctx.db.query<{ stage_id: string; panel: string; film_um: number; logged_at: string }>(
      `SELECT stage_id, panel, film_um, logged_at FROM readings WHERE job_id = $1 ORDER BY logged_at`,
      [job.id],
    );
    // film_um at stage k = latest reading at that stage
    const byStage = new Map<string, Map<string, { film_um: number; logged_at: string }>>();
    for (const reading of readings) {
      const map = byStage.get(reading.stage_id) ?? new Map();
      const existing = map.get(reading.panel);
      if (!existing || reading.logged_at >= existing.logged_at) {
        map.set(reading.panel, { film_um: reading.film_um, logged_at: reading.logged_at });
      }
      byStage.set(reading.stage_id, map);
    }
    const panelsOut = stages.map((stage, index) => {
      const stageReadings = byStage.get(stage.id) ?? new Map();
      const panels: {
        panel: string;
        film_um: number | null;
        band: string | null;
        layers: { stage: string; um: number }[];
      }[] = [];
      for (const panel of PANELS) {
        const values = stages.map((s) => byStage.get(s.id)?.get(panel.id)?.film_um ?? null);
        const film = filmBuildAt(values, index);
        const layers = deriveLayers(values.slice(0, index + 1)).map((layer) => ({
          stage: stages[layer.stage_index]?.name ?? '',
          um: layer.um,
        }));
        panels.push({
          panel: panel.id,
          film_um: film,
          band: film !== null ? bandOf(film) : null,
          layers,
        });
      }
      return { index, name: stage.name, logged_at: stage.logged_at, panels };
    });
    return {
      status: 200,
      body: {
        job_id: job.id,
        panels: PANELS.map((panel) => ({ id: panel.id, name: panel.name, order: panel.order })),
        stages: panelsOut,
      },
    };
  }),

  route('GET', '/api/jobs/{id}/panels/{panel}/readings', {}, async (rc) => {
    const job = await visibleJob(rc, null, rc.params['id'] as string);
    const panel = rc.params['panel'] as string;
    if (!PANELS.some((candidate) => candidate.id === panel)) throw ERRORS.notFound();
    const readings = await rc.ctx.db.query<{
      id: string; stage_id: string; stage_name: string; film_um: number; logged_at: string; by: string; by_name: string;
    }>(
      `SELECT r.id, r.stage_id, s.name AS stage_name, r.film_um, r.logged_at, r.logged_by_user_id AS by, u.name AS by_name
       FROM readings r JOIN stages s ON s.id = r.stage_id LEFT JOIN users u ON u.id = r.logged_by_user_id
       WHERE r.job_id = $1 AND r.panel = $2 ORDER BY r.logged_at`,
      [job.id, panel],
    );
    return {
      status: 200,
      body: {
        panel,
        readings: readings.map((reading) => ({
          id: reading.id,
          stage: reading.stage_name,
          film_um: reading.film_um,
          logged_at: reading.logged_at,
          logged_by: projectActor({ id: reading.by, name: reading.by_name }, rc.viewer),
        })),
      },
    };
  }),

  route('POST', '/api/jobs/{id}/finish', {}, async (rc) => {
    return rc.ctx.db.withTx(async (tx) => {
      await lockKey(tx, 'job', rc.params['id'] as string);
      const job = await visibleJob(rc, tx, rc.params['id'] as string);
      requireRole(rc.viewer, WORKSHOP);
      const stages = await jobStages(rc, tx, job.id);
      const allows = jobStatusAllows('finish', job.status as JobStatus, false, true, stages.length > 0);
      if (!allows.ok) throw ERRORS.conflict(allows.code ?? 'invalid_transition');
      await tx.query(
        `UPDATE jobs SET status = 'finished', finished_at = now(), version = version + 1 WHERE id = $1`,
        [job.id],
      );
      const fresh = (await tx.query<JobFullRow>(`${JOB_SELECT} WHERE j.id = $1`, [job.id])).rows[0];
      return {
        status: 200,
        body: { job: await buildJobObject(rc, tx, fresh) },
        headers: { ETag: `"${fresh.version}"` },
      };
    });
  }),

  route('POST', '/api/jobs/{id}/invoice', {}, async (rc) => {
    return withIdempotency(rc, 'POST:/api/jobs/{id}/invoice', async (tx) => {
      await lockKey(tx, 'job', rc.params['id'] as string);
      const job = await visibleJob(rc, tx, rc.params['id'] as string);
      requireRole(rc.viewer, WORKSHOP);
      const allows = jobStatusAllows('issue_invoice', job.status as JobStatus, false, true, true);
      if (!allows.ok) throw ERRORS.conflict(allows.code ?? 'invalid_transition');
      if (await isBillingDown(rc.ctx)) throw ERRORS.billingUnavailable();

      // Kill Bill charge first; the invoice exists only after it commits
      const lines = await jobLines(rc, tx, job.id);
      const totals = await totalsOf(lines);
      const accountId = await rc.ctx.killbill.ensureAccount(
        `${rc.ctx.env.killbill.keyPrefix}owner-${job.owner_id}`,
        job.owner_name,
        job.owner_email,
      );
      let killBillInvoice: { invoiceId: string; balance: string };
      try {
        killBillInvoice = await rc.ctx.killbill.createCharge(
          accountId,
          totals.total,
          `Workshop job ${job.number}`,
        );
      } catch (err) {
        if (err instanceof KillBillError && err.isUnavailable) {
          throw ERRORS.billingUnavailable();
        }
        throw err;
      }

      requireIdempotencyKey(rc);
      // gapless numbering, taken only on success; the number sequence is
      // serialised across every process through the shared database
      await lockKey(tx, 'invoice_number', 'invoices');
      const number = await nextInvoiceNumber(tx);
      const invoiceId = `i-${crypto.randomUUID().slice(0, 12)}`;
      await tx.query(
        `INSERT INTO invoices (id, number, job_id, net_total, vat_total, rounding, total, issued_at, balance, balance_live, status_confirmed_at, killbill_invoice_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8,TRUE,now(),$9)`,
        [invoiceId, number, job.id, totals.net_total, totals.vat_total, totals.rounding, totals.total, killBillInvoice.balance, killBillInvoice.invoiceId],
      );
      let position = 0;
      for (const line of lines) {
        position += 1;
        await tx.query(
          `INSERT INTO invoice_lines (id, invoice_id, kind, description, quantity, unit_price, net, vat, position)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [`il-${crypto.randomUUID().slice(0, 12)}`, invoiceId, line.kind, line.description, line.quantity, line.unit_price, line.net, line.vat, position],
        );
      }
      await tx.query(`UPDATE jobs SET status = 'invoiced', version = version + 1 WHERE id = $1`, [job.id]);

      // queue the invoice email
      const email = invoiceEmailText(rc, job, number, totals.total, invoiceId);
      await enqueueEmail(tx, email);

      const fresh = (await tx.query<JobFullRow>(`${JOB_SELECT} WHERE j.id = $1`, [job.id])).rows[0];
      const invoice = await loadInvoice(rc, tx, invoiceId);
      return {
        status: 201,
        body: {
          invoice: await projectInvoice(rc, invoice),
          job: await buildJobObject(rc, tx, fresh),
        },
      };
    });
  }),
];

async function nextJobNumber(rc: RouteContext): Promise<string> {
  const rows = await rc.ctx.db.query<{ max: string | null }>(
    `SELECT max(substring(number from 2)::int)::text AS max FROM jobs`,
  );
  const next = (Number(rows[0]?.max ?? '1000')) + 1;
  return `J-${next}`;
}

async function nextInvoiceNumber(tx: Tx): Promise<string> {
  const result = await tx.query<{ next: string }>(
    `SELECT (max(substring(number from 12)::int) + 1)::text AS next FROM invoices
     WHERE number LIKE 'INV-' || to_char(now(), 'YYYY') || '-%'`,
  );
  const next = result.rows[0]?.next;
  if (!next || Number(next) < 1) {
    return `INV-${new Date().getUTCFullYear()}-0001`;
  }
  return `INV-${new Date().getUTCFullYear()}-${String(next).padStart(4, '0')}`;
}

export interface InvoiceRow {
  id: string;
  number: string;
  job_id: string;
  car_id: string;
  car_name: string;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  net_total: string;
  vat_total: string;
  rounding: string;
  total: string;
  issued_at: string;
  balance: string;
  balance_live: boolean;
  paid_at: string | null;
  status_confirmed_at: string | null;
  killbill_invoice_id: string | null;
}

const INVOICE_SELECT = `
  SELECT i.id, i.number, i.job_id, j.car_id,
    concat(c.year, ' ', c.make, ' ', c.model) AS car_name,
    c.owner_id, u.name AS owner_name, u.email AS owner_email,
    i.net_total, i.vat_total, i.rounding, i.total, i.issued_at,
    i.balance, i.balance_live, i.paid_at, i.status_confirmed_at, i.killbill_invoice_id
  FROM invoices i
  JOIN jobs j ON j.id = i.job_id
  JOIN cars c ON c.id = j.car_id
  JOIN users u ON u.id = c.owner_id
`;

export async function loadInvoice(rc: RouteContext, tx: Tx | null, invoiceId: string): Promise<InvoiceRow> {
  const rows = await q<InvoiceRow>(rc.ctx.db, tx, `${INVOICE_SELECT} WHERE i.id = $1`, [invoiceId]);
  const row = rows[0];
  if (!row) throw ERRORS.notFound();
  return row;
}

export async function projectInvoice(rc: RouteContext, invoice: InvoiceRow): Promise<Record<string, unknown>> {
  const lines = await (async () => {
    const query = await rc.ctx.db.query<{ id: string; kind: string; description: string; quantity: string; unit_price: string; net: string; vat: string }>(
      `SELECT l.id, l.kind, l.description, l.quantity, l.unit_price, l.net, l.vat
       FROM invoice_lines l WHERE l.invoice_id = $1 ORDER BY l.position`,
      [invoice.id],
    );
    return query;
  })();
  const transfers = await rc.ctx.db.query<{
    id: string; reference: string; amount: string; at: string; recorded_by: string; recorded_by_name: string; killbill_payment_id: string;
  }>(
    `SELECT t.id, t.reference, t.amount, t.at, t.recorded_by_user_id AS recorded_by, u.name AS recorded_by_name,
       (SELECT pm.payment_id FROM payments pm WHERE pm.transfer_id = t.id) AS killbill_payment_id
     FROM transfers t LEFT JOIN users u ON u.id = t.recorded_by_user_id
     WHERE t.invoice_id = $1 ORDER BY t.at`,
    [invoice.id],
  );
  const payments = await rc.ctx.db.query<{
    transfer_id: string | null; payment_id: string; amount: string; refunded: string; effective_date: string;
  }>(
    `SELECT pm.transfer_id, pm.payment_id, pm.amount, pm.refunded, pm.effective_date
     FROM payments pm WHERE pm.invoice_id = $1 ORDER BY pm.effective_date`,
    [invoice.id],
  );
  const status = Number(invoice.balance) === 0 ? 'paid' : 'awaiting_payment';
  const result: Record<string, unknown> = {
    id: invoice.id,
    number: invoice.number,
    job_id: invoice.job_id,
    car: { id: invoice.car_id, name: invoice.car_name },
    owner: { id: invoice.owner_id, name: invoice.owner_name },
    lines: lines.map((line) => ({
      id: line.id,
      kind: line.kind,
      description: line.description,
      quantity: Number(line.quantity).toFixed(2),
      unit_price: line.unit_price,
      net: line.net,
      vat: line.vat,
    })),
    net_total: invoice.net_total,
    vat_total: invoice.vat_total,
    rounding: invoice.rounding,
    total: invoice.total,
    currency: 'CHF',
    balance: invoice.balance,
    balance_live: invoice.balance_live,
    status,
    issued_at: invoice.issued_at,
    paid_at: invoice.paid_at,
    status_confirmed_at: invoice.status_confirmed_at,
    payments: payments.map((payment) => {
      const transfer = transfers.find((candidate) => candidate.id === payment.transfer_id);
      return {
        killbill_payment_id: payment.payment_id,
        amount: payment.amount,
        refunded: payment.refunded,
        reference: transfer?.reference ?? null,
        at: payment.effective_date,
        recorded_by: transfer
          ? projectActor({ id: transfer.recorded_by, name: transfer.recorded_by_name ?? '' }, rc.viewer)
          : null,
      };
    }),
    killbill_invoice_id: invoice.killbill_invoice_id,
  };
  if (rc.viewer.isOwner()) {
    delete result['killbill_invoice_id'];
    result['payments'] = (result['payments'] as Record<string, unknown>[]).map((payment) => {
      const projected = { ...payment };
      delete projected['killbill_payment_id'];
      delete projected['recorded_by'];
      return projected;
    });
  }
  return result;
}

/** Refresh an invoice's balance from Kill Bill; falls back to the last confirmed values. */
export async function refreshInvoice(rc: RouteContext, tx: Tx | null, invoice: InvoiceRow): Promise<void> {
  if (!invoice.killbill_invoice_id) return;
  try {
    // The provider reads; only provider failures fall back to the last confirmed values.
    const kb = await rc.ctx.killbill.getInvoice(invoice.killbill_invoice_id);
    const balance = kb.balance;
    const payments = await rc.ctx.killbill.listPayments(invoice.killbill_invoice_id);
    const confirmedAt = payments.length > 0 ? payments[payments.length - 1].effectiveDate : new Date().toISOString();
    await q(rc.ctx.db, tx,
      `UPDATE invoices SET balance = $2, balance_live = TRUE, paid_at = CASE WHEN $2 = '0.00' THEN COALESCE(paid_at, $3::timestamptz) ELSE NULL END, status_confirmed_at = now() WHERE id = $1`,
      [invoice.id, balance, confirmedAt]);
    invoice.balance = balance;
    invoice.balance_live = true;
    invoice.status_confirmed_at = new Date().toISOString();
    if (balance !== '0.00') {
      invoice.paid_at = null;
    }
    // keep the payments cache in step with Kill Bill; the house's transfer
    // record link is preserved for payments recorded in the app
    for (const payment of payments) {
      await q(rc.ctx.db, tx,
        `INSERT INTO payments (invoice_id, payment_id, amount, refunded, effective_date, transfer_id)
         VALUES ($1,$2,$3,$4,$5,NULL) ON CONFLICT (payment_id) DO UPDATE SET amount = $3, refunded = $4`,
        [invoice.id, payment.paymentId, payment.amount, payment.refundedAmount, payment.effectiveDate],
      );
    }
    // a refund in Kill Bill can reopen the job
    if (balance === '0.00') {
      await q(rc.ctx.db, tx, `UPDATE jobs SET status = 'paid', version = version + 1 WHERE id = $1 AND status = 'invoiced'`, [invoice.job_id]);
    } else {
      await q(rc.ctx.db, tx, `UPDATE jobs SET status = 'invoiced', version = version + 1 WHERE id = $1 AND status = 'paid'`, [invoice.job_id]);
    }
  } catch (err) {
    if (err instanceof KillBillError) {
      invoice.balance_live = false;
      return;
    }
    throw err;
  }
}

function invoiceEmailText(
  rc: RouteContext,
  job: JobFullRow,
  number: string,
  total: string,
  invoiceId: string,
): { to: string; subject: string; text: string } {
  const email = invoiceEmail(rc.ctx.env, {
    invoiceNumber: number,
    carName: job.car_name,
    total,
    invoiceId,
  });
  return { to: job.owner_email, subject: email.subject, text: email.text };
}

async function enqueueEmail(tx: Tx, email: { to: string; subject: string; text: string }): Promise<void> {
  await tx.query(
    `INSERT INTO queue (kind, payload, created_at) VALUES ('email',$1,now())`,
    [JSON.stringify(email)],
  );
}
