import { FINISHES, MODELS, isFinish, isModel, type FinishId, type HubId, type ModelId } from "../shared/catalogue.js";
import { addDays, asOfLabel, dayLabel, isDate, isoIst, istDate, istInstant, expiryLabel, timeLabel } from "../shared/clock.js";
import type { DayRow, DaySheet, HeldRow, Stock } from "../shared/types.js";
import type { UserRow } from "./auth.js";
import { Changes, guarded, hubStatus, now } from "./core.js";
import { q, tx } from "./db.js";
import { fail } from "./errors.js";
import { jsonObject } from "./http.js";
import { ledger } from "./ledger.js";
import { SHEET_DAYS_AHEAD, SHEET_DAYS_BACK, handoverActions, heldActions, rideActions } from "./rules.js";
import { ACTIVE_SQL, TAKEN_SQL, stockLines } from "./views.js";

const hubOf = (host: UserRow): HubId => host.hub as HubId;

export async function daySheet(host: UserRow, dateParam: string | null, nowMs: number): Promise<DaySheet> {
  if (dateParam !== null && !isDate(dateParam)) throw fail("invalid_body");
  const hub = hubOf(host);
  const today = istDate(nowMs);
  const date = dateParam ?? today;
  const rides = await q<{ id: string; starts_ms: number; state: DayRow["state"]; model: ModelId; licence_last4: string; name: string }>(
    `SELECT r.id, r.starts_ms, r.state, r.model, r.licence_last4, u.name FROM rides r JOIN users u ON u.id = r.rider_id
     WHERE r.hub=$1 AND r.state IN ${TAKEN_SQL} AND r.starts_ms >= $2 AND r.starts_ms < $3 ORDER BY r.starts_ms`,
    [hub, istInstant(date, "00:00"), istInstant(addDays(date, 1), "00:00")],
  );
  const handovers = await q<{ id: string; state: DayRow["state"]; model: ModelId; finish: FinishId; delivery_date: string; name: string }>(
    `SELECT l.id, l.state, l.model, l.finish, l.delivery_date, u.name FROM locks l JOIN users u ON u.id = l.rider_id
     WHERE l.hub=$1 AND l.state IN ('delivery_set','delivered') AND l.delivery_date=$2 ORDER BY l.issued_ms, l.n`,
    [hub, date],
  );
  return {
    hub,
    date,
    dayLabel: dayLabel(date, today),
    dates: Array.from({ length: SHEET_DAYS_BACK + SHEET_DAYS_AHEAD + 1 }, (_, i) => addDays(today, i - SHEET_DAYS_BACK)).map((d) => ({ date: d, dayLabel: dayLabel(d, today) })),
    rows: [
      ...rides.map((r): DayRow => ({
        kind: "ride",
        id: r.id,
        label: timeLabel(r.starts_ms),
        riderName: r.name,
        model: r.model,
        finish: null,
        licenceLast4: r.licence_last4,
        state: r.state,
        actions: r.state === "booked" ? rideActions(r.starts_ms, nowMs) : [],
      })),
      ...handovers.map((h): DayRow => ({
        kind: "handover",
        id: h.id,
        label: "Handover",
        riderName: h.name,
        model: h.model,
        finish: h.finish,
        licenceLast4: null,
        state: h.state,
        actions: h.state === "delivery_set" ? handoverActions(h.delivery_date, nowMs) : [],
      })),
    ],
  };
}

export async function heldUnits(host: UserRow): Promise<{ rows: HeldRow[] }> {
  const rows = await q<{ id: string; name: string; model: ModelId; finish: FinishId; state: HeldRow["state"]; expires_ms: number | null; delivery_date: string | null; waiting_for: string | null }>(
    `SELECT l.id, u.name, l.model, l.finish, l.state, l.expires_ms, l.delivery_date, l.waiting_for FROM locks l JOIN users u ON u.id = l.rider_id
     WHERE l.hub=$1 AND l.state IN ${ACTIVE_SQL} ORDER BY l.issued_ms, l.n`,
    [hubOf(host)],
  );
  return {
    rows: rows.map((r) => ({
      id: r.id,
      riderName: r.name,
      model: r.model,
      finish: r.finish,
      state: r.state,
      expiresLabel: r.state === "delivery_set" || r.expires_ms === null ? null : expiryLabel(r.expires_ms),
      deliveryDate: r.delivery_date,
      waitingFor: r.waiting_for,
      actions: heldActions(r.state),
    })),
  };
}

export async function stockBody(hub: HubId, nowMs: number): Promise<Stock> {
  const [status, units] = await Promise.all([hubStatus(hub), stockLines(hub)]);
  return { hub, counting: status.counting, stockAsOf: isoIst(status.asOfMs), stockAsOfLabel: asOfLabel(status.asOfMs, nowMs), units };
}

export async function startCount(host: UserRow): Promise<void> {
  const hub = hubOf(host);
  const changes = new Changes();
  await tx(async (c) => {
    const at = await now(c);
    const started = await q("UPDATE hub_state SET counting=true, count_started_ms=$2 WHERE hub=$1 AND NOT counting RETURNING hub", [hub, at], c);
    if (started.length === 0) throw fail("illegal_state");
    changes.hub(hub);
    await changes.apply(c);
  });
  changes.publish();
}

type CountRow = { model: ModelId; finish: FinishId; onHand: number };

function countRows(body: unknown): CountRow[] {
  const units = jsonObject(body)?.units;
  if (!Array.isArray(units) || units.length !== MODELS.length * FINISHES.length) throw fail("invalid_body");
  const seen = new Set<string>();
  const rows = units.map((u): CountRow => {
    const row = (u ?? {}) as Record<string, unknown>;
    if (!isModel(row.model) || !isFinish(row.finish) || typeof row.onHand !== "number" || !Number.isInteger(row.onHand) || row.onHand < 0) throw fail("invalid_body");
    seen.add(`${row.model}:${row.finish}`);
    return { model: row.model, finish: row.finish, onHand: row.onHand };
  });
  if (seen.size !== rows.length) throw fail("invalid_body");
  return rows;
}

export async function finishCount(host: UserRow, body: unknown): Promise<void> {
  const hub = hubOf(host);
  if (!(await hubStatus(hub)).counting) throw fail("illegal_state");
  const rows = countRows(body);
  const changes = new Changes();
  await guarded(hub, () =>
    tx(async (c) => {
      const at = await now(c);
      const open = await q("SELECT 1 FROM hub_state WHERE hub=$1 AND counting FOR UPDATE", [hub], c);
      if (open.length === 0) throw fail("illegal_state");
      await ledger.setOnHand(rows.map((r) => ({ hub, ...r })));
      for (const r of rows) await q("UPDATE stock SET on_hand=$4 WHERE hub=$1 AND model=$2 AND finish=$3", [hub, r.model, r.finish, r.onHand], c);
      await q("UPDATE hub_state SET counting=false, count_started_ms=NULL, stock_as_of_ms=$2 WHERE hub=$1", [hub, at], c);
      changes.hub(hub);
      await changes.apply(c);
    }),
  );
  changes.publish();
}
