// Actions: the write paths. Each judgement runs in one database step that
// takes the window row first and then the allocation rows, so racing requests
// are judged one after another.
import pg from "pg";
import { decAdd, decCmp, decParse, decStr3, decSub } from "../shared/decimal.ts";
import {
  capVolumeMl, effectiveCapMlDay, rateMlDay, remainingMl as computeRemaining, turnoutMaxMl,
  rationShares, type RationCandidate,
} from "../shared/domain.ts";
import { formatInstant, truncateToMinute } from "../shared/district-time.ts";
import { ApiError, fieldErrors } from "./errors.ts";
import { Store, type OrderRow, type WindowRow, type AllocationRow, type CardRow } from "./store.ts";

// An error that also carries a notice to queue once the transaction has rolled
// back. The conflict notice for a refused order survives the refusal.
export class NoticeAndError extends Error {
  constructor(public readonly error: ApiError, public readonly notice: { kind: string; growerId: number; subject: string; body: string; to: string }) {
    super(error.message);
  }
}

export async function queueNoticeAfterRefusal(store: Store, notice: { kind: string; growerId: number; subject: string; body: string; to: string }): Promise<void> {
  await store.query(
    `INSERT INTO notices (kind, grower_id, window_id, subject, body, state, created_at)
     VALUES ($1, $2, NULL, $3, $4, 'queued', now())`,
    [notice.kind, notice.growerId, notice.subject, notice.body],
  );
}

export type PlaceResult = { order: OrderRow; window: WindowRow; allocation: AllocationRow };

export async function placeOrder(
  store: Store,
  growerId: number,
  input: { turnout: string; windowId: string; volumeMl: string; operatorCode: string; standbyCode: string | null },
  now: number,
): Promise<PlaceResult> {
  return store.transaction(async (client) => {
    // lapse first if this window's time has passed
    await store.lapseWindowIfNeeded(client, input.windowId, now);

    // turnout of the caller
    const turnout = await client.query<{ code: string; channel_id: string; grower_id: number; max_rate_ml_day: string }>(
      "SELECT code, channel_id, grower_id, max_rate_ml_day FROM turnouts WHERE code = $1",
      [input.turnout],
    );
    if (!turnout.rows[0]) throw new ApiError(404, "not_found", "There is no such record.");
    if (turnout.rows[0].grower_id !== growerId) throw new ApiError(404, "not_found", "There is no such record.");

    // window
    const window = await lockWindowOr404(client, input.windowId);
    if (window.channel_id !== turnout.rows[0].channel_id) {
      throw fieldErrors({ turnout: "Choose one of your turnouts on this window's channel." });
    }

    // operators
    await checkOperators(client, input.operatorCode, input.standbyCode);

    // volume validation
    validateVolume(input.volumeMl);
    const hours = window.hours;
    const maxVolume = turnoutMaxMl(turnout.rows[0].max_rate_ml_day, hours);
    if (decCmp(decParse(input.volumeMl)!, decParse(maxVolume)!) > 0) {
      throw fieldErrors({ volume_ml: `More than ${input.turnout} can pass in this window: ${maxVolume} ML.` });
    }

    // ordering horizon
    if (now < window.opens_at - 240 * 3600000) {
      throw new ApiError(409, "too_early", "Orders open 10 days before a window opens.");
    }
    if (now >= window.closes_at) {
      throw new ApiError(409, "window_closed", "This window has closed.");
    }

    // turnout busy: a turnout carries at most one scheduled or running order
    const busy = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM orders WHERE turnout = $1 AND status IN ('scheduled','running')`,
      [input.turnout],
    );
    if (busy.rows[0]!.n > 0) {
      throw new ApiError(409, "turnout_busy", "This turnout already has an order scheduled or running.");
    }

    // window and allocation judged together: window already locked (FOR UPDATE)
    const allocation = await lockAllocation(client, growerId);
    if (!allocation) throw new ApiError(404, "not_found", "There is no such record.");

    if (decCmp(decParse(input.volumeMl)!, decParse(allocation.remaining_ml)!) > 0) {
      throw fieldErrors({ volume_ml: `More than your remaining allocation of ${allocation.remaining_ml} ML.` });
    }
    const remaining = computeRemaining(window.cap_volume_ml, window.committed_ml);
    if (decCmp(decParse(input.volumeMl)!, decParse(remaining)!) > 0) {
      // the conflict notice is created outside the rolled-back order
      // transaction, so it survives the refusal
      const err = new ApiError(409, "window_full", "Not enough capacity left in this window.", { remaining_ml: remaining });
      const winForNotice = await store.windowByIdInTx(client, input.windowId);
      const growerEmailRow = await client.query<{ email: string }>("SELECT email FROM people WHERE id = $1", [growerId]);
      throw new NoticeAndError(err, {
        kind: "conflict",
        growerId,
        subject: `Ditchbook: capacity taken on ${winForNotice?.channel_name ?? ""}, ${winForNotice?.label ?? ""}`,
        body:
          `Another order took the last of this window's capacity. Nothing was debited from your allocation.\n` +
          `Requested volume: ${input.volumeMl} ML.\n` +
          `Your allocation is unchanged at ${allocation.remaining_ml} ML.`,
        to: growerEmailRow.rows[0]?.email ?? "",
      });
    }

    // place
    const number = await nextOrderNumber(client);
    const rate = rateMlDay(input.volumeMl, hours);
    await client.query(
      `INSERT INTO orders (number, grower_id, turnout, window_id, requested_ml, volume_ml, rate_ml_day, status, holder_code, standby_code, conflict, rationed, closed_after_flow, scheduled_at, seq)
       VALUES ($1,$2,$3,$4,$5,$5,$6,'scheduled',$7,$8,null,false,false,$9,nextval('orders_seq'))`,
      [number, growerId, input.turnout, input.windowId, input.volumeMl, rate, input.operatorCode, input.standbyCode, new Date(now)],
    );
    await client.query("UPDATE windows SET committed_ml = $1 WHERE id = $2", [
      decStr3(decAdd(decParse(window.committed_ml)!, decParse(input.volumeMl)!)),
      input.windowId,
    ]);
    await client.query("UPDATE allocations SET debited_ml = (debited_ml::numeric + $1::numeric)::text WHERE grower_id = $2", [input.volumeMl, growerId]);
    // start card
    await client.query(
      `INSERT INTO gate_cards (order_number, turnout, channel_id, window_id, kind, state, holder_code, from_ml_day, to_ml_day)
       VALUES ($1,$2,$3,$4,'start','open',$5,'0.000',$6)`,
      [number, input.turnout, window.channel_id, input.windowId, input.operatorCode, rate],
    );

    const order = await orderInTx(client, number);
    const win = await store.windowByIdInTx(client, input.windowId);
    const alloc = await store.allocationOfInTx(client, growerId);
    return { order: order!, window: win!, allocation: alloc! };
  });
}

export async function scheduleOrder(store: Store, number: string, now: number): Promise<{ order: OrderRow; window: WindowRow }> {
  return store.transaction(async (client) => {
    const order = await lockOrder(client, number);
    if (order.status !== "requested") throw new ApiError(409, "illegal_transition", "That change is not allowed for this order now.");
    await store.lapseWindowIfNeeded(client, order.window_id, now);
    const window = await lockWindowOr404(client, order.window_id);
    if (windowStatusClosed(window, now)) throw new ApiError(409, "window_closed", "This window has closed.");

    const turnout = await client.query<{ code: string; channel_id: string; max_rate_ml_day: string }>(
      "SELECT code, channel_id, max_rate_ml_day FROM turnouts WHERE code = $1",
      [order.turnout],
    );
    const maxVolume = turnoutMaxMl(turnout.rows[0]!.max_rate_ml_day, window.hours);
    if (decCmp(decParse(order.volume_ml)!, decParse(maxVolume)!) > 0) {
      // requested volume beyond the outlet limit cannot be scheduled
      throw new ApiError(409, "illegal_transition", "That change is not allowed for this order now.");
    }
    const busy = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM orders WHERE turnout = $1 AND status IN ('scheduled','running') AND number <> $2`,
      [order.turnout, number],
    );
    if (busy.rows[0]!.n > 0) throw new ApiError(409, "turnout_busy", "This turnout already has an order scheduled or running.");

    const allocation = await lockAllocation(client, order.grower_id);
    if (decCmp(decParse(order.volume_ml)!, decParse(allocation!.remaining_ml)!) > 0) {
      throw new ApiError(409, "allocation_exceeded", "This grower does not have enough allocation left.");
    }
    const remaining = computeRemaining(window.cap_volume_ml, window.committed_ml);
    if (decCmp(decParse(order.volume_ml)!, decParse(remaining)!) > 0) {
      throw new ApiError(409, "window_full", "Not enough capacity left in this window.");
    }

    await client.query(
      `UPDATE orders SET status = 'scheduled', conflict = null, scheduled_at = $1 WHERE number = $2`,
      [new Date(now), number],
    );
    await client.query("UPDATE windows SET committed_ml = $1 WHERE id = $2", [
      decStr3(decAdd(decParse(window.committed_ml)!, decParse(order.volume_ml)!)),
      order.window_id,
    ]);
    await client.query("UPDATE allocations SET debited_ml = (debited_ml::numeric + $1::numeric)::text WHERE grower_id = $2", [order.volume_ml, order.grower_id]);
    await issueStartCard(client, order, order.holder_code ?? window.rostered_operator);
    const o = await orderInTx(client, number);
    const win = await store.windowByIdInTx(client, order.window_id);
    return { order: o!, window: win! };
  });
}

export async function closeOrder(
  store: Store,
  number: string,
  byGrower: number | null,
  now: number,
): Promise<{ order: OrderRow; window: WindowRow; allocation?: AllocationRow }> {
  return store.transaction(async (client) => {
    const order = await lockOrder(client, number);
    if (byGrower !== null && order.grower_id !== byGrower) throw new ApiError(404, "not_found", "There is no such record.");
    await store.lapseWindowIfNeeded(client, order.window_id, now);
    const window = await lockWindowOr404(client, order.window_id);

    if (order.status === "requested" || order.status === "scheduled") {
      if (order.status === "scheduled") {
        await client.query("UPDATE windows SET committed_ml = $1 WHERE id = $2", [
          decStr3(decSub(decParse(window.committed_ml)!, decParse(order.volume_ml)!)),
          order.window_id,
        ]);
        await client.query("UPDATE allocations SET debited_ml = (debited_ml::numeric - $1::numeric)::text WHERE grower_id = $2", [order.volume_ml, order.grower_id]);
        await client.query(`DELETE FROM gate_cards WHERE order_number = $1 AND kind = 'start' AND state = 'open'`, [number]);
      }
      await client.query(`UPDATE orders SET status = 'closed' WHERE number = $1`, [number]);
      const o = await orderInTx(client, number);
      const win = await store.windowByIdInTx(client, order.window_id);
      const allocation = byGrower !== null ? (await store.allocationOfInTx(client, order.grower_id)) ?? undefined : undefined;
      return { order: o!, window: win!, allocation };
    }
    if (order.status === "running") {
      // dispatcher close after flow
      await client.query(`UPDATE orders SET status = 'closed', closed_after_flow = true WHERE number = $1`, [number]);
      const o = await orderInTx(client, number);
      const win = await store.windowByIdInTx(client, order.window_id);
      return { order: o!, window: win! };
    }
    throw new ApiError(409, "illegal_transition", "That change is not allowed for this order now.");
  });
}

export async function reopenOrder(store: Store, number: string, now: number): Promise<{ order: OrderRow; window: WindowRow }> {
  return store.transaction(async (client) => {
    const order = await lockOrder(client, number);
    if (order.status !== "closed" || !order.closed_after_flow) {
      throw new ApiError(409, "not_reopenable", "This order cannot be reopened.");
    }
    await store.lapseWindowIfNeeded(client, order.window_id, now);
    const window = await lockWindowOr404(client, order.window_id);
    if (windowStatusClosed(window, now)) throw new ApiError(409, "window_closed", "This window has closed.");
    const openFinish = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM gate_cards WHERE order_number = $1 AND kind = 'finish' AND state = 'open'`,
      [number],
    );
    if (openFinish.rows[0]!.n === 0) throw new ApiError(409, "not_reopenable", "This order cannot be reopened.");
    const busy = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM orders WHERE turnout = $1 AND status IN ('scheduled','running') AND number <> $2`,
      [order.turnout, number],
    );
    if (busy.rows[0]!.n > 0) throw new ApiError(409, "turnout_busy", "This turnout already has an order scheduled or running.");

    await client.query(`UPDATE orders SET status = 'running', closed_after_flow = false WHERE number = $1`, [number]);
    const o = await orderInTx(client, number);
    const win = await store.windowByIdInTx(client, order.window_id);
    return { order: o!, window: win! };
  });
}

// --- restrictions ---------------------------------------------------------------

export type RestrictionResult = {
  restriction: { id: number; window_id: string; cap_ml_day: string; reason: string; effective_at: string };
  window: WindowRow;
  moved_orders: string[];
};

export async function publishRestriction(
  store: Store,
  windowId: string,
  capMlDay: string,
  reason: string,
  now: number,
): Promise<RestrictionResult> {
  return store.transaction(async (client) => {
    await store.lapseWindowIfNeeded(client, windowId, now);
    const window = await lockWindowOr404(client, windowId);
    if (now >= window.closes_at) throw new ApiError(409, "window_closed", "This window has closed.");
    const existing = await client.query<{ id: number }>("SELECT id FROM restrictions WHERE window_id = $1", [windowId]);
    if (existing.rows.length > 0) throw new ApiError(409, "restriction_exists", "This window already has a restriction.");

    validateCap(capMlDay);
    if (reason.trim().length < 3 || reason.trim().length > 200) {
      throw fieldErrors({ reason: "Reason must be 3 to 200 characters." });
    }
    // cap must be below the current effective cap
    if (decCmp(decParse(capMlDay)!, decParse(window.effective_cap_ml_day)!) >= 0) {
      throw fieldErrors({ cap_ml_day: "The cap must be below the window's current effective cap." });
    }
    const effectiveAt = truncateToMinute(now);
    const newCapVolume = capVolumeMl(window.table_cap_ml_day, capMlDay, effectiveAt, window.opens_at, window.hours);
    // must cover running, delivered and closed-after-flow volume
    const keptVolume = await client.query<{ vol: string }>(
      `SELECT (COALESCE(SUM(volume_ml::numeric), 0))::text AS vol FROM orders WHERE window_id = $1 AND status IN ('running','delivered')`,
      [windowId],
    );
    const closedAfterFlow = await client.query<{ vol: string }>(
      `SELECT (COALESCE(SUM(volume_ml::numeric), 0))::text AS vol FROM orders WHERE window_id = $1 AND status = 'closed' AND closed_after_flow = true`,
      [windowId],
    );
    const mustCover = decStr3(decAdd(decParse(keptVolume.rows[0]!.vol)!, decParse(closedAfterFlow.rows[0]!.vol)!));
    if (decCmp(decParse(newCapVolume)!, decParse(mustCover)!) < 0) {
      throw fieldErrors({ cap_ml_day: "The restricted window could not carry its running and delivered volume." });
    }

    const restriction = await client.query<{ id: number }>(
      `INSERT INTO restrictions (window_id, cap_ml_day, reason, effective_at) VALUES ($1,$2,$3,$4) RETURNING id`,
      [windowId, capMlDay, reason.trim(), new Date(effectiveAt)],
    );
    await client.query(
      `UPDATE windows SET restriction_cap_ml_day = $1, restriction_effective_at = $2, cap_volume_ml = $3 WHERE id = $4`,
      [capMlDay, new Date(effectiveAt), newCapVolume, windowId],
    );

    // move scheduled orders that no longer fit, earliest scheduled_at first
    const scheduled = await client.query<{ number: string; volume_ml: string; scheduled_at: Date; grower_id: number }>(
      `SELECT number, volume_ml, scheduled_at, grower_id FROM orders WHERE window_id = $1 AND status = 'scheduled' ORDER BY scheduled_at, number`,
      [windowId],
    );
    let committed = decParse(window.committed_ml)!;
    const capVol = decParse(newCapVolume)!;
    const moved: string[] = [];
    let stop = false;
    for (const o of scheduled.rows) {
      const vol = decParse(o.volume_ml)!;
      if (stop || decCmp(decAdd(committed, vol), capVol) > 0) {
        stop = true;
        moved.push(o.number);
        continue;
      }
      committed = decAdd(committed, vol);
    }
    const movedSet = new Set(moved);
    for (const n of moved) {
      const o = await orderInTx(client, n);
      await client.query(`UPDATE orders SET status = 'requested', conflict = 'restriction', scheduled_at = null WHERE number = $1`, [n]);
      await client.query(`DELETE FROM gate_cards WHERE order_number = $1 AND kind = 'start' AND state = 'open'`, [n]);
      const vol = scheduled.rows.find((r) => r.number === n)!.volume_ml;
      await client.query("UPDATE windows SET committed_ml = $1 WHERE id = $2", [
        decStr3(decSub(decParse((await lockWindow(client, windowId))!.committed_ml)!, decParse(vol)!)),
        windowId,
      ]);
      await client.query("UPDATE allocations SET debited_ml = (debited_ml::numeric - $1::numeric)::text WHERE grower_id = $2", [
        vol,
        scheduled.rows.find((r) => r.number === n)!.grower_id,
      ]);
    }

    // notices: one per grower with a scheduled, running or just-moved order
    const noticeRows = await client.query<{ grower_id: number; number: string; turnout: string; volume_ml: string; status: string; holder_code: string | null; conflict: string | null }>(
      `SELECT grower_id, number, turnout, volume_ml, status, holder_code, conflict FROM orders WHERE window_id = $1 ORDER BY number`,
      [windowId],
    );
    const byGrower = new Map<number, Array<{ number: string; turnout: string; volume_ml: string; status: string; holder_code: string | null; moved: boolean }>>();
    for (const r of noticeRows.rows) {
      const isMoved = movedSet.has(r.number);
      const counts = r.status === "scheduled" || r.status === "running" || isMoved;
      if (!counts) continue;
      const list = byGrower.get(r.grower_id) ?? [];
      list.push({ number: r.number, turnout: r.turnout, volume_ml: r.volume_ml, status: isMoved ? "requested" : r.status, holder_code: r.holder_code, moved: isMoved });
      byGrower.set(r.grower_id, list);
    }
    const winAfter = await store.windowByIdInTx(client, windowId);
    for (const [growerId, orders] of byGrower) {
      const lines = orders.map(
        (o) => `Order ${o.number} ${o.turnout} ${o.volume_ml} ML ${o.status}${o.holder_code ? `, gate worked by ${o.holder_code}` : ""}.`,
      );
      const movedLines = orders.filter((o) => o.moved).map(
        (o) => `Order ${o.number} no longer fits and is back in requested. Its volume is back in your allocation.`,
      );
      const effLabel = formatInstant(effectiveAt);
      const body =
        `The cap on ${winAfter!.channel_name}, ${winAfter!.label} is now ${capMlDay} ML/day from ${effLabel}.\n` +
        `The window's cap volume is ${newCapVolume} ML and ${winAfter!.remaining_ml} ML is left.\n\n` +
        lines.join("\n") +
        (movedLines.length ? "\n\n" + movedLines.join("\n") : "");
      await client.query(
        `INSERT INTO notices (kind, grower_id, window_id, subject, body, state, created_at) VALUES ('restriction', $1, $2, $3, $4, 'queued', now())`,
        [growerId, windowId, `Ditchbook restriction: ${winAfter!.channel_name}, ${winAfter!.label}`, body],
      );
    }

    const winFinal = await store.windowByIdInTx(client, windowId);
    return {
      restriction: {
        id: restriction.rows[0]!.id,
        window_id: windowId,
        cap_ml_day: capMlDay,
        reason: reason.trim(),
        effective_at: formatInstant(effectiveAt),
      },
      window: winFinal!,
      moved_orders: moved,
    };
  });
}

// --- rations -------------------------------------------------------------------

export type RationResult = {
  window: WindowRow;
  rationed: Array<{ order_number: string; requested_ml: string; volume_ml: string }>;
  left_requested: string[];
};

export async function rationWindow(store: Store, windowId: string, now: number): Promise<RationResult> {
  return store.transaction(async (client) => {
    await store.lapseWindowIfNeeded(client, windowId, now);
    const window = await lockWindowOr404(client, windowId);
    if (now >= window.closes_at) throw new ApiError(409, "window_closed", "This window has closed.");

    const requested = await client.query<{
      number: string; grower_id: number; turnout: string; requested_ml: string; volume_ml: string;
    }>(
      `SELECT number, grower_id, turnout, requested_ml, volume_ml FROM orders WHERE window_id = $1 AND status = 'requested' ORDER BY number`,
      [windowId],
    );
    if (requested.rows.length === 0) throw new ApiError(409, "nothing_to_ration", "No requested orders to ration.");

    // candidates: at most one per turnout (lowest order number), turnout free
    const busyTurnouts = new Set(
      (
        await client.query<{ turnout: string }>(
          `SELECT DISTINCT turnout FROM orders WHERE status IN ('scheduled','running')`,
          [],
        )
      ).rows.map((r) => r.turnout),
    );
    const seenTurnout = new Set<string>();
    const candidates: RationCandidate[] = [];
    const turnoutMaxCache = new Map<string, string>();
    for (const r of requested.rows) {
      if (busyTurnouts.has(r.turnout) || seenTurnout.has(r.turnout)) continue;
      seenTurnout.add(r.turnout);
      if (!turnoutMaxCache.has(r.turnout)) {
        const t = await client.query<{ max_rate_ml_day: string }>("SELECT max_rate_ml_day FROM turnouts WHERE code = $1", [r.turnout]);
        turnoutMaxCache.set(r.turnout, turnoutMaxMl(t.rows[0]!.max_rate_ml_day, window.hours));
      }
      candidates.push({ orderNumber: r.number, growerId: r.grower_id, demand: r.volume_ml, });
    }
    if (candidates.length === 0) throw new ApiError(409, "nothing_to_ration", "No requested orders to ration.");

    // demands capped by turnout max volume and grower remaining allocation
    const allocGiven = new Map<number, string>();
    const rowsInfo = new Map<string, { growerId: number; turnout: string; requested: string }>();
    for (const c of candidates) {
      const r = requested.rows.find((x) => x.number === c.orderNumber)!;
      rowsInfo.set(c.orderNumber, { growerId: r.grower_id, turnout: r.turnout, requested: r.requested_ml });
    }
    // lock allocation rows in grower-id order
    const growerIds = [...new Set(candidates.map((c) => c.growerId))].sort((a, b) => a - b);
    const allocations = new Map<number, string>();
    for (const gid of growerIds) {
      const a = await lockAllocation(client, gid);
      allocations.set(gid, a!.remaining_ml);
      allocGiven.set(gid, "0.000");
    }
    for (const c of candidates) {
      const info = rowsInfo.get(c.orderNumber)!;
      const maxVol = turnoutMaxCache.get(info.turnout)!;
      const allocLeft = decStr3(decSub(decParse(allocations.get(c.growerId)!)!, decParse(allocGiven.get(c.growerId)!)!));
      let demand = c.demand;
      if (decCmp(decParse(demand)!, decParse(maxVol)!) > 0) demand = maxVol;
      if (decCmp(decParse(demand)!, decParse(allocLeft)!) > 0) demand = allocLeft;
      if (decCmp(decParse(demand)!, decParse("0.000")!) < 0) demand = "0.000";
      c.demand = demand;
      allocGiven.set(c.growerId, decStr3(decAdd(decParse(allocGiven.get(c.growerId)!)!, decParse(demand)!)));
    }

    const remaining = computeRemaining(window.cap_volume_ml, window.committed_ml);
    const { shares, scheduled } = rationShares(candidates, remaining);

    // apply: window already locked; allocations already locked
    let newCommitted = decParse(window.committed_ml)!;
    const rationedOut: Array<{ order_number: string; requested_ml: string; volume_ml: string }> = [];
    for (const c of candidates) {
      const share = shares.get(c.orderNumber)!;
      const info = rowsInfo.get(c.orderNumber)!;
      if (share === "0.000") continue;
      const rate = rateMlDay(share, window.hours);
      const order = await orderInTx(client, c.orderNumber);
      await client.query(
        `UPDATE orders SET volume_ml = $1, rate_ml_day = $2, status = 'scheduled', rationed = true, conflict = null, scheduled_at = $3 WHERE number = $4`,
        [share, rate, new Date(now), c.orderNumber],
      );
      newCommitted = decAdd(newCommitted, decParse(share)!);
      await client.query("UPDATE allocations SET debited_ml = (debited_ml::numeric + $1::numeric)::text WHERE grower_id = $2", [share, info.growerId]);
      await issueStartCard(client, order!, order!.holder_code ?? window.rostered_operator);
      rationedOut.push({ order_number: c.orderNumber, requested_ml: info.requested, volume_ml: share });
    }
    await client.query("UPDATE windows SET committed_ml = $1 WHERE id = $2", [decStr3(newCommitted), windowId]);

    // ration notices: one per grower with at least one candidate
    const byGrower = new Map<number, Array<{ number: string; share: string; requested: string; rate: string; holder: string | null; scheduled: boolean }>>();
    for (const c of candidates) {
      const info = rowsInfo.get(c.orderNumber)!;
      const share = shares.get(c.orderNumber)!;
      const rate = rateMlDay(share, window.hours);
      const order = await orderInTx(client, c.orderNumber);
      const list = byGrower.get(info.growerId) ?? [];
      list.push({ number: c.orderNumber, share, requested: info.requested, rate, holder: order?.holder_code ?? null, scheduled: share !== "0.000" });
      byGrower.set(info.growerId, list);
    }
    const winAfter = await store.windowByIdInTx(client, windowId);
    for (const [growerId, lines] of byGrower) {
      const body = lines
        .map((l) =>
          l.scheduled
            ? `Order ${l.number} rationed to ${l.share} ML of ${l.requested} ML at ${l.rate} ML/day. Gate worked by ${l.holder}.`
            : `Order ${l.number} stays requested. No capacity was left for it. Gate worked by ${l.holder}.`,
        )
        .join("\n");
      await client.query(
        `INSERT INTO notices (kind, grower_id, window_id, subject, body, state, created_at) VALUES ('ration', $1, $2, $3, $4, 'queued', now())`,
        [growerId, windowId, `Ditchbook ration: ${winAfter!.channel_name}, ${winAfter!.label}`, body],
      );
    }

    const stillRequested = (
      await client.query<{ number: string }>(`SELECT number FROM orders WHERE window_id = $1 AND status = 'requested' ORDER BY number`, [windowId])
    ).rows.map((r) => r.number);

    const winFinal = await store.windowByIdInTx(client, windowId);
    return { window: winFinal!, rationed: rationedOut, left_requested: stillRequested };
  });
}

// --- helpers -------------------------------------------------------------------

type LockedWindow = WindowRow;

async function lockWindow(client: pg.PoolClient, windowId: string): Promise<LockedWindow | null> {
  const res = await client.query<{
    id: string; channel_id: string; channel_name: string; opens_at: Date; closes_at: Date; hours: number;
    rostered_operator: string; restriction_cap_ml_day: string | null; restriction_effective_at: Date | null;
    table_cap: string; committed_ml: string; delivered_ml: string;
  }>(
    `SELECT w.*, c.name AS channel_name,
       (SELECT cc.cap_ml_day FROM capacity_cells cc JOIN capacity_revisions r ON r.id = cc.revision_id
        WHERE cc.window_id = w.id ORDER BY r.revision DESC, r.id DESC LIMIT 1) AS table_cap
     FROM windows w JOIN channels c ON c.id = w.channel_id WHERE w.id = $1 FOR UPDATE OF w`,
    [windowId],
  );
  const row = res.rows[0];
  if (!row) return null;
  const capVolume = capVolumeMl(row.table_cap, row.restriction_cap_ml_day, row.restriction_effective_at?.getTime() ?? null, row.opens_at.getTime(), row.hours);
  return {
    id: row.id,
    channel_id: row.channel_id,
    channel_name: row.channel_name,
    opens_at: row.opens_at.getTime(),
    closes_at: row.closes_at.getTime(),
    hours: row.hours,
    label: "",
    rostered_operator: row.rostered_operator,
    restriction_cap_ml_day: row.restriction_cap_ml_day,
    restriction_effective_at: row.restriction_effective_at?.getTime() ?? null,
    table_cap_ml_day: row.table_cap,
    effective_cap_ml_day: effectiveCapMlDay(row.table_cap, row.restriction_cap_ml_day),
    cap_volume_ml: capVolume,
    committed_ml: row.committed_ml,
    delivered_ml: row.delivered_ml,
    remaining_ml: computeRemaining(capVolume, row.committed_ml),
    channel_flow_ml_day: "0.000",
  };
}

async function lockWindowOr404(client: pg.PoolClient, windowId: string): Promise<LockedWindow> {
  const w = await lockWindow(client, windowId);
  if (!w) throw new ApiError(404, "not_found", "There is no such record.");
  return w;
}

async function lockAllocation(client: pg.PoolClient, growerId: number): Promise<{ remaining_ml: string } | null> {
  const res = await client.query<{ allocation_ml: string; debited_ml: string }>(
    "SELECT allocation_ml, debited_ml FROM allocations WHERE grower_id = $1 FOR SHARE",
    [growerId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { remaining_ml: decStr3(decSub(decParse(row.allocation_ml)!, decParse(row.debited_ml)!)) };
}

async function lockOrder(client: pg.PoolClient, number: string): Promise<OrderRow> {
  const res = await client.query(
    `SELECT o.*, p.name AS grower_name FROM orders o JOIN people p ON p.id = o.grower_id WHERE o.number = $1 FOR UPDATE OF o`,
    [number],
  );
  const row = res.rows[0];
  if (!row) throw new ApiError(404, "not_found", "There is no such record.");
  return {
    number: row.number,
    grower_id: row.grower_id,
    grower_name: row.grower_name,
    turnout: row.turnout,
    window_id: row.window_id,
    requested_ml: row.requested_ml,
    volume_ml: row.volume_ml,
    rate_ml_day: row.rate_ml_day,
    status: row.status,
    holder_code: row.holder_code,
    standby_code: row.standby_code,
    conflict: row.conflict,
    rationed: row.rationed,
    closed_after_flow: row.closed_after_flow,
    scheduled_at: row.scheduled_at?.getTime() ?? null,
  };
}

async function orderInTx(client: pg.PoolClient, number: string): Promise<OrderRow | null> {
  const res = await client.query(
    `SELECT o.*, p.name AS grower_name FROM orders o JOIN people p ON p.id = o.grower_id WHERE o.number = $1`,
    [number],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    number: row.number,
    grower_id: row.grower_id,
    grower_name: row.grower_name,
    turnout: row.turnout,
    window_id: row.window_id,
    requested_ml: row.requested_ml,
    volume_ml: row.volume_ml,
    rate_ml_day: row.rate_ml_day,
    status: row.status,
    holder_code: row.holder_code,
    standby_code: row.standby_code,
    conflict: row.conflict,
    rationed: row.rationed,
    closed_after_flow: row.closed_after_flow,
    scheduled_at: row.scheduled_at?.getTime() ?? null,
  };
}

async function nextOrderNumber(client: pg.PoolClient): Promise<string> {
  const res = await client.query<{ n: number }>(`SELECT nextval('orders_seq')::int AS n`);
  return `ORD-${String(res.rows[0]!.n).padStart(5, "0")}`;
}

async function issueStartCard(client: pg.PoolClient, order: OrderRow, holderCode: string): Promise<void> {
  await client.query(
    `INSERT INTO gate_cards (order_number, turnout, channel_id, window_id, kind, state, holder_code, from_ml_day, to_ml_day)
     VALUES ($1,$2,(SELECT channel_id FROM windows WHERE id = $3),$3,'start','open',$4,'0.000',$5)`,
    [order.number, order.turnout, order.window_id, holderCode, order.rate_ml_day],
  );
}

async function checkOperators(client: pg.PoolClient, operatorCode: string, standbyCode: string | null): Promise<void> {
  const res = await client.query<{ code: string; erased: boolean }>(
    "SELECT operator_code AS code, erased FROM people WHERE role = 'operator' AND operator_code = ANY($1)",
    [standbyCode ? [operatorCode, standbyCode] : [operatorCode]],
  );
  const byCode = new Map(res.rows.map((r) => [r.code, r]));
  const errors: Record<string, string> = {};
  if (!byCode.has(operatorCode) || byCode.get(operatorCode)!.erased) {
    errors.operator_code = "Choose an operator who has not been erased.";
  }
  if (standbyCode !== null) {
    if (!byCode.has(standbyCode) || byCode.get(standbyCode)!.erased) {
      errors.standby_code = "Choose an operator who has not been erased.";
    } else if (standbyCode === operatorCode) {
      errors.standby_code = "The standby must differ from the gate worker.";
    }
  }
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
}

function validateVolume(volumeMl: string): void {
  const d = decParse(volumeMl);
  if (d === null) throw fieldErrors({ volume_ml: "Volume must be a number with at most three decimals." });
  if (decCmp(d, decParse("0.000")!) <= 0) throw fieldErrors({ volume_ml: "Volume must be greater than 0." });
  if (decCmp(d, decParse("500.000")!) > 0) throw fieldErrors({ volume_ml: "Volume must be at most 500.000 ML." });
  const places = (volumeMl.split(".")[1] ?? "").length;
  if (places > 3) throw fieldErrors({ volume_ml: "Volume must have at most three decimals." });
}

function validateCap(capMlDay: string): void {
  const d = decParse(capMlDay);
  if (d === null) throw fieldErrors({ cap_ml_day: "Cap must be a number with at most three decimals." });
  if (decCmp(d, decParse("0.000")!) <= 0) throw fieldErrors({ cap_ml_day: "Cap must be greater than 0." });
  if (decCmp(d, decParse("10000.000")!) > 0) throw fieldErrors({ cap_ml_day: "Cap must be at most 10000.000 ML/day." });
  const places = (capMlDay.split(".")[1] ?? "").length;
  if (places > 3) throw fieldErrors({ cap_ml_day: "Cap must have at most three decimals." });
}

function windowStatusClosed(window: { closes_at: number }, now: number): boolean {
  return now >= window.closes_at;
}

