import type { Route, RouteContext } from '../router.ts';
import { route } from '../router.ts';
import { ERRORS } from '../errors.ts';
import { asRecord, str, Validator } from '../validation.ts';
import { requireRole, STAFF, CONCIERGE } from './guards.ts';
import { lockKey, type Tx } from '../db.ts';
import { releaseAllows, isOpenRelease, earliestSlot, slotGridProblem, slotFromUtc, SLOT_NOTICE_SECONDS } from '../domain/releases.ts';
import { zurichSlotToUtc, zurichSlotLabel } from '../../shared/dates.ts';
import { jobBlocksRelease } from '../domain/jobs.ts';
import { withIdempotency, requireIdempotencyKey } from '../idemwrap.ts';
import { isMailDown } from '../providers/status.ts';
import { bookedEmail, releasedEmail } from '../email.ts';
import { projectActor } from '../objects.ts';
import { loadInvoice, refreshInvoice, type InvoiceRow } from './jobs.ts';
import { enqueue } from '../queue.ts';

function bodyOf(rc: RouteContext): Record<string, unknown> {
  return asRecord(rc.body);
}

export interface ReleaseRow {
  id: string;
  car_id: string;
  car_name: string;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  slot: string;
  status: string;
  bay_code: string | null;
  created_at: string;
}

const RELEASE_SELECT = `
  SELECT r.id, r.car_id,
    concat(c.year, ' ', c.make, ' ', c.model) AS car_name,
    c.owner_id, u.name AS owner_name, u.email AS owner_email,
    r.slot, r.status, r.bay_code, r.created_at
  FROM releases r
  JOIN cars c ON c.id = r.car_id
  JOIN users u ON u.id = c.owner_id
`;

async function visibleRelease(rc: RouteContext, tx: Tx | null, releaseId: string): Promise<ReleaseRow> {
  const query = tx
    ? (await tx.query<ReleaseRow>(`${RELEASE_SELECT} WHERE r.id = $1`, [releaseId])).rows
    : await rc.ctx.db.query<ReleaseRow>(`${RELEASE_SELECT} WHERE r.id = $1`, [releaseId]);
  const release = query[0];
  if (!release) throw ERRORS.notFound();
  if (rc.viewer.isOwner() && release.owner_id !== rc.viewer.id) throw ERRORS.notFound();
  return release;
}

async function holdingInvoices(rc: RouteContext, tx: Tx | null, carId: string): Promise<InvoiceRow[]> {
  const query = tx
    ? (await tx.query<InvoiceRow>(
        `SELECT i.id, i.number, i.job_id, j.car_id,
           concat(c.year, ' ', c.make, ' ', c.model) AS car_name,
           c.owner_id, u.name AS owner_name, u.email AS owner_email,
           i.net_total, i.vat_total, i.rounding, i.total, i.issued_at,
           i.balance, i.balance_live, i.paid_at, i.status_confirmed_at, i.killbill_invoice_id
         FROM invoices i
         JOIN jobs j ON j.id = i.job_id
         JOIN cars c ON c.id = j.car_id
         JOIN users u ON u.id = c.owner_id
         WHERE j.car_id = $1 ORDER BY i.number`,
        [carId],
      )).rows
    : await rc.ctx.db.query<InvoiceRow>(
        `SELECT i.id, i.number, i.job_id, j.car_id,
           concat(c.year, ' ', c.make, ' ', c.model) AS car_name,
           c.owner_id, u.name AS owner_name, u.email AS owner_email,
           i.net_total, i.vat_total, i.rounding, i.total, i.issued_at,
           i.balance, i.balance_live, i.paid_at, i.status_confirmed_at, i.killbill_invoice_id
         FROM invoices i
         JOIN jobs j ON j.id = i.job_id
         JOIN cars c ON c.id = j.car_id
         JOIN users u ON u.id = c.owner_id
         WHERE j.car_id = $1 ORDER BY i.number`,
        [carId],
      );
  const holding: InvoiceRow[] = [];
  for (const invoice of query) {
    await refreshInvoice(rc, tx, invoice);
    if (Number(invoice.balance) > 0) {
      holding.push(invoice);
    }
  }
  return holding;
}

export async function buildReleaseObject(rc: RouteContext, tx: Tx | null, release: ReleaseRow): Promise<Record<string, unknown>> {
  const events = await (tx
    ? tx.query<{ status: string; at: string; by: string | null; by_name: string | null }>(
        `SELECT e.status, e.at, e.by_user_id AS by, u.name AS by_name
         FROM release_events e LEFT JOIN users u ON u.id = e.by_user_id
         WHERE e.release_id = $1 ORDER BY e.at`,
        [release.id],
      )
    : rc.ctx.db.query<{ status: string; at: string; by: string | null; by_name: string | null }>(
        `SELECT e.status, e.at, e.by_user_id AS by, u.name AS by_name
         FROM release_events e LEFT JOIN users u ON u.id = e.by_user_id
         WHERE e.release_id = $1 ORDER BY e.at`,
        [release.id],
      ));
  const eventRows = 'rows' in events ? events.rows : events;
  const held =
    release.status === 'released' || release.status === 'cancelled'
      ? []
      : (await holdingInvoices(rc, tx, release.car_id)).map((invoice) => ({
          id: invoice.id,
          number: invoice.number,
          balance: invoice.balance,
        }));
  return {
    id: release.id,
    car: { id: release.car_id, name: release.car_name },
    owner: { id: release.owner_id, name: release.owner_name },
    slot: release.slot,
    slot_label: slotLabelOf(release.slot),
    status: release.status,
    bay_code: release.bay_code,
    held_by: held,
    events: eventRows.map((event) => ({
      status: event.status,
      at: event.at,
      by: projectActor(event.by ? { id: event.by, name: event.by_name ?? '' } : null, rc.viewer),
    })),
  };
}

function slotLabelOf(slot: string): string {
  return zurichSlotLabel(new Date(zurichSlotToUtc(slot)));
}

export const releaseRoutes: Route[] = [
  route('GET', '/api/releases/earliest-slot', {}, async (rc) => {
    // owners and staff may both read it
    const earliest = earliestSlot(Date.now());
    return {
      status: 200,
      body: {
        earliest: earliest.slot,
        earliest_label: zurichSlotLabel(new Date(earliest.utcMs)),
        time_zone: 'Europe/Zurich',
      },
    };
  }),

  route('GET', '/api/releases', {}, async (rc) => {
    if (rc.viewer.isOwner()) {
      const rows = await rc.ctx.db.query<ReleaseRow>(
        `${RELEASE_SELECT} WHERE c.owner_id = $1 ORDER BY r.created_at DESC`,
        [rc.viewer.id],
      );
      const releases = [];
      for (const release of rows) {
        releases.push(await buildReleaseObject(rc, null, release));
      }
      return { status: 200, body: { releases } };
    }
    requireRole(rc.viewer, STAFF);
    const rows = await rc.ctx.db.query<ReleaseRow>(`${RELEASE_SELECT} ORDER BY r.created_at DESC`);
    const releases = [];
    for (const release of rows) {
      releases.push(await buildReleaseObject(rc, null, release));
    }
    return { status: 200, body: { releases } };
  }),

  route('GET', '/api/releases/{id}', {}, async (rc) => {
    const release = await visibleRelease(rc, null, rc.params['id'] as string);
    return { status: 200, body: { release: await buildReleaseObject(rc, null, release) } };
  }),

  route('POST', '/api/releases', {}, async (rc) => {
    return withIdempotency(rc, 'POST:/api/releases', async (tx) => {
      const record = bodyOf(rc);
      const v = new Validator();
      const carId = str(record['car_id']).trim();
      const car = (
        await tx.query<{
          id: string; owner_id: string; status: string; bay_code: string | null;
          year: number; make: string; model: string; owner_name: string; owner_email: string;
        }>(
          `SELECT c.id, c.owner_id, c.status, b.code AS bay_code,
            c.year, c.make, c.model, u.name AS owner_name, u.email AS owner_email
           FROM cars c LEFT JOIN bays b ON b.id = c.bay_id JOIN users u ON u.id = c.owner_id
           WHERE c.id = $1`,
          [carId],
        )
      ).rows[0];
      if (!car || (rc.viewer.isOwner() && car.owner_id !== rc.viewer.id)) {
        throw ERRORS.notFound();
      }
      if (!rc.viewer.isOwner()) {
        requireRole(rc.viewer, STAFF);
      } else {
        requireRole(rc.viewer, ['owner']);
      }
      const slot = str(record['slot']).trim();

      await lockKey(tx, 'car', car.id);
      // conflict order: car_not_stored, car_in_workshop, release_already_open, slot_taken
      if (car.status !== 'stored') throw ERRORS.conflict('car_not_stored');
      const openJob = (
        await tx.query<{ status: string }>(
          `SELECT status FROM jobs WHERE car_id = $1 AND status IN ('draft','sent','approved','declined','expired','in_progress','finished') LIMIT 1`,
          [car.id],
        )
      ).rows[0];
      if (openJob && jobBlocksRelease(openJob.status as never)) {
        throw ERRORS.conflict('car_in_workshop');
      }
      const openRelease = (
        await tx.query<{ id: string }>(
          `SELECT id FROM releases WHERE car_id = $1 AND status IN ('requested','booked','staged')`,
          [car.id],
        )
      ).rows[0];
      if (openRelease) throw ERRORS.conflict('release_already_open');

      // slot validation and taking, house-wide
      const problem = slotGridProblem(slot);
      if (problem === 'format') {
        v.error('slot', 'Use a date and time like 2026-11-03T10:30.');
      } else if (problem === 'grid') {
        v.error('slot', 'Choose a half-hour slot between 08:00 and 17:30, Monday to Saturday.');
      } else {
        const utcMs = zurichSlotToUtc(slot);
        if (!Number.isFinite(utcMs) || utcMs < Date.now() + SLOT_NOTICE_SECONDS * 1000 - 1000) {
          v.error('slot', "Releases need at least 48 hours' notice.");
        }
      }
      // one open release may hold a slot, house-wide: the slot is locked
      // across every process through the shared database
      await lockKey(tx, 'slot', slot);
      const slotTaken = (
        await tx.query<{ id: string }>(
          `SELECT id FROM releases WHERE slot = $1 AND status IN ('requested','booked','staged')`,
          [slot],
        )
      ).rows[0];
      if (!problem && slotTaken) throw ERRORS.conflict('slot_taken');
      v.throwIfInvalid();

      requireIdempotencyKey(rc);
      const releaseId = `rel-${crypto.randomUUID().slice(0, 12)}`;
      await tx.query(
        `INSERT INTO releases (id, car_id, slot, status, created_at, bay_code) VALUES ($1,$2,$3,'requested',now(),$4)`,
        [releaseId, car.id, slot, car.bay_code],
      );
      await tx.query(
        `INSERT INTO release_events (id, release_id, status, at, by_user_id) VALUES ($1,$2,'requested',now(),$3)`,
        [`re-${crypto.randomUUID().slice(0, 12)}`, releaseId, rc.viewer.id],
      );
      const release = await visibleRelease(rc, tx, releaseId);
      return { status: 201, body: { release: await buildReleaseObject(rc, tx, release) } };
    });
  }),

  route('POST', '/api/releases/{id}/book', {}, async (rc) => {
    return rc.ctx.db.withTx(async (tx) => {
      const release = await visibleRelease(rc, tx, rc.params['id'] as string);
      requireRole(rc.viewer, CONCIERGE);
      await lockKey(tx, 'release', release.id);
      if (!releaseAllows('book', release.status as never, rc.viewer.isOwner())) {
        throw ERRORS.conflict('invalid_transition');
      }
      await tx.query(`UPDATE releases SET status = 'booked' WHERE id = $1`, [release.id]);
      await tx.query(
        `INSERT INTO release_events (id, release_id, status, at, by_user_id) VALUES ($1,$2,'booked',now(),$3)`,
        [`re-${crypto.randomUUID().slice(0, 12)}`, release.id, rc.viewer.id],
      );
      // queue the booking email
      const email = bookedEmail(rc.ctx.env, {
        carName: release.car_name,
        slotLabel: slotLabelOf(release.slot),
        bayCode: release.bay_code ?? '',
        releaseId: release.id,
      });
      await tx.query(`INSERT INTO queue (kind, payload, created_at) VALUES ('email',$1,now())`, [
        JSON.stringify({ to: release.owner_email, subject: email.subject, text: email.text }),
      ]);
      const fresh = await visibleRelease(rc, tx, release.id);
      return { status: 200, body: { release: await buildReleaseObject(rc, tx, fresh) } };
    });
  }),

  route('POST', '/api/releases/{id}/stage', {}, async (rc) => {
    return rc.ctx.db.withTx(async (tx) => {
      const release = await visibleRelease(rc, tx, rc.params['id'] as string);
      requireRole(rc.viewer, CONCIERGE);
      await lockKey(tx, 'release', release.id);
      if (!releaseAllows('stage', release.status as never, rc.viewer.isOwner())) {
        throw ERRORS.conflict('invalid_transition');
      }
      await tx.query(`UPDATE releases SET status = 'staged' WHERE id = $1`, [release.id]);
      await tx.query(
        `INSERT INTO release_events (id, release_id, status, at, by_user_id) VALUES ($1,$2,'staged',now(),$3)`,
        [`re-${crypto.randomUUID().slice(0, 12)}`, release.id, rc.viewer.id],
      );
      const fresh = await visibleRelease(rc, tx, release.id);
      return { status: 200, body: { release: await buildReleaseObject(rc, tx, fresh) } };
    });
  }),

  route('POST', '/api/releases/{id}/complete', {}, async (rc) => {
    const release = await visibleRelease(rc, null, rc.params['id'] as string);
    requireRole(rc.viewer, CONCIERGE);
    const mailDown = await isMailDown(rc.ctx);

    const result = await rc.ctx.db.withTx(async (tx) => {
      // hold the release and the car for the whole attempt
      await lockKey(tx, 'release', release.id);
      await lockKey(tx, 'car', release.car_id);
      const fresh = await visibleRelease(rc, tx, release.id);
      if (!releaseAllows('complete', fresh.status as never, false)) {
        throw ERRORS.conflict('invalid_transition');
      }
      // live invoice check: only this car's invoices hold it
      const holding = await holdingInvoices(rc, tx, fresh.car_id);
      if (holding.length > 0) {
        throw ERRORS.conflict('invoice_unpaid', {
          invoices: holding.map((invoice) => ({ id: invoice.id, number: invoice.number, balance: invoice.balance })),
        });
      }
      const checkedIn = (
        await tx.query<{ id: string; kind: string; label: string; count_in: string }>(
          `SELECT bl.id, bl.kind, bl.label,
             COALESCE((SELECT sum(CASE WHEN m.direction = 'in' THEN m.count ELSE -m.count END)
               FROM movements m WHERE m.belonging_id = bl.id), 0)::text AS count_in
           FROM belongings bl WHERE bl.car_id = $1`,
          [fresh.car_id],
        )
      ).rows.filter((row) => Number(row.count_in) > 0);
      if (checkedIn.length > 0) {
        throw ERRORS.conflict('belongings_checked_in', {
          items: checkedIn.map((row) => ({
            id: row.id,
            kind: row.kind,
            label: row.label,
            count_in: Number(row.count_in),
          })),
        });
      }
      if (mailDown) {
        // nothing is recorded, nothing is queued
        throw ERRORS.mailUnavailable();
      }

      const releasedAt = new Date().toISOString();
      await tx.query(`UPDATE releases SET status = 'released' WHERE id = $1`, [fresh.id]);
      await tx.query(
        `INSERT INTO release_events (id, release_id, status, at, by_user_id) VALUES ($1,$2,'released',$3,$4)`,
        [`re-${crypto.randomUUID().slice(0, 12)}`, fresh.id, releasedAt, rc.viewer.id],
      );
      await tx.query(
        `UPDATE cars SET status = 'released', released_at = $2, bay_id = NULL, bay_billing_cancel_requested = TRUE WHERE id = $1`,
        [fresh.car_id, releasedAt],
      );
      // the released email is sent inside the completion unit
      const email = releasedEmail(rc.ctx.env, {
        carName: fresh.car_name,
        releasedAt,
        bayCode: fresh.bay_code ?? '',
      });
      try {
        await rc.ctx.mail.send(fresh.owner_email, email.subject, email.text, `<pre>${email.text}</pre>`);
      } catch {
        // mail refused: nothing is recorded and nothing is queued
        throw ERRORS.mailUnavailable();
      }
      // subscription cancellation follows the success, once Kill Bill can be reached
      await tx.query(`INSERT INTO queue (kind, payload, created_at) VALUES ('killbill_subscription_cancel',$1,now())`, [
        JSON.stringify({ car_id: fresh.car_id }),
      ]);
      return { releasedAt };
    });
    void result;
    const fresh = await visibleRelease(rc, null, release.id);
    const carRow = await rc.ctx.db.query<{ id: string; status: string; bay_id: string | null }>(
      `SELECT id, status, bay_id FROM cars WHERE id = $1`,
      [fresh.car_id],
    );
    return {
      status: 200,
      body: {
        release: await buildReleaseObject(rc, null, fresh),
        car: { id: carRow[0].id, status: carRow[0].status, bay_id: carRow[0].bay_id },
      },
    };
  }),

  route('POST', '/api/releases/{id}/cancel', {}, async (rc) => {
    return rc.ctx.db.withTx(async (tx) => {
      const release = await visibleRelease(rc, tx, rc.params['id'] as string);
      if (!rc.viewer.isOwner()) {
        requireRole(rc.viewer, CONCIERGE);
      } else {
        requireRole(rc.viewer, ['owner']);
      }
      await lockKey(tx, 'release', release.id);
      if (!releaseAllows('cancel', release.status as never, rc.viewer.isOwner())) {
        throw ERRORS.conflict('invalid_transition');
      }
      await tx.query(`UPDATE releases SET status = 'cancelled' WHERE id = $1`, [release.id]);
      await tx.query(
        `INSERT INTO release_events (id, release_id, status, at, by_user_id) VALUES ($1,$2,'cancelled',now(),$3)`,
        [`re-${crypto.randomUUID().slice(0, 12)}`, release.id, rc.viewer.id],
      );
      const fresh = await visibleRelease(rc, tx, release.id);
      return { status: 200, body: { release: await buildReleaseObject(rc, tx, fresh) } };
    });
  }),
];
