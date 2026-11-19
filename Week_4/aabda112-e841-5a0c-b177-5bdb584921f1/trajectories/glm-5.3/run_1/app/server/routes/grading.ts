import express from 'express';
import crypto from 'node:crypto';
import { q, one, pool } from '../db.js';
import { settings } from '../settings.js';
import { clockNow, setClock, clockReset } from '../clock.js';
import { t, notValid } from '../errors.js';
import { handler } from '../core.js';
import * as bus from '../live.js';
import { runTick } from '../background.js';
import { hash } from './auth.js';

export const router = express.Router();

// The grading token guard applies only to the grading routes themselves.
const gradingGuard = express.Router();
gradingGuard.use((req, res, next) => {
  if (!settings.gradingToken) {
    return res.status(404).json({ error: 'not_found', message: "We couldn't find that." });
  }
  if (req.headers['x-grading-token'] !== settings.gradingToken) {
    return res.status(401).json({ error: 'unauthenticated', message: 'Sign in to continue.' });
  }
  next();
});

router.post('/grading/clock', gradingGuard, handler(async (req, res) => {
  const { now } = req.body ?? {};
  if (typeof now !== 'string') throw notValid('now');
  const d = new Date(now);
  if (isNaN(d.getTime())) throw notValid('now');
  setClock(d);
  // Everything the new time causes is processed and pushed before we answer.
  await runTick(true);
  bus.pushClinicAll('tick', {});
  return { status: 200, body: { now: clockNow().toISOString() } };
}));

router.get('/grading/clock', gradingGuard, handler(async (req, res) => {
  return { status: 200, body: { now: clockNow().toISOString() } };
}));

const DEMO_PASSWORD = 'roundbook-demo-1';

router.post('/grading/seed', gradingGuard, handler(async (req, res) => {
  const body = req.body ?? {};
  const ids = {
    clinics: {} as Record<string, string>,
    users: {} as Record<string, { id: string; login_url: string }>,
    rooms: {} as Record<string, string>,
    clients: {} as Record<string, string>,
    patients: {} as Record<string, string>,
    appointments: {} as Record<string, string>,
    hospitalised: {} as Record<string, string>,
    treatments: {} as Record<string, string[]>,
    stock: {} as Record<string, string>,
    invoices: {} as Record<string, string>,
  };

  const ref = (map: Record<string, any>, key: unknown, where: string): string => {
    if (typeof key !== 'string' || !map[key]) throw t('not_found', { field: where });
    return map[key];
  };

  for (const c of body.clinics ?? []) {
    const r = await q(
      `insert into clinics (name, slug) values ($1, $2) returning id`,
      [c.name, c.slug]
    );
    ids.clinics[c.ref] = r.rows[0].id;
  }
  for (const u of body.users ?? []) {
    const clinicId = ref(ids.clinics, u.clinic, 'users.clinic');
    const r = await q(
      `insert into users (clinic_id, name, email, password_hash, role) values ($1, $2, $3, $4, $5) returning id`,
      [clinicId, u.name, u.email, hash(DEMO_PASSWORD), u.role]
    );
    const userId = r.rows[0].id;
    const token = crypto.randomBytes(24).toString('base64url');
    await q(`insert into login_links (token, user_id) values ($1, $2)`, [token, userId]);
    ids.users[u.ref] = { id: userId, login_url: loginUrl(req, token) };
  }
  for (const rm of body.rooms ?? []) {
    const clinicId = ref(ids.clinics, rm.clinic, 'rooms.clinic');
    const pos = await one(`select count(*)::int as c from rooms where clinic_id = $1`, [clinicId]);
    const r = await q(
      `insert into rooms (clinic_id, name, position) values ($1, $2, $3) returning id`,
      [clinicId, rm.name, pos.c]
    );
    ids.rooms[rm.ref] = r.rows[0].id;
  }
  for (const cl of body.clients ?? []) {
    const clinicId = ref(ids.clinics, cl.clinic, 'clients.clinic');
    const r = await q(
      `insert into clients (clinic_id, name, email) values ($1, $2, $3) returning id`,
      [clinicId, cl.name, cl.email]
    );
    ids.clients[cl.ref] = r.rows[0].id;
  }
  for (const p of body.patients ?? []) {
    const clinicId = ref(ids.clinics, p.clinic, 'patients.clinic');
    const clientId = ref(ids.clients, p.client, 'patients.client');
    const r = await q(
      `insert into patients (clinic_id, client_id, name, species, weight_grams) values ($1, $2, $3, $4, $5) returning id`,
      [clinicId, clientId, p.name, p.species, p.weightGrams ?? null]
    );
    ids.patients[p.ref] = r.rows[0].id;
    for (const w of p.weights ?? []) {
      await q(
        `insert into patient_weights (patient_id, recorded_on, grams) values ($1, $2, $3)`,
        [ids.patients[p.ref], w.recordedOn, w.grams]
      );
    }
    for (const v of p.vaccinations ?? []) {
      await q(
        `insert into vaccinations (clinic_id, patient_id, vaccine, due_date) values ($1, $2, $3, $4)`,
        [clinicId, ids.patients[p.ref], v.vaccine, v.dueDate]
      );
    }
  }
  for (const a of body.appointments ?? []) {
    const clinicId = ref(ids.clinics, a.clinic, 'appointments.clinic');
    const patientId = ref(ids.patients, a.patient, 'appointments.patient');
    const vetId = ref(
      { ...Object.fromEntries(Object.entries(ids.users).map(([k, v]) => [k, (v as any).id])) },
      a.vet,
      'appointments.vet'
    );
    const roomId = ref(ids.rooms, a.room, 'appointments.room');
    const r = await q(
      `insert into appointments (clinic_id, patient_id, vet_id, room_id, start_at, minutes, reason, status, checked_in_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [clinicId, patientId, vetId, roomId, new Date(a.start), a.minutes ?? settings.slotMinutes, a.reason, a.status, a.checkedInAt ?? null]
    );
    ids.appointments[a.ref] = r.rows[0].id;
  }
  for (const h of body.hospitalised ?? []) {
    const patientId = ref(ids.patients, h.patient, 'hospitalised.patient');
    const patient = await one(`select clinic_id from patients where id = $1`, [patientId]);
    const kennel = h.kennel;
    const r = await q(
      `insert into admissions (clinic_id, patient_id, kennel) values ($1, $2, $3) returning id`,
      [patient.clinic_id, patientId, kennel]
    );
    const admissionId = r.rows[0].id;
    ids.hospitalised[h.ref] = admissionId;
    const treatmentIds: string[] = [];
    for (const tr of h.treatments ?? []) {
      const trr = await q(
        `insert into treatments (clinic_id, admission_id, patient_id, name, first_at, interval_hours, dose_count)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [patient.clinic_id, admissionId, patientId, tr.name, new Date(tr.firstAt), tr.intervalHours, tr.count]
      );
      const treatmentId = trr.rows[0].id;
      treatmentIds.push(treatmentId);
      const given = new Set<number>(tr.givenDoses ?? []);
      for (let k = 0; k < tr.count; k++) {
        const at = new Date(new Date(tr.firstAt).getTime() + k * tr.intervalHours * 3600_000);
        const status = given.has(k) ? 'given' : 'upcoming';
        await q(
          `insert into doses (treatment_id, idx, scheduled_at, status, given_at, given_by)
           values ($1, $2, $3, $4, $5, $6)`,
          [treatmentId, k, at, status, given.has(k) ? new Date() : null, given.has(k) ? ids.users?.[Object.keys(ids.users)[0]]?.id ?? null : null]
        );
      }
    }
    ids.treatments[h.ref] = treatmentIds;
  }
  for (const s of body.stock ?? []) {
    const clinicId = ref(ids.clinics, s.clinic, 'stock.clinic');
    const r = await q(
      `insert into stock_items (clinic_id, name, reorder_point, unit_price_pence) values ($1, $2, $3, $4) returning id`,
      [clinicId, s.name, s.reorderPoint ?? 0, s.unitPricePence ?? 0]
    );
    const itemId = r.rows[0].id;
    ids.stock[s.ref] = itemId;
    const batches = s.batches ?? [{ batch: 'OPENING', expiresOn: '2099-12-31', quantity: s.onHand }];
    let order = 0;
    for (const b of batches) {
      const br = await q(
        `insert into stock_batches (item_id, batch, expires_on, received_order) values ($1, $2, $3, $4) returning id`,
        [itemId, b.batch, b.expiresOn, order++]
      );
      const bal = await one(
        `select coalesce(sum(m.delta),0)::int as b from stock_movements m
         join stock_batches b2 on b2.id = m.batch_id where b2.item_id = $1`,
        [itemId]
      );
      await q(
        `insert into stock_movements (item_id, batch_id, delta, reason, balance_after)
         values ($1, $2, $3, 'receive', $4)`,
        [itemId, br.rows[0].id, b.quantity, bal.b + b.quantity]
      );
    }
  }
  for (const inv of body.invoices ?? []) {
    const clinicId = ref(ids.clinics, inv.clinic, 'invoices.clinic');
    const patientId = ref(ids.patients, inv.patient, 'invoices.patient');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const seq = await client.query(
        `update clinics set invoice_seq = invoice_seq + 1 where id = $1 returning invoice_seq`,
        [clinicId]
      );
      const number = `INV-${String(seq.rows[0].invoice_seq).padStart(4, '0')}`;
      const created = await client.query(
        `insert into invoices (clinic_id, patient_id, number, status, discount_percent)
         values ($1, $2, $3, 'draft', $4) returning id`,
        [clinicId, patientId, number, inv.discountPercent ?? 0]
      );
      const invoiceId = created.rows[0].id;
      ids.invoices[inv.ref] = invoiceId;
      const { lineAmounts } = await import('../domain/money.js');
      for (const line of inv.lines ?? []) {
        const itemId = ref(ids.stock, line.stock, 'invoices.lines.stock');
        const item = await one(`select * from stock_items where id = $1`, [itemId]);
        const amounts = lineAmounts(line.quantity, item.unit_price_pence, inv.discountPercent ?? 0);
        const pos = await one(
          `select coalesce(max(position),0)::int + 1 as p from invoice_lines where invoice_id = $1`,
          [invoiceId]
        );
        const lineR = await client.query(
          `insert into invoice_lines (invoice_id, stock_item_id, description, quantity, unit_price_pence,
            net_pence, discount_pence, vat_pence, total_pence, position)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
          [invoiceId, itemId, item.name, line.quantity, item.unit_price_pence, amounts.net, amounts.discount,
           amounts.vat, amounts.total, pos.p]
        );
        // draw stock FEFO as normal
        const { drawStock } = await import('./invoices.js');
        await drawStock(clinicId, itemId, line.quantity);
      }
      if ((inv.lines ?? []).length > 0 && inv.status && inv.status !== 'draft') {
        await client.query(`update invoices set status = $1 where id = $2`, [inv.status, invoiceId]);
      }
      await client.query('commit');
      for (const pay of inv.payments ?? []) {
        const takerId = pay.by
          ? ref(
              { ...Object.fromEntries(Object.entries(ids.users).map(([k, v]) => [k, (v as any).id])) },
              pay.by,
              'invoices.payments.by'
            )
          : await firstDeskOrManager(clinicId);
        const invoice = await one(`select * from invoices where id = $1`, [invoiceId]);
        await q(
          `insert into invoice_payments (invoice_id, pence, taken_by, at) values ($1, $2, $3, $4)`,
          [invoiceId, pay.pence, takerId, clockNow()]
        );
        const payload = await import('./invoices.js').then((m) => m.invoicePayload(invoiceId, clinicId));
        const newBalance = payload.balancePence - pay.pence;
        await q(
          `update invoices set status = $1 where id = $2`,
          [newBalance <= 0 ? 'paid' : 'part-paid', invoiceId]
        );
        void invoice;
      }
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
  return { status: 201, body: ids };
}));

async function firstDeskOrManager(clinicId: string): Promise<string | null> {
  const row = await one(
    `select id from users where clinic_id = $1 and role in ('front-desk','manager') and status = 'Active'
     order by created_at limit 1`,
    [clinicId]
  );
  return row?.id ?? null;
}

function loginUrl(req: express.Request, token: string): string {
  const origin = settings.appPublicUrl
    ? settings.appPublicUrl.replace(/\/$/, '')
    : `${req.protocol}://${req.headers.host || `127.0.0.1:${settings.appPublicPort ?? 4173}`}`;
  return `${origin}/auth/link/${token}`;
}

export default router;
