// The visit page: what a token may read and do. Only the published fields leave this module.

import type { VisitView } from "../shared/api";
import { localDate, wholeSeconds } from "../shared/time";
import { one, pool } from "./db";
import { alreadyCollected, requireCollectable, requireNotCollected, visitPageHasEnded } from "./drawStates";
import { drawRow, visitName, type DrawRow } from "./draws";
import { ApiError, invalid, notFound } from "./errors";
import { text, type JsonBody } from "./fields";
import { kitCodeRefusal, normalizeKitCode } from "./kitCodes";
import { liveMemberOr404, type LiveMember } from "./members";

interface LocatedVisit {
  draw: DrawRow;
  member: LiveMember;
  endsAt: Date;
}

export async function locateVisit(token: string): Promise<LocatedVisit> {
  const page = await one<{ draw_id: string; ends_at: Date; ended_at: Date | null }>(
    pool,
    "SELECT draw_id, ends_at, ended_at FROM visit_pages WHERE token = $1",
    [token],
  );
  if (!page) throw notFound();
  if (visitPageHasEnded(page.ended_at, page.ends_at, new Date())) {
    throw new ApiError(410, "visit_page_ended", "This visit page has ended.");
  }
  const draw = await drawRow(pool, page.draw_id);
  if (!draw) throw notFound();
  return { draw, member: await liveMemberOr404(draw.member_id), endsAt: page.ends_at };
}

function isDrawDay(draw: DrawRow, now: Date): boolean {
  return localDate(now, draw.time_zone) === draw.local_date;
}

export function visitView({ draw, member, endsAt }: LocatedVisit, now: Date): VisitView {
  const today = isDrawDay(draw, now);
  return {
    memberName: visitName(draw.member_name),
    startsAt: wholeSeconds(draw.starts_at),
    localDate: draw.local_date,
    localTime: draw.local_time,
    timeZone: draw.time_zone,
    isDrawDay: today,
    address: today && member.address_line1 !== null
      ? {
          line1: member.address_line1,
          line2: member.address_line2 ?? "",
          city: member.city ?? "",
          state: member.state,
          postalCode: member.postal_code ?? "",
        }
      : null,
    gateNotes: today ? member.gate_notes : null,
    kitCodes: draw.kit_codes,
    state: draw.state === "booked" ? "booked" : "collected",
    collectedAt: draw.collected_at ? wholeSeconds(draw.collected_at) : null,
    endsAt: wholeSeconds(endsAt),
  };
}

export async function addKitCode(draw: DrawRow, body: JsonBody): Promise<{ status: number; kitCodes: string[] }> {
  const input = text(body, "kitCode");
  const refusal = kitCodeRefusal(input);
  if (refusal) throw invalid({ kitCode: refusal });
  requireNotCollected(draw);
  const code = normalizeKitCode(input);
  if (draw.kit_codes.includes(code)) return { status: 200, kitCodes: draw.kit_codes };
  const updated = await one<{ kit_codes: string[] }>(
    pool,
    "UPDATE draws SET kit_codes = array_append(kit_codes, $2) WHERE id = $1 AND state = 'booked' AND NOT ($2 = ANY(kit_codes)) RETURNING kit_codes",
    [draw.id, code],
  );
  if (!updated) {
    // The guard also misses when a concurrent request added this same code first.
    const fresh = await drawRow(pool, draw.id);
    if (fresh?.kit_codes.includes(code)) return { status: 200, kitCodes: fresh.kit_codes };
    throw alreadyCollected();
  }
  return { status: 201, kitCodes: updated.kit_codes };
}

export async function markCollected(draw: DrawRow, now: Date): Promise<Date> {
  requireCollectable(draw, isDrawDay(draw, now));
  const collected = await one(pool, "UPDATE draws SET state = 'collected', collected_at = $2 WHERE id = $1 AND state = 'booked' RETURNING id", [draw.id, now]);
  if (!collected) throw alreadyCollected();
  return now;
}
