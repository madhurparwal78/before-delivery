import { query } from '../db.js';
import { errors } from './errors.js';
import { jsonOk, parseJsonBody, requireJsonContentType, type Ctx } from './http.js';
import { resolveWorkspace } from './auth.js';
import { isStr, invalid, businessDateInZone, formatInstant, localMidnightUtc, hoursBetween } from './helpers.js';

export async function getListing(ctx: Ctx): Promise<Response> {
  await resolveWorkspace(ctx);
  const r = await query('SELECT slug, listed FROM listings WHERE workspace_slug = $1', [ctx.params.slug]);
  if (r.rows.length === 0) throw errors.notFound();
  return jsonOk({ listing: { slug: r.rows[0].slug, listed: r.rows[0].listed } });
}

export async function putListing(ctx: Ctx): Promise<Response> {
  await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  const body = parseJsonBody(await ctx.rawBody());
  if (typeof body.listed !== 'boolean') invalid({ listed: 'Choose whether the listing is published.' });
  const r = await query('SELECT slug, listed FROM listings WHERE workspace_slug = $1', [ctx.params.slug]);
  if (r.rows.length === 0) throw errors.notFound();
  await query('UPDATE listings SET listed = $1 WHERE workspace_slug = $2', [body.listed === true, ctx.params.slug]);
  return jsonOk({ listing: { slug: r.rows[0].slug, listed: body.listed === true } });
}

const RULES_ROLES_READ = ['compliance_officer', 'compliance_analyst', 'operations_lead', 'finance_lead', 'support_agent'];

function workspaceRuleView(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    currency: r.currency,
    ruleInForce: r.threshold_cents === null || r.in_force_since === null ? null : { thresholdCents: Number(r.threshold_cents), since: r.in_force_since },
    changes: r.changes === undefined || r.changes === null ? [] : (r.changes as Record<string, unknown>[]),
  }));
}

async function loadWorkspaceRules(slug: string): Promise<Record<string, unknown>[]> {
  const rules = await query(
    `SELECT j.code, j.name, j.currency, w.threshold_cents, to_char(w.in_force_since, 'YYYY-MM-DD') AS in_force_since,
            coalesce((SELECT json_agg(json_build_object('id', rc.id, 'thresholdCents', rc.threshold_cents, 'takesEffectOn', to_char(rc.takes_effect_on, 'YYYY-MM-DD'),
                    'takesEffectAt', to_char(rc.takes_effect_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                    'announcedBy', rc.announced_by, 'announcedAt', to_char(rc.announced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                    'state', rc.state) ORDER BY rc.takes_effect_on)
              FROM rule_changes rc WHERE rc.workspace_slug = w.workspace_slug AND rc.jurisdiction_code = w.jurisdiction_code), '[]') AS changes
     FROM workspace_rules w JOIN jurisdictions j ON j.code = w.jurisdiction_code
     WHERE w.workspace_slug = $1 ORDER BY j.code`,
    [slug],
  );
  return rules.rows as unknown as Record<string, unknown>[];
}

export async function listRules(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const rules = await loadWorkspaceRules(ws.slug);
  return jsonOk({ jurisdictions: workspaceRuleView(rules) });
}

export async function getRule(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const rules = await loadWorkspaceRules(ws.slug);
  const found = rules.find((r) => r.code === ctx.params.code);
  if (found === undefined) throw errors.notFound();
  return jsonOk({ jurisdiction: workspaceRuleView([found])[0] });
}

export async function announceChange(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  const body = parseJsonBody(await ctx.rawBody());
  const fields: Record<string, string> = {};
  const jurisdictionCode = isStr(body.jurisdictionCode) ? body.jurisdictionCode : '';
  const thresholdCents = typeof body.thresholdCents === 'number' && Number.isInteger(body.thresholdCents) ? body.thresholdCents : null;
  const takesEffectOn = isStr(body.takesEffectOn) ? body.takesEffectOn : '';
  if (jurisdictionCode === '' || !(await jurisdictionInBook(ws.slug, jurisdictionCode))) fields.jurisdictionCode = 'Choose a jurisdiction.';
  if (thresholdCents === null || thresholdCents < 0) fields.thresholdCents = 'Enter a threshold of 0 or more.';
  const today = businessDateInZone(new Date(), ws.time_zone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(takesEffectOn) || takesEffectOn < today) fields.takesEffectOn = 'Choose today or a later date.';
  if (Object.keys(fields).length > 0) invalid(fields);

  const existing = await query('SELECT id FROM rule_changes WHERE workspace_slug = $1 AND jurisdiction_code = $2 AND takes_effect_on = $3', [ws.slug, jurisdictionCode, takesEffectOn]);
  if (existing.rows.length > 0) throw errors.conflict('change_exists', `A change for ${await jurisdictionName(jurisdictionCode)} on ${takesEffectOn} is already announced.`);

  const now = new Date();
  const takesEffectAt = takesEffectOn === today ? now : localMidnightUtc(takesEffectOn, ws.time_zone);
  const id = `rc-${Math.random().toString(36).slice(2, 12)}`;
  await withTx(async (q) => {
    await q('INSERT INTO rule_changes (id, workspace_slug, jurisdiction_code, threshold_cents, takes_effect_on, takes_effect_at, announced_by, announced_at, state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, ws.slug, jurisdictionCode, thresholdCents !== null ? BigInt(thresholdCents) : 0n, takesEffectOn, takesEffectAt, ctx.session?.name ?? '', now, takesEffectOn === today ? 'in_force' : 'scheduled']);
    if (takesEffectOn === today) {
      await q('UPDATE workspace_rules SET threshold_cents = $1, in_force_since = $2, change_threshold_cents = NULL, change_takes_effect_on = NULL WHERE workspace_slug = $3 AND jurisdiction_code = $4',
        [thresholdCents !== null ? BigInt(thresholdCents) : 0n, takesEffectOn, ws.slug, jurisdictionCode]);
    } else {
      await q('UPDATE workspace_rules SET change_threshold_cents = $1, change_takes_effect_on = $2 WHERE workspace_slug = $3 AND jurisdiction_code = $4',
        [thresholdCents !== null ? BigInt(thresholdCents) : 0n, takesEffectOn, ws.slug, jurisdictionCode]);
    }
  });
  const change = await query<{ id: string; threshold_cents: string; takes_effect_on: string; takes_effect_at: Date; announced_by: string; announced_at: Date; state: string }>(`SELECT id, threshold_cents, to_char(takes_effect_on, 'YYYY-MM-DD') AS takes_effect_on, takes_effect_at, announced_by, announced_at, state FROM rule_changes WHERE id = $1`, [id]);
  const row = change.rows[0];
  return jsonOk({
    change: {
      id: row.id,
      thresholdCents: Number(row.threshold_cents),
      takesEffectOn: row.takes_effect_on,
      takesEffectAt: formatInstant(row.takes_effect_at),
      announcedBy: row.announced_by,
      announcedAt: formatInstant(row.announced_at),
      state: row.state,
    },
  }, 201);
}

async function jurisdictionInBook(slug: string, code: string): Promise<boolean> {
  const r = await query('SELECT 1 FROM workspace_rules WHERE workspace_slug = $1 AND jurisdiction_code = $2', [slug, code]);
  return r.rows.length > 0;
}

async function jurisdictionName(code: string): Promise<string> {
  const r = await query<{ name: string }>('SELECT name FROM jurisdictions WHERE code = $1', [code]);
  return r.rows[0]?.name ?? code;
}

export async function dailyReport(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const date = ctx.query.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid({ date: 'Choose a business date.' });
  const startsAt = localMidnightUtc(date, ws.time_zone);
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextDate = `${next.getUTCFullYear()}-${(next.getUTCMonth() + 1).toString().padStart(2, '0')}-${next.getUTCDate().toString().padStart(2, '0')}`;
  const endsAt = localMidnightUtc(nextDate, ws.time_zone);
  const cases = await query<{ reference: string; created_at: Date; asset: string; amount_digits: string; amount_scale: number; fiat_value_cents: string; currency: string; decided_threshold_cents: string | null; decided_counterparty_name: string | null; path: string; status: string }>(
    `SELECT reference, created_at, asset, amount_digits, amount_scale, fiat_value_cents, currency, decided_threshold_cents, decided_counterparty_name, path, status
     FROM cases WHERE workspace_slug = $1 AND created_at >= $2 AND created_at < $3 AND archived = false ORDER BY created_at, reference`,
    [ws.slug, startsAt, endsAt],
  );
  const { amountString } = await import('../domain/case-body.js');
  return jsonOk({
    date,
    timeZone: ws.time_zone,
    startsAt: formatInstant(startsAt),
    endsAt: formatInstant(endsAt),
    hours: hoursBetween(startsAt, endsAt),
    transfers: cases.rows.length,
    cases: cases.rows.map((c) => ({
      reference: c.reference,
      createdAt: formatInstant(c.created_at),
      asset: c.asset,
      amount: amountString(c.amount_digits, c.amount_scale),
      fiatValueCents: Number(c.fiat_value_cents),
      currency: c.currency,
      thresholdCents: c.decided_threshold_cents === null ? null : Number(c.decided_threshold_cents),
      counterpartyName: c.decided_counterparty_name,
      path: c.path,
      status: c.status,
    })),
  });
}

export async function rates(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const r = await query(`SELECT asset, currency, rate_cents, to_char(in_force_since, 'YYYY-MM-DD') AS in_force_since FROM rates WHERE currency = $1 ORDER BY asset`, [ws.currency]);
  return jsonOk({ rates: r.rows.map((row) => ({ asset: row.asset, currency: row.currency, rateCents: Number(row.rate_cents), inForceSince: row.in_force_since })) });
}

async function withTx(fn: (q: (sql: string, params?: readonly unknown[]) => Promise<unknown>) => Promise<void>): Promise<void> {
  const { withTransaction } = await import('../db.js');
  await withTransaction(async (q) => {
    await fn(async (sql: string, params: readonly unknown[] = []) => {
      await q(sql, params);
    });
  });
}

export { RULES_ROLES_READ };
