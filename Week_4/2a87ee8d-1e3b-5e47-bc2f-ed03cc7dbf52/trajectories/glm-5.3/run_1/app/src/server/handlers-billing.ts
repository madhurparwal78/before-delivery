/** Billing and recap endpoints. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { FIELD_MESSAGES as FM } from './errors.js';
import { ApiError, sendJson } from './http.js';
import type { PlanCode, TermCode } from '../domain.js';
import { validOpId, opIdError, withReplay, bodyHashOf } from './ops.js';
import { refreshMirror, readMirror, billingObject, changeIsImmediate, ensureFacilitatorAccount } from './billing.js';
import { centsToAmount } from './money.js';
import { requireFacilitator, workshopForFacilitator, readJsonBody, usageFor, type Ctx } from './context.js';
import type { Workshop } from './db.js';

export async function handleBillingGet(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const fac = await requireFacilitator(req, ctx.db);
  await ctx.db.tx((c) => refreshMirror(ctx.kb, ctx.cfg, c, fac)).catch(() => undefined);
  const mirror = await ctx.db.tx((c) => readMirror(c, fac.id));
  if (!mirror) throw new ApiError(404, 'not_found');
  const usage = await usageFor(ctx.db, fac);
  sendJson(res, 200, billingObject(mirror, usage));
}

export async function handlePlanChange(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const fac = await requireFacilitator(req, ctx.db);
  const body = await readJsonBody(req);
  if (!validOpId(body.clientOpId)) throw opIdError();
  const plan = body.plan as PlanCode | undefined;
  const term = body.term as TermCode | undefined;
  const fields: Record<string, string> = {};
  if (plan !== 'free' && plan !== 'studio' && plan !== 'agency') fields.plan = FM.fallback;
  if (term !== 'monthly' && term !== 'annual') fields.term = FM.fallback;
  if (plan === 'free' && term === 'annual') fields.term = FM.termFreeAnnual;
  if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation', { fields });

  const result = await ctx.db.tx(async (c) => withReplay(c, {
    actorType: 'facilitator', actorId: fac.id, clientOpId: body.clientOpId as string,
    method: 'POST', path: '/api/billing/plan', bodyHash: bodyHashOf(body),
  }, null, async () => {
    const mirror = await readMirror(c, fac.id);
    if (!mirror) throw new ApiError(404, 'not_found');
    const currentPlan = mirror.plan;
    const currentTerm = mirror.term;
    const immediate = changeIsImmediate(currentPlan, currentTerm, plan as PlanCode, term as TermCode);
    // choosing the current plan with a pending change cancels it; without one it is plan_unchanged
    const pendingCancels: boolean = plan === currentPlan && term === currentTerm && mirror.pendingChange !== null;
    if (plan === currentPlan && term === currentTerm && mirror.pendingChange === null && !pendingCancels) {
      throw new ApiError(409, 'plan_unchanged');
    }
    // read-only workspaces may still change plan? No: billing actions stay allowed.
    let outcome: Awaited<ReturnType<typeof applyPlanChange>>;
    try {
      outcome = await applyPlanChange(ctx, c, fac, mirror.plan, mirror.term, plan as PlanCode, term as TermCode, immediate);
    } catch (e) {
      console.error('[plan] apply threw first:', e instanceof Error ? e.message : e);
      throw e;
    }
    if (!outcome.ok) throw new ApiError(503, 'billing_unavailable');
    const updated = await readMirror(c, fac.id);
    const usage = await usageFor(ctx.db, fac);
    const billing = billingObject(updated as never, usage);
    return { status: 200, body: { billing, invoice: outcome.invoice } };
  }));
  sendJson(res, result.status, result.body);
}

async function applyPlanChange(
  ctx: Ctx, c: { query: (s: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; },
  fac: { id: string; email: string; name: string; time_zone: string },
  fromPlan: PlanCode, fromTerm: TermCode, toPlan: PlanCode, toTerm: TermCode, immediate: boolean,
): Promise<{ ok: false } | { ok: true; invoice: Record<string, unknown> | null }> {
  const key = `facilitator:${fac.email}`;
  const kb = ctx.kb;
  try {
    let accountId = (await c.query('select kb_account_id from billing_mirror where facilitator_id = $1', [fac.id])).rows[0] as { kb_account_id: string | null };
    if (!accountId?.kb_account_id) {
      const id = await ensureFacilitatorAccount(kb, fac, fromPlan, fromTerm);
      await c.query('update billing_mirror set kb_account_id = $2 where facilitator_id = $1', [fac.id, id]);
      accountId = { kb_account_id: id };
    }

    if (!accountId.kb_account_id) return { ok: false };
    const subs = await kb.getSubscriptions(accountId.kb_account_id);
    const sub = subs.find((s) => s.state === 'ACTIVE') ?? subs[0];
    if (!sub) return { ok: false };
    const invoiceIdsBefore = new Set((await kb.getInvoicesWithItems(accountId.kb_account_id ?? '')).map((i) => i.invoiceId));
    await kb.changePlan(sub.subscriptionId, `${toPlan}-${toTerm}`);
    if (!immediate) {
      // scheduled: refresh the mirror to pick up the pending change
      await refreshMirror(kb, ctx.cfg, c as never, fac);
      await c.query(
        `insert into activity (id, facilitator_id, actor, action) values ($1,$2,'facilitator','plan.change_scheduled')`,
        [`act_sched_${fac.id}_${Date.now()}`, fac.id]);
      return { ok: true, invoice: null };
    }
    // immediate: wait for Kill Bill's prorated invoice
    let newInvoice = null as null | { invoiceId: string; invoiceNumber: string; amount: number; invoiceDate: string; balance: number };
    for (let i = 0; i < 10 && !newInvoice; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const all = await kb.getInvoicesWithItems(accountId.kb_account_id ?? '');
      const found = all.find((inv) => !invoiceIdsBefore.has(inv.invoiceId));
      if (found) newInvoice = found;
    }
    if (!newInvoice) {
      // no invoice (for example Free), just refresh
      await refreshMirror(kb, ctx.cfg, c as never, fac);
      return { ok: true, invoice: null };
    }
    await c.query(
      `insert into kb_invoices (id, facilitator_id, number, date, cents, balance_cents, currency, status)
       values ($1,$2,$3,$4,$5,$6,'EUR',$7) on conflict (id) do update set balance_cents = $6`,
      [newInvoice.invoiceId, fac.id, String(newInvoice.invoiceNumber), newInvoice.invoiceDate,
        Math.round(newInvoice.amount * 100), Math.round(newInvoice.balance * 100),
        newInvoice.balance > 0 ? 'unpaid' : 'paid']);
    await refreshMirror(kb, ctx.cfg, c as never, fac);
    await c.query(
      `insert into activity (id, facilitator_id, actor, action) values ($1,$2,'facilitator','plan.changed')`,
      [`act_plan_${fac.id}_${Date.now()}`, fac.id]);
    void key;
    return {
      ok: true,
      invoice: {
        id: newInvoice.invoiceId,
        number: String(newInvoice.invoiceNumber),
        date: newInvoice.invoiceDate,
        amount: centsToAmount(Math.round(newInvoice.amount * 100)),
        balance: centsToAmount(Math.round(newInvoice.balance * 100)),
        currency: 'EUR',
        status: newInvoice.balance > 0 ? 'unpaid' : 'paid',
      },
    };
  } catch (e) {
    console.error('[billing] plan change failed', e instanceof Error ? e.message : e);
    return { ok: false };
  }
}

export async function handleRetryPayment(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const fac = await requireFacilitator(req, ctx.db);
  const body = await readJsonBody(req);
  if (!validOpId(body.clientOpId)) throw opIdError();
  const result = await ctx.db.tx(async (c) => withReplay(c, {
    actorType: 'facilitator', actorId: fac.id, clientOpId: body.clientOpId as string,
    method: 'POST', path: '/api/billing/payments', bodyHash: bodyHashOf(body),
  }, null, async () => {
    const mirror = await readMirror(c, fac.id);
    if (!mirror) throw new ApiError(404, 'not_found');
    const unpaid = mirror.invoices.filter((i) => i.balanceCents > 0);
    if (unpaid.length === 0) throw new ApiError(409, 'nothing_due');
    const kbAccountId = (await c.query('select kb_account_id from billing_mirror where facilitator_id = $1', [fac.id])).rows[0] as { kb_account_id: string | null };
    if (!kbAccountId?.kb_account_id) {
      const id = await ensureFacilitatorAccount(ctx.kb, fac, mirror.plan, mirror.term);
      await c.query('update billing_mirror set kb_account_id = $2 where facilitator_id = $1', [fac.id, id]);
      kbAccountId.kb_account_id = id;
    }
    try {
      for (const inv of unpaid) {
        await ctx.kb.payInvoice((kbAccountId.kb_account_id ?? '') as string, inv.id, inv.balanceCents, `retry-${inv.id}-${String(body.clientOpId)}`);
        await c.query('update kb_invoices set balance_cents = 0, status = $2 where id = $1', [inv.id, 'paid']);
      }
    } catch {
      throw new ApiError(503, 'billing_unavailable');
    }
    await refreshMirror(ctx.kb, ctx.cfg, c, fac);
    await c.query(`insert into activity (id, facilitator_id, actor, action) values ($1,$2,'facilitator','payment.retried')`,
      [`act_pay_${fac.id}_${Date.now()}`, fac.id]);
    const updated = await readMirror(c, fac.id);
    const usage = await usageFor(ctx.db, fac);
    return { status: 200, body: { billing: billingObject(updated as never, usage) } };
  }));
  sendJson(res, result.status, result.body);
}

// ---- recaps

export async function handleRecapGet(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const fac = await requireFacilitator(req, ctx.db);
  await workshopForFacilitator(ctx.db, workshopId, fac);
  const w = await ctx.db.row<Workshop>('select * from workshops where id = $1', [workshopId]);
  if (!w) throw new ApiError(404, 'not_found');
  if (w.status !== 'closed' && w.status !== 'archived') throw new ApiError(409, 'not_closed');
  const recap = await ctx.db.row<{ status: string; reason: string | null; attempts: number; files_stored_at: Date | null; email_sent_at: Date | null; recipients: number | null; recap_token: string; scale: number; sponsor_invoice_id: string | null }>(
    'select * from recaps where workshop_id = $1', [workshopId]);
  if (!recap) throw new ApiError(409, 'not_closed');
  let invoice: Record<string, unknown> | null = null;
  if (recap.sponsor_invoice_id) {
    const inv = await ctx.db.row<{ id: string; number: string; cents: number }>('select * from kb_invoices where id = $1', [recap.sponsor_invoice_id]);
    if (inv) invoice = { id: inv.id, number: inv.number, amount: centsToAmount(inv.cents), currency: 'EUR' };
  }
  sendJson(res, 200, {
    status: recap.status,
    reason: recap.reason,
    attempts: recap.attempts,
    filesStoredAt: recap.files_stored_at?.toISOString() ?? null,
    emailSentAt: recap.email_sent_at?.toISOString() ?? null,
    recipients: recap.recipients,
    recapUrl: `${ctx.cfg.publicBaseUrl}/recap/${recap.recap_token}`,
    scale: recap.scale,
    invoice,
  });
}

export async function handleRecapPublic(req: IncomingMessage, res: ServerResponse, ctx: Ctx, token: string): Promise<void> {
  const recap = await ctx.db.row<{ workshop_id: string; status: string; reason: string | null; sponsor_invoice_id: string | null; file_list: string; recap_token: string }>(
    'select * from recaps where recap_token = $1', [token]);
  if (!recap) throw new ApiError(404, 'not_found');
  const w = await ctx.db.row<Workshop>('select * from workshops where id = $1', [recap.workshop_id]);
  if (!w) throw new ApiError(404, 'not_found');
  const fac = await ctx.db.row<{ time_zone: string }>('select time_zone from facilitators where id = $1', [w.facilitator_id]);
  const state = await ctx.db.tx((c) => import('./board.js').then((mod) => mod.loadBoard(c, w.id)));
  if (!state) throw new ApiError(404, 'not_found');
  const visibleFrames = state.frames.filter((f) => f.trashed_at === null);
  const visibleIds = new Set(visibleFrames.map((f) => f.id));
  const totals = (await import('./board.js')).dotTotals(state.dots);
  const included = state.notes.filter((n) => n.revealed && !n.facilitator_only && visibleIds.has(n.frame_id));
  const ranked = state.clusters
    .filter((cl) => visibleIds.has(cl.frame_id))
    .map((cl) => ({
      cluster: cl,
      total: totals.get(cl.id)?.total ?? 0,
      notes: included.filter((n) => n.cluster_id === cl.id).sort((a, b) => a.placement_index - b.placement_index).map((n) => n.text ?? '[image]'),
    }))
    .sort((a, b) => {
      if (a.total !== b.total) return b.total - a.total;
      const fa = visibleFrames.find((f) => f.id === a.cluster.frame_id)?.position ?? 0;
      const fb = visibleFrames.find((f) => f.id === b.cluster.frame_id)?.position ?? 0;
      if (fa !== fb) return fa - fb;
      return a.cluster.title.toLowerCase() < b.cluster.title.toLowerCase() ? -1 : 1;
    });
  let invoice: Record<string, unknown> | null = null;
  if (recap.sponsor_invoice_id) {
    const inv = await ctx.db.row<{ number: string; cents: number }>('select * from kb_invoices where id = $1', [recap.sponsor_invoice_id]);
    if (inv) invoice = { number: inv.number, amount: centsToAmount(inv.cents), currency: 'EUR' };
  }
  const filesRaw = recap.file_list;
  const files: Array<{ name: string; label: string; contentType: string }> = Array.isArray(filesRaw)
    ? filesRaw
    : JSON.parse(String(filesRaw || '[]'));
  sendJson(res, 200, {
    workshop: {
      title: w.title,
      scheduledStart: w.scheduled_start,
      scheduledEnd: w.scheduled_end,
      timeZone: fac?.time_zone ?? 'UTC',
    },
    status: recap.status,
    reason: recap.reason,
    invoice,
    files: files.map((f) => ({ name: f.name, label: f.label, url: `/api/recaps/${recap.recap_token}/files/${f.name}`, contentType: f.contentType })),
    clusters: ranked.map((r) => ({
      frame: visibleFrames.find((f) => f.id === r.cluster.frame_id)?.title ?? '',
      title: r.cluster.title,
      dotTotal: r.total,
      notes: r.notes,
    })),
  });
}

export async function handleRecapFile(req: IncomingMessage, res: ServerResponse, ctx: Ctx, token: string, name: string): Promise<void> {
  const recap = await ctx.db.row<{ workshop_id: string; files_stored_at: Date | null }>(
    'select * from recaps where recap_token = $1', [token]);
  if (!recap) throw new ApiError(404, 'not_found');
  if (!recap.files_stored_at) throw new ApiError(409, 'recap_not_ready');
  if (!/^([a-z0-9-]+\.(pdf|csv|png))$/.test(name)) throw new ApiError(404, 'not_found');
  const { recapPdfKey, recapCsvKey, recapFrameKey } = await import('./s3.js');
  const key = name === 'board.pdf' ? recapPdfKey(recap.workshop_id)
    : name === 'notes.csv' ? recapCsvKey(recap.workshop_id)
    : recapFrameKey(recap.workshop_id, name.slice('frame-'.length, -'.png'.length));
  let bytes: Buffer;
  try {
    bytes = (await ctx.s3.getObject(key)) ?? Buffer.alloc(0);
  } catch {
    throw new ApiError(503, 'storage_unavailable');
  }
  if (bytes.length === 0) throw new ApiError(404, 'not_found');
  const contentType = name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'image/png';
  res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': String(bytes.length) });
  res.end(bytes);
}
