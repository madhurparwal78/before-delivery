import { makeDeriver } from '../db/repo';
import { buildYearDocument } from '../domain/documents';
import { addDays } from '../domain/time';
import { fail } from '../errors';
import { ApiResponse, Ctx } from '../http/context';
import { notModified } from '../http/protocol';

export async function getYear(ctx: Ctx): Promise<ApiResponse> {
  const raw = ctx.params.year as string;
  if (!/^\d{4}$/.test(raw)) fail('not_found');
  const year = Number.parseInt(raw, 10);
  if (year < 2000 || year > 2100) fail('not_found');
  const deriver = await makeDeriver(ctx.home.id);
  const document = buildYearDocument(ctx.home.id, year, deriver);
  const etag = `"${document.digest}"`;
  if (notModified(ctx, etag)) return { status: 304, headers: { ETag: etag } };
  return {
    status: 200,
    body: document.bytes,
    headers: { ETag: etag, 'Content-Type': 'application/json; charset=utf-8' },
  };
}

export async function getTonight(ctx: Ctx): Promise<ApiResponse> {
  const deriver = await makeDeriver(ctx.home.id);
  const today = await ctx.today();
  const tonight = deriver.night(today);
  let nextHandover: { at: string; zone: string; from: string | null; to: string | null } | null = null;
  for (let shift = 0; shift <= 60; shift += 1) {
    const handover = deriver.handoverOn(addDays(today, shift));
    if (handover && handover.epochMs > ctx.now) {
      nextHandover = { at: handover.at, zone: handover.zone, from: handover.from, to: handover.to };
      break;
    }
  }
  return {
    status: 200,
    json: {
      date: today,
      owner: tonight.owner,
      ruleName: tonight.ruleName,
      nextHandover,
    },
  };
}
