// Publishing a restriction: one cap per window, effective from its minute, pro-rating the window's cap
// volume and moving scheduled orders that no longer fit back to requested in one database step with
// their notices.
import { tx, type Db } from "./db.ts";
import { CAP_MAX, capVolume, formatMl, parseMl } from "./decimal.ts";
import { ApiError, FieldErrors, asRecord, notFound } from "./http.ts";
import { queueRestrictionNotices } from "./notices.ts";
import { counts, nextStatus } from "./orderStates.ts";
import { releaseScheduled } from "./orders.ts";
import { ORDER_SELECT, loadWindow, windowRecord, type OrderRow } from "./records.ts";
import { effectiveMinute, isoInstant, minutesBefore } from "./time.ts";
import { kickWorker } from "./worker.ts";

interface RestrictionRow {
  id: number;
  window_id: string;
  cap_milli: bigint;
  reason: string;
  effective_at: Date;
}

function restrictionRecord(r: RestrictionRow) {
  return {
    id: r.id,
    window_id: r.window_id,
    cap_ml_day: formatMl(r.cap_milli),
    reason: r.reason,
    effective_at: isoInstant(r.effective_at),
  };
}

async function movedOrders(db: Db, restrictionId: number): Promise<string[]> {
  const found = await db.query<{ order_number: string }>(
    "SELECT order_number FROM restriction_move WHERE restriction_id = $1 ORDER BY order_number",
    [restrictionId],
  );
  return found.rows.map((row) => row.order_number);
}

export async function publishRestriction(windowId: string, body: unknown) {
  const input = asRecord(body);
  const result = await tx(async (db) => {
    const window = await loadWindow(db, windowId);
    if (!window) throw notFound();
    const orders = (await db.query<OrderRow>(`${ORDER_SELECT} WHERE o.window_id = $1`, [windowId])).rows;
    const fixed = orders
      .filter((o) => counts(o) && o.status !== "scheduled")
      .reduce((sum, o) => sum + o.volume_milli, 0n);

    const effectiveAt = effectiveMinute(new Date());
    const proRated = (cap: bigint) =>
      capVolume(window.table_cap_milli, window.hours, { cap, minutesBefore: minutesBefore(window.opens_at, effectiveAt) });
    const errors = new FieldErrors();
    const cap = parseMl(input.cap_ml_day);
    if (cap === null || cap <= 0n || cap > CAP_MAX) {
      errors.add("cap_ml_day", "Enter a cap above 0 and at most 10000.000 ML/day, with up to three decimals.");
    } else if (cap >= window.effective_cap_milli) {
      errors.add("cap_ml_day", `The cap must be below the current ${formatMl(window.effective_cap_milli)} ML/day.`);
    } else if (proRated(cap) < fixed) {
      errors.add("cap_ml_day", `The window's cap volume must still cover the ${formatMl(fixed)} ML already running, delivered or closed after flow.`);
    }
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason.length < 3 || reason.length > 200) errors.add("reason", "Give a reason of 3 to 200 characters.");
    errors.throwIfAny();
    // Validation answers before these state conflicts (brief: Error precedence).
    if (window.status === "closed") throw new ApiError(409, "window_closed", "This window has closed.");
    if (window.restriction_id !== null) {
      throw new ApiError(409, "restriction_exists", "This window already has a restriction.");
    }

    const inserted = await db.query<RestrictionRow>(
      "INSERT INTO restriction (window_id, cap_milli, reason, effective_at) VALUES ($1, $2, $3, $4) RETURNING *",
      [windowId, cap, reason, effectiveAt],
    );
    const restriction = inserted.rows[0]!;
    const room = proRated(cap!);
    const scheduled = orders
      .filter((o) => o.status === "scheduled")
      .sort((a, b) => a.scheduled_at!.getTime() - b.scheduled_at!.getTime() || a.number.localeCompare(b.number));
    let counted = fixed;
    let fits = true;
    const moved = new Set<string>();
    for (const order of scheduled) {
      fits = fits && counted + order.volume_milli <= room;
      if (fits) {
        counted += order.volume_milli;
        continue;
      }
      await releaseScheduled(db, order);
      await db.query("UPDATE water_order SET status = $2, conflict = 'restriction' WHERE number = $1", [
        order.number, nextStatus("restrict", order.status),
      ]);
      await db.query("INSERT INTO restriction_move (restriction_id, order_number) VALUES ($1, $2)", [restriction.id, order.number]);
      moved.add(order.number);
    }
    const after = (await loadWindow(db, windowId))!;
    await queueRestrictionNotices(db, after, effectiveAt, moved);
    return { restriction: restrictionRecord(restriction), window: windowRecord(after), moved_orders: [...moved].sort() };
  });
  kickWorker();
  return result;
}

export async function getRestriction(db: Db, id: number) {
  const found = await db.query<RestrictionRow>("SELECT * FROM restriction WHERE id = $1", [id]);
  const restriction = found.rows[0];
  if (!restriction) throw notFound();
  return {
    restriction: restrictionRecord(restriction),
    window: windowRecord((await loadWindow(db, restriction.window_id))!),
    moved_orders: await movedOrders(db, id),
  };
}
