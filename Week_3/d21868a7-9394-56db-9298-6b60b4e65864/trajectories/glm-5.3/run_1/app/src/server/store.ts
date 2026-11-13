// The store: every capacity, allocation, ration, lapse, holder and state
// decision is made here, in one database step per judgement.
import pg from "pg";
import { decAdd, decParse, decStr3, decSub, decRound3 } from "../shared/decimal.ts";
import {
  capVolumeMl, effectiveCapMlDay, remainingMl as computeRemaining,
} from "../shared/domain.ts";
import { formatInstant, windowLabel } from "../shared/district-time.ts";

export type Role = "grower" | "operator" | "dispatcher" | "clerk" | "reviewer";
export type UserRow = {
  id: number;
  name: string;
  email: string;
  role: Role;
  operator_code: string | null;
  operator_kind: string | null;
  phone: string | null;
  erased: boolean;
};

export type WindowRow = {
  id: string;
  channel_id: string;
  channel_name: string;
  opens_at: number;
  closes_at: number;
  hours: number;
  label: string;
  rostered_operator: string;
  restriction_cap_ml_day: string | null;
  restriction_effective_at: number | null;
  table_cap_ml_day: string;
  effective_cap_ml_day: string;
  cap_volume_ml: string;
  committed_ml: string;
  delivered_ml: string;
  remaining_ml: string;
  channel_flow_ml_day: string;
};

export type OrderRow = {
  number: string;
  grower_id: number;
  grower_name: string;
  turnout: string;
  window_id: string;
  requested_ml: string;
  volume_ml: string;
  rate_ml_day: string;
  status: string;
  holder_code: string | null;
  standby_code: string | null;
  conflict: string | null;
  rationed: boolean;
  closed_after_flow: boolean;
  scheduled_at: number | null;
};

export type CardRow = {
  id: number;
  order_number: string;
  turnout: string;
  channel_id: string;
  window_id: string;
  kind: string;
  state: string;
  holder_code: string;
  from_ml_day: string;
  to_ml_day: string;
  stroke_key: string | null;
  stroke: { key: string; committed_at: string; confirmed_at: string | null; operator_code: string } | null;
  created_at: number;
};

export type AllocationRow = {
  allocation_ml: string;
  debited_ml: string;
  remaining_ml: string;
};

const ORDER_ACTIONS_ERR: Record<string, string> = {
  illegal_transition: "That change is not allowed for this order now.",
  turnout_busy: "This turnout already has an order scheduled or running.",
  allocation_exceeded: "This grower does not have enough allocation left.",
  window_full: "Not enough capacity left in this window.",
  window_closed: "This window has closed.",
  not_reopenable: "This order cannot be reopened.",
};

function ms(v: Date | string | null): number | null {
  if (v === null) return null;
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

export class Store {
  constructor(private pool: pg.Pool) {}

  async query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
    return this.pool.query<T>(sql, params);
  }

  async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // --- people and sessions ---------------------------------------------------

  async userByEmail(email: string): Promise<UserRow | null> {
    const res = await this.query<UserRow & { password_hash: string }>(
      "SELECT id, name, email, role, operator_code, operator_kind, phone, erased, password_hash FROM people WHERE lower(email) = lower($1)",
      [email],
    );
    const row = res.rows[0];
    if (!row) return null;
    return { ...(row as UserRow), role: row.role as Role };
  }

  async userById(id: number): Promise<UserRow | null> {
    const res = await this.query<UserRow & { password_hash: string }>(
      "SELECT id, name, email, role, operator_code, operator_kind, phone, erased, password_hash FROM people WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    if (!row) return null;
    return { ...(row as UserRow), role: row.role as Role };
  }

  async createSession(personId: number): Promise<string> {
    const token = crypto.randomUUID() + crypto.randomUUID();
    await this.query("INSERT INTO sessions (token, person_id) VALUES ($1,$2)", [token, personId]);
    return token;
  }

  async userBySession(token: string): Promise<UserRow | null> {
    const res = await this.query<UserRow>(
      `SELECT p.id, p.name, p.email, p.role, p.operator_code, p.operator_kind, p.phone, p.erased
       FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.token = $1`,
      [token],
    );
    return (res.rows[0] as UserRow) ?? null;
  }

  async deleteSession(token: string): Promise<void> {
    await this.query("DELETE FROM sessions WHERE token = $1", [token]);
  }

  async deleteSessionsOf(personId: number): Promise<void> {
    await this.query("DELETE FROM sessions WHERE person_id = $1", [personId]);
  }

  // --- window reads ----------------------------------------------------------

  async channelList(): Promise<Array<{ id: string; name: string; capacity_revision: number }>> {
    const res = await this.query<{ id: string; name: string; rev: number }>(
      `SELECT c.id, c.name, COALESCE(MAX(r.revision), 0) AS rev FROM channels c
       LEFT JOIN capacity_revisions r ON r.channel_id = c.id
       GROUP BY c.id, c.name, c.rail_order ORDER BY c.rail_order`,
    );
    return res.rows.map((r) => ({ id: r.id, name: r.name, capacity_revision: r.rev }));
  }

  async channelRailOrder(): Promise<Map<string, number>> {
    const res = await this.query<{ id: string; rail_order: number }>("SELECT id, rail_order FROM channels ORDER BY rail_order");
    return new Map(res.rows.map((r) => [r.id, r.rail_order]));
  }

  async windowById(id: string): Promise<WindowRow | null> {
    const res = await this.query<WindowRaw & { channel_name: string }>(
      `SELECT w.*, c.name AS channel_name FROM windows w JOIN channels c ON c.id = w.channel_id WHERE w.id = $1`,
      [id],
    );
    const row = res.rows[0];
    if (!row) return null;
    return toWindowRow(row, await this.tableCap(row.id), await this.channelFlow(row.channel_id));
  }

  async windowsFor(channelId: string | null): Promise<WindowRow[]> {
    const res = await this.query<WindowRaw & { channel_name: string; rail_order: number }>(
      `SELECT w.*, c.name AS channel_name, c.rail_order FROM windows w JOIN channels c ON c.id = w.channel_id
       ${channelId ? "WHERE w.channel_id = $1" : ""} ORDER BY c.rail_order, w.opens_at`,
      channelId ? [channelId] : [],
    );
    const caps = await this.tableCaps();
    const flows = await this.channelFlows();
    return res.rows.map((r) => toWindowRowWith(r, caps.get(r.id) ?? "0.000", flows.get(r.channel_id) ?? "0.000"));
  }

  private async tableCap(windowId: string): Promise<string> {
    const res = await this.query<{ cap_ml_day: string }>(
      `SELECT cc.cap_ml_day FROM capacity_cells cc
       JOIN capacity_revisions r ON r.id = cc.revision_id
       WHERE cc.window_id = $1
       ORDER BY r.revision DESC, r.id DESC LIMIT 1`,
      [windowId],
    );
    return res.rows[0]?.cap_ml_day ?? "0.000";
  }

  private async tableCaps(): Promise<Map<string, string>> {
    const res = await this.query<{ window_id: string; cap_ml_day: string; revision: number; rid: number }>(
      `SELECT cc.window_id, cc.cap_ml_day, r.revision, r.id AS rid FROM capacity_cells cc
       JOIN capacity_revisions r ON r.id = cc.revision_id`,
    );
    const best = new Map<string, string>();
    const revSeen = new Map<string, { rev: number; id: number }>();
    for (const r of res.rows) {
      const seen = revSeen.get(r.window_id);
      if (!seen || r.revision > seen.rev || (r.revision === seen.rev && r.rid > seen.id)) {
        revSeen.set(r.window_id, { rev: r.revision, id: r.rid });
        best.set(r.window_id, r.cap_ml_day);
      }
    }
    return best;
  }

  private async channelFlow(channelId: string): Promise<string> {
    const res = await this.query<{ flow: string }>(
      `SELECT (COALESCE(SUM(o.rate_ml_day::numeric), 0))::text AS flow FROM orders o
       JOIN windows w ON w.id = o.window_id
       WHERE w.channel_id = $1 AND o.status = 'running'`,
      [channelId],
    );
    return decStr3(decRound3(decParse(res.rows[0]?.flow ?? "0")!));
  }

  private async channelFlows(): Promise<Map<string, string>> {
    const res = await this.query<{ channel_id: string; flow: string }>(
      `SELECT w.channel_id, (COALESCE(SUM(o.rate_ml_day::numeric), 0))::text AS flow FROM orders o
       JOIN windows w ON w.id = o.window_id WHERE o.status = 'running' GROUP BY w.channel_id`,
    );
    const m = new Map<string, string>();
    for (const r of res.rows) m.set(r.channel_id, decStr3(decRound3(decParse(r.flow)!)));
    return m;
  }

  // --- lapse -----------------------------------------------------------------

  // Judge the lapse at close before answering any read or write that touches
  // this window. Exactly-once: guarded by windows_lapse_done.
  async lapseWindowIfNeeded(client: pg.PoolClient, windowId: string, now: number): Promise<string[]> {
    const wres = await client.query<WindowRaw>(`SELECT * FROM windows WHERE id = $1 FOR UPDATE`, [windowId]);
    const w = wres.rows[0];
    if (!w) return [];
    if (now < w.closes_at.getTime()) return [];
    const done = await client.query<{ window_id: string }>("SELECT window_id FROM windows_lapse_done WHERE window_id = $1 FOR UPDATE", [windowId]);
    if (done.rows.length > 0) return [];

    // find orders to lapse
    const lapsed = await client.query<{ number: string; grower_id: number; status: string; volume_ml: string }>(
      `SELECT number, grower_id, status, volume_ml FROM orders WHERE window_id = $1 AND status IN ('requested','scheduled') ORDER BY number FOR UPDATE`,
      [windowId],
    );
    const byGrower = new Map<number, Array<{ number: string; status: string; volume_ml: string }>>();
    const numbers: string[] = [];
    for (const o of lapsed.rows) {
      numbers.push(o.number);
      const list = byGrower.get(o.grower_id) ?? [];
      list.push({ number: o.number, status: o.status, volume_ml: o.volume_ml });
      byGrower.set(o.grower_id, list);
    }
    const scheduledVolumeByGrower = new Map<number, string>();
    for (const o of lapsed.rows) {
      if (o.status === "scheduled") {
        const prior = decParse(scheduledVolumeByGrower.get(o.grower_id) ?? "0.000")!;
        scheduledVolumeByGrower.set(o.grower_id, decStr3(decAdd(prior, decParse(o.volume_ml)!)));
      }
    }
    const scheduledTotal = lapsed.rows
      .filter((o) => o.status === "scheduled")
      .reduce((a, o) => decAdd(a, decParse(o.volume_ml)!), decParse("0.000")!);

    await client.query(
      `UPDATE orders SET status = 'closed', conflict = 'lapsed', closed_after_flow = false WHERE window_id = $1 AND status IN ('requested','scheduled')`,
      [windowId],
    );
    await client.query(`DELETE FROM gate_cards WHERE window_id = $1 AND kind = 'start' AND state = 'open'`, [windowId]);
    await client.query(
      `UPDATE windows SET committed_ml = $1 WHERE id = $2`,
      [decStr3(decSub(decParse(w.committed_ml)!, scheduledTotal)), windowId],
    );
    for (const [growerId, vol] of scheduledVolumeByGrower) {
      await client.query(`UPDATE allocations SET debited_ml = (debited_ml::numeric - $1::numeric)::text WHERE grower_id = $2`, [vol, growerId]);
    }

    // one lapse notice per grower with at least one order lapsed
    const wRow = await this.windowByIdInTx(client, windowId);
    const label = wRow ? wRow.label : windowId;
    const channelName = wRow ? wRow.channel_name : "";
    const created: string[] = [];
    for (const [growerId, orders] of byGrower) {
      const body = orders
        .map((o) =>
          o.status === "scheduled"
            ? `Order ${o.number} lapsed when the window closed. ${o.volume_ml} ML is back in your allocation.`
            : `Order ${o.number} lapsed when the window closed. Nothing was debited for it.`,
        )
        .join("\n");
      await client.query(
        `INSERT INTO notices (kind, grower_id, window_id, subject, body, state, created_at) VALUES ('lapse', $1, $2, $3, $4, 'queued', now())`,
        [growerId, windowId, `Ditchbook lapse: ${channelName}, ${label}`, body],
      );
      created.push(String(growerId));
    }
    await client.query(`INSERT INTO windows_lapse_done (window_id, done_at) VALUES ($1, now())`, [windowId]);
    return numbers;
  }

  async windowByIdInTx(client: pg.PoolClient, id: string): Promise<WindowRow | null> {
    const res = await client.query<WindowRaw & { channel_name: string }>(
      `SELECT w.*, c.name AS channel_name FROM windows w JOIN channels c ON c.id = w.channel_id WHERE w.id = $1`,
      [id],
    );
    const row = res.rows[0];
    if (!row) return null;
    const cap = await this.tableCapInTx(client, row.id);
    const flow = await this.channelFlowInTx(client, row.channel_id);
    return toWindowRow(row, cap, flow);
  }

  private async tableCapInTx(client: pg.PoolClient, windowId: string): Promise<string> {
    const res = await client.query<{ cap_ml_day: string }>(
      `SELECT cc.cap_ml_day FROM capacity_cells cc JOIN capacity_revisions r ON r.id = cc.revision_id
       WHERE cc.window_id = $1 ORDER BY r.revision DESC, r.id DESC LIMIT 1`,
      [windowId],
    );
    return res.rows[0]?.cap_ml_day ?? "0.000";
  }

  private async channelFlowInTx(client: pg.PoolClient, channelId: string): Promise<string> {
    const res = await client.query<{ flow: string }>(
      `SELECT (COALESCE(SUM(o.rate_ml_day::numeric), 0))::text AS flow FROM orders o JOIN windows w ON w.id = o.window_id
       WHERE w.channel_id = $1 AND o.status = 'running'`,
      [channelId],
    );
    return decStr3(decRound3(decParse(res.rows[0]?.flow ?? "0.000")!));
  }

  // --- orders ----------------------------------------------------------------

  async orderRow(number: string): Promise<OrderRow | null> {
    const res = await this.query<OrderRaw & { grower_name: string }>(
      `SELECT o.*, p.name AS grower_name FROM orders o JOIN people p ON p.id = o.grower_id WHERE o.number = $1`,
      [number],
    );
    return res.rows[0] ? toOrderRow(res.rows[0]) : null;
  }

  async ordersFor(windowId: string | null, growerId: number | null): Promise<OrderRow[]> {
    const res = await this.query<OrderRaw & { grower_name: string }>(
      `SELECT o.*, p.name AS grower_name FROM orders o JOIN people p ON p.id = o.grower_id
       WHERE ($1::text IS NULL OR o.window_id = $1) AND ($2::int IS NULL OR o.grower_id = $2)
       ORDER BY o.seq`,
      [windowId, growerId],
    );
    return res.rows.map(toOrderRow);
  }

  async allocationOf(growerId: number): Promise<AllocationRow | null> {
    const res = await this.query<{ allocation_ml: string; debited_ml: string }>(
      "SELECT allocation_ml, debited_ml FROM allocations WHERE grower_id = $1",
      [growerId],
    );
    const row = res.rows[0];
    if (!row) return null;
    const remaining = decStr3(decSub(decParse(row.allocation_ml)!, decParse(row.debited_ml)!));
    return { allocation_ml: row.allocation_ml, debited_ml: row.debited_ml, remaining_ml: remaining };
  }

  async allocationOfInTx(client: pg.PoolClient, growerId: number): Promise<AllocationRow | null> {
    const res = await client.query<{ allocation_ml: string; debited_ml: string }>(
      "SELECT allocation_ml, debited_ml FROM allocations WHERE grower_id = $1 FOR UPDATE",
      [growerId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      allocation_ml: row.allocation_ml,
      debited_ml: row.debited_ml,
      remaining_ml: decStr3(decSub(decParse(row.allocation_ml)!, decParse(row.debited_ml)!)),
    };
  }

  // --- turnouts and operators -------------------------------------------------

  async turnoutsFor(growerId: number | null): Promise<Array<{ code: string; channel_id: string; grower_id: number; max_rate_ml_day: string }>> {
    const res = await this.query<{ code: string; channel_id: string; grower_id: number; max_rate_ml_day: string }>(
      `SELECT t.code, t.channel_id, t.grower_id, t.max_rate_ml_day FROM turnouts t
       JOIN channels c ON c.id = t.channel_id
       ${growerId === null ? "" : "WHERE t.grower_id = $1"} ORDER BY c.rail_order, t.code`,
      growerId === null ? [] : [growerId],
    );
    return res.rows;
  }

  async operators(): Promise<Array<{ code: string; kind: string; name: string | null; erased: boolean }>> {
    const res = await this.query<{ code: string; kind: string; name: string | null; erased: boolean }>(
      "SELECT operator_code AS code, operator_kind AS kind, name, erased FROM people WHERE role = 'operator' ORDER BY operator_code",
    );
    return res.rows;
  }

  // --- gate cards ------------------------------------------------------------

  async cardsFor(operatorCode: string | null, windowId: string | null): Promise<CardRow[]> {
    const res = await this.query<CardRaw>(
      `SELECT * FROM gate_cards
       WHERE ($1::text IS NULL OR holder_code = $1)
       ${windowId ? "AND window_id = $2" : ""}
       ORDER BY id DESC`,
      windowId ? [operatorCode, windowId] : [operatorCode],
    );
    return res.rows.map(toCardRow);
  }

  async allOpenCards(): Promise<CardRow[]> {
    const res = await this.query<CardRaw>(`SELECT * FROM gate_cards ORDER BY id DESC`);
    return res.rows.map(toCardRow);
  }

  async cardById(id: number): Promise<CardRow | null> {
    const res = await this.query<CardRaw>(`SELECT * FROM gate_cards WHERE id = $1`, [id]);
    return res.rows[0] ? toCardRow(res.rows[0]) : null;
  }
}

// --- row mapping ---------------------------------------------------------------

type WindowRaw = {
  id: string;
  channel_id: string;
  opens_at: Date;
  closes_at: Date;
  hours: number;
  rostered_operator: string;
  restriction_cap_ml_day: string | null;
  restriction_effective_at: Date | null;
  cap_volume_ml: string;
  committed_ml: string;
  delivered_ml: string;
};

type OrderRaw = {
  number: string;
  grower_id: number;
  turnout: string;
  window_id: string;
  requested_ml: string;
  volume_ml: string;
  rate_ml_day: string;
  status: string;
  holder_code: string | null;
  standby_code: string | null;
  conflict: string | null;
  rationed: boolean;
  closed_after_flow: boolean;
  scheduled_at: Date | null;
  grower_name: string;
};

type CardRaw = {
  id: number;
  order_number: string;
  turnout: string;
  channel_id: string;
  window_id: string;
  kind: string;
  state: string;
  holder_code: string;
  from_ml_day: string;
  to_ml_day: string;
  stroke_key: string | null;
  stroke_committed_at: Date | null;
  stroke_confirmed_at: Date | null;
  stroke_operator: string | null;
  created_at: Date;
};

function toWindowRowWith(r: WindowRaw & { channel_name: string }, tableCap: string, flow: string): WindowRow {
  return toWindowRow(r, tableCap, flow);
}

function toWindowRow(r: WindowRaw & { channel_name: string }, tableCap: string, flow: string): WindowRow {
  const opens = ms(r.opens_at)!;
  const closes = ms(r.closes_at)!;
  const restrictionCap = r.restriction_cap_ml_day;
  const effAt = ms(r.restriction_effective_at);
  const effCap = effectiveCapMlDay(tableCap, restrictionCap);
  // cap_volume is stored, but the conversion rule recomputes it for serving so
  // that a table change on a restricted window is reflected at once.
  const computed = capVolumeMl(tableCap, restrictionCap, effAt, opens, r.hours);
  return {
    id: r.id,
    channel_id: r.channel_id,
    channel_name: r.channel_name,
    opens_at: opens,
    closes_at: closes,
    hours: r.hours,
    label: windowLabelOf(opens, closes),
    rostered_operator: r.rostered_operator,
    restriction_cap_ml_day: restrictionCap,
    restriction_effective_at: effAt,
    table_cap_ml_day: tableCap,
    effective_cap_ml_day: effCap,
    cap_volume_ml: computed,
    committed_ml: r.committed_ml,
    delivered_ml: r.delivered_ml,
    remaining_ml: computeRemaining(computed, r.committed_ml),
    channel_flow_ml_day: flow,
  };
}

function windowLabelOf(opens: number, closes: number): string {
  return windowLabel(opens, closes);
}

function toOrderRow(r: OrderRaw): OrderRow {
  return {
    number: r.number,
    grower_id: r.grower_id,
    grower_name: r.grower_name,
    turnout: r.turnout,
    window_id: r.window_id,
    requested_ml: r.requested_ml,
    volume_ml: r.volume_ml,
    rate_ml_day: r.rate_ml_day,
    status: r.status,
    holder_code: r.holder_code,
    standby_code: r.standby_code,
    conflict: r.conflict,
    rationed: r.rationed,
    closed_after_flow: r.closed_after_flow,
    scheduled_at: ms(r.scheduled_at),
  };
}

function toCardRow(r: CardRaw): CardRow {
  const stroke =
    r.stroke_key !== null
      ? {
          key: r.stroke_key,
          committed_at: formatInstant(ms(r.stroke_committed_at) ?? 0),
          confirmed_at: r.stroke_confirmed_at ? formatInstant(ms(r.stroke_confirmed_at)!) : null,
          operator_code: r.stroke_operator ?? "",
        }
      : null;
  return {
    id: r.id,
    order_number: r.order_number,
    turnout: r.turnout,
    channel_id: r.channel_id,
    window_id: r.window_id,
    kind: r.kind,
    state: r.state,
    holder_code: r.holder_code,
    from_ml_day: r.from_ml_day,
    to_ml_day: r.to_ml_day,
    stroke_key: r.stroke_key,
    stroke,
    created_at: ms(r.created_at) ?? 0,
  };
}

export { windowLabelOf, ORDER_ACTIONS_ERR };
