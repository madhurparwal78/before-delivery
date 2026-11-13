// Conflict, restriction, ration and lapse notices: written in the same database step as the decision that causes
// them, kept as `queued`, and sent by the worker. Bodies carry operator codes only.
import { tx, type Db } from "./db.ts";
import { formatMl, type Milli } from "./decimal.ts";
import { sendMail } from "./mail.ts";
import { STATUS_LABEL } from "./orderStates.ts";
import { ORDER_SELECT, type OrderRow, type WindowFigures } from "./records.ts";
import { districtInstant, isoInstant } from "./time.ts";

const CAPACITY_TAKEN =
  "Another order took the last of this window's capacity. Nothing was debited from your allocation.";

type NoticeKind = "conflict" | "restriction" | "ration" | "lapse";

async function queue(db: Db, kind: NoticeKind, windowId: string, growerId: number, subject: string, body: string): Promise<void> {
  await db.query("INSERT INTO notice (window_id, grower_id, kind, subject, body, state) VALUES ($1, $2, $3, $4, $5, 'queued')", [
    windowId, growerId, kind, subject, body,
  ]);
}

/** A `window_full` refusal as its conflict notice reports it, with the losing grower's own allocation at judgement. */
interface ConflictRefusal {
  window: WindowFigures;
  growerId: number;
  turnout: string;
  volume: Milli;
  allocationLeft: Milli;
}

export async function queueConflictNotice(db: Db, refusal: ConflictRefusal): Promise<void> {
  const w = refusal.window;
  const body = [
    CAPACITY_TAKEN,
    "",
    `Channel: ${w.channel_name}`,
    `Window: ${w.label}`,
    `Turnout: ${refusal.turnout}`,
    `Requested volume: ${formatMl(refusal.volume)} ML`,
    `Window remaining: ${formatMl(w.remaining_milli)} ML`,
    "",
    `Your allocation is unchanged at ${formatMl(refusal.allocationLeft)} ML.`,
  ].join("\n");
  await queue(db, "conflict", w.id, refusal.growerId, `Ditchbook: capacity taken on ${w.channel_name}, ${w.label}`, body);
}

/** One notice per grower with a scheduled, running or just-moved order in the window. */
export async function queueRestrictionNotices(db: Db, w: WindowFigures, effectiveAt: Date, moved: Set<string>): Promise<void> {
  const orders = await db.query<OrderRow>(`${ORDER_SELECT} WHERE o.window_id = $1 ORDER BY o.number`, [w.id]);
  const byGrower = new Map<number, OrderRow[]>();
  for (const order of orders.rows) byGrower.set(order.grower_id, [...(byGrower.get(order.grower_id) ?? []), order]);
  for (const [growerId, own] of byGrower) {
    if (!own.some((o) => o.status === "scheduled" || o.status === "running" || moved.has(o.number))) continue;
    const lines = [
      `A restriction now caps ${w.channel_name}, ${w.label}.`,
      "",
      `New cap: ${formatMl(w.effective_cap_milli)} ML/day`,
      `Effective: ${districtInstant(effectiveAt)}`,
      `Window cap volume: ${formatMl(w.cap_volume_milli)} ML`,
      `Window remaining: ${formatMl(w.remaining_milli)} ML`,
      "",
      "Your orders in this window:",
      ...own.map(
        (o) => `${o.number} | turnout ${o.turnout} | ${formatMl(o.volume_milli)} ML | ${STATUS_LABEL[o.status]} | holder ${o.holder_code}`,
      ),
      ...own
        .filter((o) => moved.has(o.number))
        .map((o) => `Order ${o.number} no longer fits and is back in requested. Its volume is back in your allocation.`),
    ];
    await queue(db, "restriction", w.id, growerId, `Ditchbook restriction: ${w.channel_name}, ${w.label}`, lines.join("\n"));
  }
}

/** One candidate of a ration: its share and recomputed rate, or null when its share was 0.000. */
export interface RationLine {
  order: OrderRow;
  share: { volume: Milli; rate: Milli } | null;
}

/** Exactly one ration notice per grower with at least one candidate, one line per candidate in order-number order. */
export async function queueRationNotices(db: Db, w: WindowFigures, lines: RationLine[]): Promise<void> {
  const byGrower = new Map<number, string[]>();
  for (const { order, share } of lines) {
    const line = share
      ? `Order ${order.number} rationed to ${formatMl(share.volume)} ML of ${formatMl(order.requested_milli)} ML at ${formatMl(share.rate)} ML/day. Gate worked by ${order.holder_code}.`
      : `Order ${order.number} stays requested. No capacity was left for it. Gate worked by ${order.holder_code}.`;
    byGrower.set(order.grower_id, [...(byGrower.get(order.grower_id) ?? []), line]);
  }
  for (const [growerId, own] of byGrower) {
    const body = [`Demand outran ${w.channel_name}, ${w.label}, so its remaining capacity was shared in proportion to what each grower asked.`, "", ...own];
    await queue(db, "ration", w.id, growerId, `Ditchbook ration: ${w.channel_name}, ${w.label}`, body.join("\n"));
  }
}

/** An order closed by the lapse, with the status it lapsed from. */
export interface LapsedOrder {
  order: OrderRow;
  window: WindowFigures;
}

/** Exactly one lapse notice per grower and window, one line per lapsed order in order-number order. */
export async function queueLapseNotices(db: Db, lapsed: LapsedOrder[]): Promise<void> {
  const groups = new Map<string, LapsedOrder[]>();
  for (const entry of lapsed) {
    const key = `${entry.window.id} ${entry.order.grower_id}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const own of groups.values()) {
    const { window: w, order: first } = own[0]!;
    const lines = own.map(({ order }) =>
      order.status === "scheduled"
        ? `Order ${order.number} lapsed when the window closed. ${formatMl(order.volume_milli)} ML is back in your allocation.`
        : `Order ${order.number} lapsed when the window closed. Nothing was debited for it.`,
    );
    const body = [`${w.channel_name}, ${w.label} has closed.`, "", ...lines];
    await queue(db, "lapse", w.id, first.grower_id, `Ditchbook lapse: ${w.channel_name}, ${w.label}`, body.join("\n"));
  }
}

export async function windowNotices(db: Db, windowId: string) {
  const found = await db.query<{ kind: NoticeKind; grower_id: number; grower_name: string; subject: string; state: "queued" | "sent"; created_at: Date }>(
    `SELECT n.kind, n.grower_id, p.name AS grower_name, n.subject, n.state, n.created_at
     FROM notice n JOIN person p ON p.id = n.grower_id WHERE n.window_id = $1 ORDER BY n.id`,
    [windowId],
  );
  return found.rows.map((n) => ({ ...n, created_at: isoInstant(n.created_at) }));
}

/** Sends queued notices one at a time; stops at the first failure and leaves the rest queued. */
export async function sendQueuedNotices(): Promise<void> {
  for (;;) {
    const sent = await tx(async (db) => {
      const next = await db.query<{ id: number; email: string; subject: string; body: string }>(
        `SELECT n.id, p.email, n.subject, n.body FROM notice n JOIN person p ON p.id = n.grower_id
         WHERE n.state = 'queued' ORDER BY n.id LIMIT 1 FOR UPDATE OF n SKIP LOCKED`,
      );
      const notice = next.rows[0];
      if (!notice) return false;
      await sendMail({ to: notice.email, subject: notice.subject, text: notice.body });
      await db.query("UPDATE notice SET state = 'sent' WHERE id = $1", [notice.id]);
      return true;
    }, { lock: false });
    if (!sent) return;
  }
}
