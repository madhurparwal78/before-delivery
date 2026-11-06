import { jsonOk, type Ctx } from './http.js';
import { resolveWorkspace } from './auth.js';


export async function health(): Promise<Response> {
  return jsonOk({ status: 'ok' });
}

export async function workspaceGet(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const today = ws.time_zone === 'Europe/Vilnius' ? vilniusToday() : singaporeToday();
  return jsonOk({
    workspace: {
      slug: ws.slug,
      name: ws.name,
      legalName: ws.legal_name,
      lei: ws.lei,
      jurisdictionCode: ws.jurisdiction_code,
      timeZone: ws.time_zone,
      city: ws.city,
      currency: ws.currency,
      confirmationLimitCents: Number(ws.confirmation_limit_cents),
      today,
      now: `${new Date().toISOString().slice(0, 19)}Z`,
    },
  });
}

function vilniusToday(): string {
  return businessDate(new Date(), 'Europe/Vilnius');
}

function singaporeToday(): string {
  return businessDate(new Date(), 'Asia/Singapore');
}

function businessDate(date: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

