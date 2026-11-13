import { randomBytes, randomUUID } from "node:crypto";
import { finishName, hubName, isFinish, isHub, isModel, modelName, type FinishId, type HubId, type ModelId } from "../shared/catalogue.js";
import { fullDate, isDate, istDate, shortDate, timeOf } from "../shared/clock.js";
import { rupees } from "../shared/money.js";
import type { DeliveryDay, Lock } from "../shared/types.js";
import type { UserRow } from "./auth.js";
import { Changes, guarded, hubStatus, now } from "./core.js";
import { advisory, one, q, tx, type Db } from "./db.js";
import { expireLocks, lineMates } from "./due.js";
import { fail } from "./errors.js";
import { jsonObject } from "./http.js";
import { ledger } from "./ledger.js";
import { rebuildPlaces, rebuildUnit } from "./rebuild.js";
import { addNotice, cancelLockNotices, lockEndingDue } from "./notices.js";
import { publishNotice, renderPdf, topicOf } from "./providers.js";
import { deliveryCapacity, deliveryWindow, effectiveState, isDeliveryClosed, lockExpiry, mayDeliver, placesLeft, quoteFor, takesLastUnit, unitsLeft } from "./rules.js";
import { ACTIVE_SQL, HELD_SQL, LOCK_SELECT, lockById, serializeLock, type LockRow } from "./views.js";


export async function ownLock(rider: UserRow, id: string): Promise<LockRow> {
  const row = await lockById(id);
  if (!row || row.rider_id !== rider.id) throw fail("not_found");
  return row;
}

async function hubLock(host: UserRow, id: string): Promise<LockRow> {
  const row = await lockById(id);
  if (!row || row.hub !== host.hub) throw fail("not_found");
  return row;
}

const lockRowFor = async (c: Db, id: string): Promise<LockRow> => {
  const row = (await q<LockRow>(`${LOCK_SELECT} WHERE l.id = $1 FOR UPDATE OF l`, [id], c))[0];
  if (!row) throw fail("not_found");
  return row;
};

const stockFor = async (c: Db, hub: HubId, model: ModelId, finish: FinishId): Promise<number> => {
  const row = await one<{ on_hand: number }>("SELECT on_hand FROM stock WHERE hub=$1 AND model=$2 AND finish=$3 FOR UPDATE", [hub, model, finish], c);
  return row?.on_hand ?? 0;
};

const newRef = (): string => `KO-${randomBytes(5).toString("hex").toUpperCase()}`;

// --- claim

export async function claimLock(rider: UserRow, body: unknown): Promise<{ status: 200 | 201 | 202; lock: Lock }> {
  const b = jsonObject(body);
  if (!b || !isHub(b.hub) || !isModel(b.model) || !isFinish(b.finish)) throw fail("invalid_body");
  const { hub, model, finish } = b as { hub: HubId; model: ModelId; finish: FinishId };
  await expireLocks(await now());
  const changes = new Changes();
  let gated: string | null = null;
  try {
    const result = await guarded(hub, () =>
      tx(async (c) => {
        await advisory(c, `claim:${rider.id}:${model}`);
        const at = await now(c);
        const existing = (await q<LockRow>(`${LOCK_SELECT} WHERE l.rider_id=$1 AND l.model=$2 AND l.state IN ${ACTIVE_SQL}`, [rider.id, model], c))[0];
        if (existing) {
          if (existing.hub !== hub || existing.finish !== finish) throw fail("lock_exists_other_finish");
          return { status: (existing.state === "requested" ? 202 : 200) as 200 | 202, lock: serializeLock(existing, at) };
        }
        const onHand = await stockFor(c, hub, model, finish);
        const held = (await one<{ n: number }>(`SELECT count(*) AS n FROM locks l WHERE l.hub=$1 AND l.model=$2 AND l.finish=$3 AND ${HELD_SQL}`, [hub, model, finish], c))?.n ?? 0;
        const left = unitsLeft(onHand, held);
        if (left === 0) throw fail("none_left");
        const quote = quoteFor(hub, model, at);
        const step = b.stepEffectiveFrom;
        if (isDate(step) && step !== quote.stepEffectiveFrom) throw fail("price_moved");
        if (!isDate(step)) throw fail("invalid_body");
        if ((await hubStatus(hub, c)).stale) throw fail("hub_unreachable");
        const ref = newRef();
        const expires = lockExpiry(hub, at);
        let gate = await ledger.claimUnit(hub, model, finish, ref, expires, false);
        if (gate === "missing") {
          await rebuildUnit(c, hub, model, finish);
          gate = await ledger.claimUnit(hub, model, finish, ref, expires, true);
        }
        if (gate === "none") throw fail("none_left");
        gated = ref;
        const id = randomUUID();
        const state = takesLastUnit(left) ? "requested" : "locked";
        await q(
          `INSERT INTO locks (id, ref, rider_id, hub, model, finish, state, issued_ms, expires_ms, ex_showroom_paise, road_tax_paise, insurance_paise, on_road_paise, step_effective_from)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [id, ref, rider.id, hub, model, finish, state, at, expires, quote.exShowroomPaise, quote.roadTaxPaise, quote.insurancePaise, quote.onRoadPaise, quote.stepEffectiveFrom],
          c,
        );
        if (state === "locked") await addNotice(c, "lock_ending", rider.id, { lockId: id }, lockEndingDue(expires));
        changes.hub(hub).rider(rider.id);
        await changes.apply(c);
        return { status: (state === "requested" ? 202 : 201) as 201 | 202, lock: serializeLock((await lockRowFor(c, id)), at) };
      }),
    );
    changes.publish();
    return result;
  } catch (error) {
    if (gated) await ledger.removeHold(hub, model, finish, gated).catch(() => undefined);
    throw error;
  }
}

// --- release

export async function releaseLock(rider: UserRow, id: string): Promise<Lock> {
  const first = await ownLock(rider, id);
  const changes = new Changes();
  const lock = await guarded(first.hub, () =>
    tx(async (c) => {
      await stockFor(c, first.hub, first.model, first.finish);
      const row = await lockRowFor(c, id);
      const at = await now(c);
      const state = effectiveState(row, at);
      if (state === "expired") throw fail("lock_expired");
      if (state !== "locked") throw fail("illegal_state");
      await ledger.removeHold(row.hub, row.model, row.finish, row.ref);
      await q("UPDATE locks SET state='released', in_ledger=false, waiting_for=NULL, wait_seq=NULL WHERE id=$1", [id], c);
      await cancelLockNotices(c, id);
      changes.hub(row.hub).rider(row.rider_id);
      if (row.waiting_for) await lineMates(changes, row.hub, row.waiting_for, c);
      await changes.apply(c);
      return serializeLock(await lockRowFor(c, id), at);
    }),
  );
  changes.publish();
  return lock;
}

// --- hub host: confirm, refuse, withdraw, delivered

export async function hostConfirm(host: UserRow, id: string): Promise<Lock> {
  const first = await hubLock(host, id);
  const changes = new Changes();
  const lock = await guarded(first.hub, () =>
    tx(async (c) => {
      await stockFor(c, first.hub, first.model, first.finish);
      const row = await lockRowFor(c, id);
      const at = await now(c);
      const state = effectiveState(row, at);
      if (state === "expired") throw fail("lock_expired");
      if (state !== "requested") throw fail("illegal_state");
      await ledger.touchHold(row.hub, row.model, row.finish, row.ref, row.expires_ms as number);
      await q("UPDATE locks SET state='locked' WHERE id=$1", [id], c);
      await addNotice(c, "lock_ending", row.rider_id, { lockId: id }, lockEndingDue(row.expires_ms as number));
      changes.hub(row.hub).rider(row.rider_id);
      await changes.apply(c);
      return serializeLock(await lockRowFor(c, id), at);
    }),
  );
  changes.publish();
  return lock;
}

async function takeUnitOffFloor(c: Db, row: LockRow, next: "refused" | "withdrawn" | "delivered", changes: Changes): Promise<void> {
  await q("UPDATE locks SET state=$2, in_ledger=false, waiting_for=NULL, wait_seq=NULL WHERE id=$1", [row.id, next], c);
  await q("UPDATE stock SET on_hand = GREATEST(0, on_hand - 1) WHERE hub=$1 AND model=$2 AND finish=$3", [row.hub, row.model, row.finish], c);
  await cancelLockNotices(c, row.id);
  changes.hub(row.hub).rider(row.rider_id);
}

export async function hostRefuse(host: UserRow, id: string): Promise<Lock> {
  const first = await hubLock(host, id);
  const changes = new Changes();
  const lock = await guarded(first.hub, () =>
    tx(async (c) => {
      await stockFor(c, first.hub, first.model, first.finish);
      const row = await lockRowFor(c, id);
      const at = await now(c);
      const state = effectiveState(row, at);
      if (state === "expired") throw fail("lock_expired");
      if (state !== "requested") throw fail("illegal_state");
      await ledger.freeUnit(row.hub, row.model, row.finish, row.ref);
      await takeUnitOffFloor(c, row, "refused", changes);
      await changes.apply(c);
      return serializeLock(await lockRowFor(c, id), at);
    }),
  );
  changes.publish();
  return lock;
}

/** Withdraws a locked or delivery-set unit; a freed delivery place passes at once to the earliest waiter. */
export async function hostWithdraw(host: UserRow, id: string): Promise<Lock> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const first = await hubLock(host, id);
    const changes = new Changes();
    const done = await guarded(first.hub, () =>
      tx(async (c) => {
        if (first.delivery_date) await advisory(c, `place:${first.hub}:${first.delivery_date}`);
        await stockFor(c, first.hub, first.model, first.finish);
        const row = await lockRowFor(c, id);
        const at = await now(c);
        const state = effectiveState(row, at);
        if (state === "expired") throw fail("lock_expired");
        if (state !== "locked" && state !== "delivery_set") throw fail("illegal_state");
        if (row.delivery_date !== first.delivery_date) return null;
        let waiter: LockRow | undefined;
        if (state === "delivery_set" && row.delivery_date) {
          waiter = (
            await q<LockRow>(`${LOCK_SELECT} WHERE l.hub=$1 AND l.waiting_for=$2 AND l.state='locked' AND l.expires_ms > $3 ORDER BY l.wait_seq LIMIT 1 FOR UPDATE OF l`, [row.hub, row.delivery_date, at], c)
          )[0];
        }
        await ledger.freeUnit(row.hub, row.model, row.finish, row.ref, row.delivery_date ? { date: row.delivery_date, waiter: waiter ? { ref: waiter.ref, model: waiter.model, finish: waiter.finish } : undefined } : undefined);
        await takeUnitOffFloor(c, row, "withdrawn", changes);
        if (row.waiting_for) await lineMates(changes, row.hub, row.waiting_for, c);
        if (waiter) {
          await q("UPDATE locks SET state='delivery_set', delivery_date=$2, expires_ms=NULL, waiting_for=NULL, wait_seq=NULL WHERE id=$1", [waiter.id, row.delivery_date], c);
          await cancelLockNotices(c, waiter.id);
          await addNotice(c, "delivery_place", waiter.rider_id, { lockId: waiter.id }, at);
          changes.rider(waiter.rider_id);
          await lineMates(changes, row.hub, row.delivery_date as string, c);
        }
        await changes.apply(c);
        return serializeLock(await lockRowFor(c, id), at);
      }),
    );
    if (done) {
      changes.publish();
      return done;
    }
  }
  throw fail("illegal_state");
}

export async function hostDelivered(host: UserRow, id: string): Promise<Lock> {
  const first = await hubLock(host, id);
  const changes = new Changes();
  const lock = await guarded(first.hub, () =>
    tx(async (c) => {
      await stockFor(c, first.hub, first.model, first.finish);
      const row = await lockRowFor(c, id);
      const at = await now(c);
      if (row.state !== "delivery_set") throw fail("illegal_state");
      if (!mayDeliver(row.delivery_date as string, at)) throw fail("too_early");
      await ledger.freeUnit(row.hub, row.model, row.finish, row.ref);
      await takeUnitOffFloor(c, row, "delivered", changes);
      await changes.apply(c);
      return serializeLock(await lockRowFor(c, id), at);
    }),
  );
  changes.publish();
  return lock;
}

// --- delivery days and the wait line

const placesTaken = async (c: Db | undefined, hub: HubId, dates: string[]): Promise<Map<string, number>> => {
  const taken = new Map<string, number>();
  const earlier = await q<{ date: string; n: number }>("SELECT date, n FROM earlier_sales WHERE hub=$1 AND date = ANY($2)", [hub, dates], c);
  for (const e of earlier) taken.set(e.date, e.n);
  const sold = await q<{ delivery_date: string; n: number }>(
    "SELECT delivery_date, count(*) AS n FROM locks WHERE hub=$1 AND delivery_date = ANY($2) AND state IN ('delivery_set','delivered') GROUP BY delivery_date",
    [hub, dates],
    c,
  );
  for (const s of sold) taken.set(s.delivery_date, (taken.get(s.delivery_date) ?? 0) + s.n);
  return taken;
};

export async function deliveryDaysFor(lock: LockRow, nowMs: number): Promise<{ days: DeliveryDay[] }> {
  const dates = deliveryWindow(lock.issued_ms);
  const taken = await placesTaken(undefined, lock.hub, dates);
  return {
    days: dates.map((date) => {
      const capacity = deliveryCapacity(date);
      const left = placesLeft(date, taken.get(date) ?? 0);
      const closed = isDeliveryClosed(lock.hub, date, nowMs, lock.issued_ms);
      return {
        date,
        dayLabel: shortDate(date),
        capacity,
        placesLeft: closed ? 0 : left,
        state: closed ? "closed" : left === 0 ? "full" : "open",
      } satisfies DeliveryDay;
    }),
  };
}

const dayOf = (body: unknown): string | null => {
  const b = jsonObject(body);
  return b && isDate(b.date) ? b.date : null;
};

export async function setDelivery(rider: UserRow, id: string, body: unknown): Promise<Lock> {
  const first = await ownLock(rider, id);
  const wanted = dayOf(body);
  const sameDay = first.state === "delivery_set" && wanted !== null && first.delivery_date === wanted;
  if (sameDay) return serializeLock(first, await now());
  await expireLocks(await now());
  const changes = new Changes();
  const lock = await guarded(first.hub, () =>
    tx(async (c) => {
      if (wanted) await advisory(c, `place:${first.hub}:${wanted}`);
      await stockFor(c, first.hub, first.model, first.finish);
      const row = await lockRowFor(c, id);
      const at = await now(c);
      if (row.state === "delivery_set" && wanted !== null && row.delivery_date === wanted) return serializeLock(row, at);
      const state = effectiveState(row, at);
      if (state === "expired") throw fail("lock_expired");
      if (state !== "locked") throw fail("illegal_state");
      if (!wanted) throw fail("invalid_body");
      if (isDeliveryClosed(row.hub, wanted, at, row.issued_ms)) throw fail("delivery_day_closed");
      const capacity = deliveryCapacity(wanted);
      if (placesLeft(wanted, (await placesTaken(c, row.hub, [wanted])).get(wanted) ?? 0) === 0) throw fail("delivery_day_full");
      let gate = await ledger.claimPlace(row.hub, wanted, row.model, row.finish, row.ref, capacity, false);
      if (gate === "missing") {
        await rebuildPlaces(c, row.hub, wanted);
        gate = await ledger.claimPlace(row.hub, wanted, row.model, row.finish, row.ref, capacity, true);
      }
      if (gate === "full") throw fail("delivery_day_full");
      const leaving = row.waiting_for;
      await q("UPDATE locks SET state='delivery_set', delivery_date=$2, expires_ms=NULL, waiting_for=NULL, wait_seq=NULL WHERE id=$1", [id, wanted], c);
      await cancelLockNotices(c, id);
      changes.hub(row.hub).rider(row.rider_id);
      if (leaving) await lineMates(changes, row.hub, leaving, c);
      await changes.apply(c);
      return serializeLock(await lockRowFor(c, id), at);
    }),
  );
  changes.publish();
  return lock;
}

export async function joinLine(rider: UserRow, id: string, body: unknown): Promise<{ status: 200 | 201; lock: Lock }> {
  const first = await ownLock(rider, id);
  const wanted = dayOf(body);
  if (wanted !== null && first.waiting_for === wanted && first.state === "locked") return { status: 200, lock: serializeLock(first, await now()) };
  await expireLocks(await now());
  const changes = new Changes();
  const result = await tx(async (c) => {
    if (wanted) await advisory(c, `place:${first.hub}:${wanted}`);
    const row = await lockRowFor(c, id);
    const at = await now(c);
    if (wanted !== null && row.waiting_for === wanted && row.state === "locked") return { status: 200 as const, lock: serializeLock(row, at) };
    const state = effectiveState(row, at);
    if (state === "expired") throw fail("lock_expired");
    if (state !== "locked") throw fail("illegal_state");
    if (!wanted) throw fail("invalid_body");
    if (isDeliveryClosed(row.hub, wanted, at, row.issued_ms)) throw fail("delivery_day_closed");
    if (placesLeft(wanted, (await placesTaken(c, row.hub, [wanted])).get(wanted) ?? 0) > 0) throw fail("delivery_day_has_places");
    const leaving = row.waiting_for;
    await q("UPDATE locks SET waiting_for=$2, wait_seq=nextval('wait_seq') WHERE id=$1", [id, wanted], c);
    changes.rider(row.rider_id);
    if (leaving) await lineMates(changes, row.hub, leaving, c);
    changes.hub(row.hub);
    await changes.apply(c);
    return { status: 201 as const, lock: serializeLock(await lockRowFor(c, id), at) };
  });
  changes.publish();
  return result;
}

export async function leaveLine(rider: UserRow, id: string): Promise<Lock> {
  const first = await ownLock(rider, id);
  const changes = new Changes();
  const lock = await tx(async (c) => {
    const row = await lockRowFor(c, first.id);
    const at = await now(c);
    if (!row.waiting_for) throw fail("illegal_state");
    await q("UPDATE locks SET waiting_for=NULL, wait_seq=NULL WHERE id=$1", [id], c);
    changes.hub(row.hub).rider(row.rider_id);
    await lineMates(changes, row.hub, row.waiting_for, c);
    await changes.apply(c);
    return serializeLock(await lockRowFor(c, id), at);
  });
  changes.publish();
  return lock;
}

// --- price sheet

const esc = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function sheetHtml(row: LockRow, riderName: string): string {
  const closing =
    row.state === "delivery_set" ? `Delivery day ${fullDate(row.delivery_date as string)}` : `Valid until ${fullDate(istDate(row.expires_ms as number))}, ${timeOf(row.expires_ms as number)} IST`;
  const line = (label: string, value: string): string => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Price Sheet</title>
<style>body{font-family:Helvetica,Arial,sans-serif;color:#18191b;margin:48px}h1{font-size:28px;margin:0}h2{font-size:18px;font-weight:normal;margin:4px 0 28px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px 6px;border-bottom:1px solid #ccc;font-size:15px}td{text-align:right}p{margin-top:28px;font-size:16px}</style></head>
<body><h1>Malhar Motor Works</h1><h2>Price Sheet</h2><table>
${line("Rider", riderName)}${line("Model", modelName(row.model))}${line("Finish", finishName(row.finish))}${line("Hub", hubName(row.hub))}
${line("Issued", fullDate(istDate(row.issued_ms)))}${line("Ex-showroom", rupees(row.ex_showroom_paise))}${line("Road tax", rupees(row.road_tax_paise))}
${line("Insurance", rupees(row.insurance_paise))}${line("On-road", rupees(row.on_road_paise))}</table><p>${esc(closing)}</p></body></html>`;
}

/** Makes the sheet once however many presses arrive, on whichever copy; a failed render stores nothing. */
export async function makeSheet(rider: UserRow, id: string): Promise<{ status: 200 | 201; lock: Lock }> {
  const first = await ownLock(rider, id);
  const nowMs = await now();
  const early = effectiveState(first, nowMs);
  if (first.sheet_ready) return { status: 200, lock: serializeLock(first, nowMs) };
  if (early === "expired") throw fail("lock_expired");
  if (early !== "locked" && early !== "delivery_set") throw fail("illegal_state");
  const changes = new Changes();
  const result = await tx(async (c) => {
    await advisory(c, `sheet:${id}`);
    const row = await lockRowFor(c, id);
    const at = await now(c);
    if (row.sheet_ready) return { status: 200 as const, lock: serializeLock(row, at) };
    const state = effectiveState(row, at);
    if (state === "expired") throw fail("lock_expired");
    if (state !== "locked" && state !== "delivery_set") throw fail("illegal_state");
    const pdf = await renderPdf(sheetHtml({ ...row, state }, rider.name));
    await q("INSERT INTO sheets (lock_id, pdf, created_ms) VALUES ($1,$2,$3)", [id, pdf, at], c);
    changes.rider(rider.id);
    await changes.apply(c);
    return { status: 201 as const, lock: serializeLock(await lockRowFor(c, id), at) };
  });
  if (result.status === 201) changes.publish();
  return result;
}

export async function sheetBytes(rider: UserRow, id: string): Promise<Buffer> {
  await ownLock(rider, id);
  const row = await one<{ pdf: Buffer }>("SELECT pdf FROM sheets WHERE lock_id=$1", [id]);
  if (!row) throw fail("not_found");
  return row.pdf;
}

// --- reminders

export async function turnOnReminders(rider: UserRow): Promise<{ remindersOn: true; topic: string }> {
  const topic = topicOf(rider.id);
  if (rider.reminders_on) return { remindersOn: true, topic };
  const changes = new Changes();
  await tx(async (c) => {
    await advisory(c, `reminders:${rider.id}`);
    const fresh = await one<{ reminders_on: boolean }>("SELECT reminders_on FROM users WHERE id=$1", [rider.id], c);
    if (fresh?.reminders_on) return;
    if (!(await publishNotice(topic, "Reminders on", "Key-On will send lock and ride notices here."))) throw fail("notice_unreachable");
    await q("UPDATE users SET reminders_on=true WHERE id=$1", [rider.id], c);
    changes.rider(rider.id);
    await changes.apply(c);
  });
  changes.publish();
  return { remindersOn: true, topic };
}
