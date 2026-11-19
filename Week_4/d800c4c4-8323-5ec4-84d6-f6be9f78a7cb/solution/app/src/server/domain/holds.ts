// Holds: queue position on every read, and promotion of the first active queued hold.
import type pg from "pg";
import { rows } from "../db.js";
import { queueMail } from "../providers/mail.js";
import { firstOpenDayFrom, today, type Calendar } from "./calendar.js";
import { membershipStatus, type MembershipRow } from "./membership.js";
import { weekdayOf } from "./time.js";

/** Queued holds numbered 1..n per tool, in `placed_at` order with ties broken by hold id. */
export const HOLD_POSITIONS = `SELECT id, row_number() OVER (PARTITION BY item_id ORDER BY placed_at, id)::int AS position
  FROM holds WHERE status = 'queued'`;

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Makes the tool's first queued hold whose member is active ready, with exactly one hold-ready email.
 * Runs inside the transaction that frees the tool, with the tool's row locked. */
export async function promoteNextHold(client: pg.PoolClient, itemId: number, calendar: Calendar, now: number): Promise<void> {
  const waiting = await rows<MembershipRow & { id: number; email: string; name: string; status_ready: number }>(
    client,
    `SELECT h.id, u.email, u.name, m.tier, m.status, m.ends_at_term, m.active_until,
            (SELECT count(*) FROM holds r WHERE r.item_id = h.item_id AND r.status = 'ready') AS status_ready
     FROM holds h JOIN (${HOLD_POSITIONS}) q ON q.id = h.id JOIN users u ON u.id = h.member_id
     JOIN memberships m ON m.user_id = h.member_id
     WHERE h.item_id = $1 ORDER BY q.position`,
    [itemId],
  );
  if (waiting.length === 0 || waiting[0]!.status_ready > 0) return;
  const day = today(calendar, now);
  const next = waiting.find((hold) => membershipStatus(hold, day) === "active");
  if (!next) return;
  await client.query(`UPDATE holds SET status = 'ready' WHERE id = $1`, [next.id]);
  const [item] = await rows<{ name: string; tag: string }>(client, `SELECT name, tag FROM items WHERE id = $1`, [itemId]);
  const openDay = firstOpenDayFrom(calendar, day);
  const hours = calendar.hours.get(weekdayOf(openDay))!;
  await queueMail(
    client,
    next.email,
    `Your hold is ready: ${item!.name} (${item!.tag})`,
    [
      `Hello ${next.name},`,
      "",
      `Your hold on ${item!.name} (${item!.tag}) is ready. It was hung back on ${day}.`,
      `Collect it on the next open day, ${capitalised(weekdayOf(openDay))} ${openDay}, between ${hours.opens} and ${hours.closes}.`,
      "",
      "Pegworth Desk",
    ].join("\n"),
  );
}
