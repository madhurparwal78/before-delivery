import { Router } from "express";
import type { PoolClient } from "pg";
import { errors } from "../api-errors.js";
import type { AppLocals, StoreRecord } from "../auth-types.js";
import { literalMatch, isValidQuery, searchLiteral } from "../../shared/search.js";
import { DISPLAY_STATES, STATE_LABELS, type DisplayState } from "../../shared/domain.js";
import {
  addDaysToLocalDate,
  dayPlanFrame,
  localDateInZone,
  localSlotsForDate,
  minutesSinceMidnightLocal,
  parseTimeOnHalfHour,
  planForDate,
  utcOffsetString,
  type DayEntry,
  type HoursPlan,
} from "../time-slots.js";

export type { StoreRecord };

export interface StoreDisplay {
  id: string;
  name: string;
  city: string;
  region: string;
  lat: number;
  lon: number;
  timezone: string;
  vat_rate: number;
  display_state: DisplayState;
  state_label: string;
  suspended: boolean;
  suspension_reason: string | null;
  closes_local: string | null;
  critical_lines: number;
}

export interface PlanBundle {
  current: HoursPlan | null;
  upcoming: HoursPlan | null;
}

export interface StoreBundle {
  record: StoreRecord;
  display: StoreDisplay;
  plans: PlanBundle;
}

export async function loadStoreRecord(client: PoolClient, storeId: string, operatorId: string): Promise<StoreRecord | null> {
  const result = await client.query<StoreRecord>(
    "SELECT id, operator_id, name, city, region, lat, lon, timezone, suspended, suspension_reason FROM stores WHERE id = $1 AND operator_id = $2",
    [storeId, operatorId],
  );
  return result.rows[0] ?? null;
}

export async function loadPlans(client: PoolClient, storeId: string): Promise<PlanBundle> {
  const result = await client.query<{ kind: string; effective_from: string; weekday: number; open: boolean; opens: string | null; closes: string | null }>(
    "SELECT kind, to_char(effective_from,'YYYY-MM-DD') as effective_from, weekday, open, opens::text as opens, closes::text as closes FROM hours_plans WHERE store_id = $1 ORDER BY kind, weekday",
    [storeId],
  );
  const groups = new Map<string, HoursPlan>();
  for (const row of result.rows) {
    let plan = groups.get(row.kind);
    if (!plan) {
      plan = { effective_from: row.effective_from, days: [] };
      groups.set(row.kind, plan);
    }
    plan.days.push({ weekday: row.weekday, open: row.open, opens: row.opens === null ? null : row.opens.slice(0, 5), closes: row.closes === null ? null : row.closes.slice(0, 5) });
  }
  return { current: groups.get("current") ?? null, upcoming: groups.get("upcoming") ?? null };
}

export async function loadCriticalLines(client: PoolClient, storeId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    "SELECT count(*) as count FROM stock_lines WHERE store_id = $1 AND on_hand <= 2",
    [storeId],
  );
  return Number(result.rows[0].count);
}

export async function buildStoreDisplay(client: PoolClient, store: StoreRecord, now: Date): Promise<StoreDisplay> {
  const criticalLines = await loadCriticalLines(client, store.id);
  const plans = await loadPlans(client, store.id);
  const today = localDateInZone(store.timezone, now);
  const entry = planForDate(plans.current, plans.upcoming, today);
  const { state, closesLocal } = computeDisplayState(store, criticalLines, now, entry);
  const tz = store.timezone;
  return {
    id: store.id,
    name: store.name,
    city: store.city,
    region: store.region,
    lat: store.lat,
    lon: store.lon,
    timezone: tz,
    vat_rate: tz === "Atlantic/Azores" ? 16 : 23,
    display_state: state,
    state_label: STATE_LABELS[state],
    suspended: store.suspended,
    suspension_reason: store.suspension_reason,
    closes_local: closesLocal,
    critical_lines: criticalLines,
  };
}

export function computeDisplayState(
  store: StoreRecord,
  criticalLines: number,
  now: Date,
  entry: DayEntry | null,
): { state: DisplayState; closesLocal: string | null } {
  if (store.suspended) return { state: "suspended", closesLocal: null };
  if (criticalLines > 0) {
    const closes = entry && entry.open && entry.closes ? entry.closes : null;
    return { state: "stock_critical", closesLocal: closes };
  }
  if (!entry || !entry.open || entry.opens === null || entry.closes === null) return { state: "closed", closesLocal: null };
  const minutes = minutesSinceMidnightLocal(store.timezone, now);
  const [openH, openM] = entry.opens.split(":").map(Number);
  const [closeH, closeM] = entry.closes.split(":").map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;
  if (minutes < openMinutes || minutes >= closeMinutes) return { state: "closed", closesLocal: entry.closes };
  if (minutes >= closeMinutes - 30) return { state: "closing_soon", closesLocal: entry.closes };
  return { state: "open", closesLocal: entry.closes };
}

export async function loadStoreDisplay(client: PoolClient, storeId: string, operatorId: string, now: Date): Promise<StoreDisplay | null> {
  const store = await loadStoreRecord(client, storeId, operatorId);
  if (!store) return null;
  return buildStoreDisplay(client, store, now);
}

export async function listStoresForOperator(
  client: PoolClient,
  operatorId: string,
  q: string,
  states: DisplayState[] | null,
  now: Date,
): Promise<StoreDisplay[]> {
  const result = await client.query<StoreRecord>(
    "SELECT id, operator_id, name, city, region, lat, lon, timezone, suspended, suspension_reason FROM stores WHERE operator_id = $1 ORDER BY id",
    [operatorId],
  );
  const displays: StoreDisplay[] = [];
  for (const store of result.rows) {
    const display = await buildStoreDisplay(client, store, now);
    if (q && !literalMatch(`${store.name} ${store.id} ${store.city}`, q)) continue;
    if (states && !states.includes(display.display_state)) continue;
    displays.push(display);
  }
  return displays;
}

export function parseStateParam(value: string | undefined): { states: DisplayState[] | null; error: boolean } {
  if (value === undefined || value === "") return { states: null, error: false };
  if (value === "none") return { states: [], error: false };
  const words = value.split(",");
  const seen = new Set<string>();
  const states: DisplayState[] = [];
  for (const word of words) {
    if (!(DISPLAY_STATES as readonly string[]).includes(word)) return { states: null, error: true };
    if (seen.has(word)) continue;
    seen.add(word);
    states.push(word as DisplayState);
  }
  const ordered = DISPLAY_STATES.filter((state) => states.includes(state));
  return { states: ordered, error: false };
}

export function storesRouter(): Router {
  const router = Router();

  router.get("/stores", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const q = searchLiteral(typeof req.query.q === "string" ? req.query.q : undefined);
      if (!isValidQuery(typeof req.query.q === "string" ? req.query.q : undefined)) {
        next(errors.validationFailed({ q: "q must be at most 100 characters" }));
        return;
      }
      const stateRaw = typeof req.query.state === "string" ? req.query.state : undefined;
      const parsed = parseStateParam(stateRaw);
      if (parsed.error) {
        next(errors.validationFailed({ state: "unknown state value" }));
        return;
      }
      const stores = await db.withClient(async (client) => listStoresForOperator(client, auth.user.operatorId, q, parsed.states, new Date()));
      res.json({ count: stores.length, stores });
    } catch (err) {
      next(err);
    }
  });

  router.get("/stores/:id", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const store = await db.withClient(async (client) => loadStoreDisplay(client, req.params.id, auth.user.operatorId, new Date()));
      if (!store) {
        next(errors.notFound());
        return;
      }
      res.json(store);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function storeActionsRouter(): Router {
  const router = Router();

  router.post("/stores/:id/suspension", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      if (auth.user.role !== "lead") {
        const store = await db.withClient(async (client) => loadStoreRecord(client, req.params.id, auth.user.operatorId));
        if (!store) {
          next(errors.notFound());
          return;
        }
        next(errors.forbidden());
        return;
      }
      const body = req.body as { suspended?: unknown; reason?: unknown };
      const suspended = body.suspended === true;
      if (suspended && (typeof body.reason !== "string" || body.reason.trim().length < 1 || body.reason.trim().length > 200)) {
        next(errors.validationFailed({ reason: "Give a reason." }));
        return;
      }
      const store = await db.withClient(async (client) => {
        const record = await loadStoreRecord(client, req.params.id, auth.user.operatorId);
        if (!record) return null;
        await client.query("UPDATE stores SET suspended = $1, suspension_reason = $2 WHERE id = $3", [
          suspended,
          suspended && typeof body.reason === "string" ? body.reason.trim() : null,
          record.id,
        ]);
        return loadStoreDisplay(client, record.id, auth.user.operatorId, new Date());
      });
      if (!store) {
        next(errors.notFound());
        return;
      }
      res.json(store);
    } catch (err) {
      next(err);
    }
  });

  router.get("/stores/:id/stock", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const client = await db.connect();
      try {
        const record = await loadStoreRecord(client, req.params.id, auth.user.operatorId);
        if (!record || !(auth.user.role === "lead" || (auth.user.role === "manager" && auth.storeIds.includes(record.id)))) {
          next(errors.notFound());
          return;
        }
        const lines = await client.query<{ sku: string; name: string; on_hand: number; held: number }>(
          `SELECT s.sku, p.name, s.on_hand, s.held FROM stock_lines s
           JOIN products p ON p.operator_id = $2 AND p.sku = s.sku
           WHERE s.store_id = $1 ORDER BY s.sku`,
          [record.id, auth.user.operatorId],
        );
        const result = lines.rows.map((row) => ({
          sku: row.sku,
          name: row.name,
          on_hand: row.on_hand,
          held: row.held,
          available: row.on_hand - row.held,
          critical: row.on_hand <= 2,
        }));
        res.json({ store_id: record.id, lines: result });
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  });

  router.get("/stores/:id/holds", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const rows = await db.withClient(async (client) => {
        const record = await loadStoreRecord(client, req.params.id, auth.user.operatorId);
        if (!record) return null;
        if (!(auth.user.role === "lead" || (auth.user.role === "manager" && auth.storeIds.includes(record.id)))) return null;
        return holdListForStore(client, record.id);
      });
      if (rows === null) {
        next(errors.notFound());
        return;
      }
      res.json({ holds: rows });
    } catch (err) {
      next(err);
    }
  });

  router.get("/stores/:id/hours", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const answer = await db.withClient(async (client) => {
        const record = await loadStoreRecord(client, req.params.id, auth.user.operatorId);
        if (!record) return null;
        return hoursAnswer(client, record);
      });
      if (answer === null) {
        next(errors.notFound());
        return;
      }
      res.json(answer);
    } catch (err) {
      next(err);
    }
  });

  router.put("/stores/:id/hours", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const answer = await db.withClient(async (client) => {
        const record = await loadStoreRecord(client, req.params.id, auth.user.operatorId);
        if (!record) return { notFound: true as const };
        if (!(auth.user.role === "manager" && auth.storeIds.includes(record.id))) return { forbidden: true as const };
        const validation = validateHoursBody(req.body);
        if (validation) return { validation };
        const localToday = localDateInZone(record.timezone, new Date());
        const effectiveFrom = typeof (req.body as { effective_from?: unknown }).effective_from === "string"
          ? ((req.body as { effective_from: string }).effective_from)
          : localToday;
        const maxDate = addDaysToLocalDate(localToday, 60);
        if (effectiveFrom < localToday || effectiveFrom > maxDate) {
          return { validation: errors.validationFailed({ effective_from: "Pick a date from today to 60 days ahead." }) };
        }
        await publishPlan(client, record.id, effectiveFrom, (req.body as { days: DayEntry[] }).days);
        return { record };
      });
      if (answer === null || "notFound" in answer) {
        next(errors.notFound());
        return;
      }
      if ("forbidden" in answer) {
        next(errors.forbidden());
        return;
      }
      if ("validation" in answer) {
        next(answer.validation);
        return;
      }
      const hours = await db.withClient(async (client) => hoursAnswer(client, answer.record));
      res.json(hours);
    } catch (err) {
      next(err);
    }
  });

  router.get("/stores/:id/day-plan", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const dateParam = typeof req.query.date === "string" ? req.query.date : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam) || Number.isNaN(Date.parse(`${dateParam}T00:00:00Z`))) {
        next(errors.validationFailed({ date: "Pick a valid date." }));
        return;
      }
      if (dateParam < "2026-01-01" || dateParam > "2030-12-31") {
        next(errors.validationFailed({ date: "Pick a date from 2026 to 2030." }));
        return;
      }
      const answer = await db.withClient(async (client) => {
        const record = await loadStoreRecord(client, req.params.id, auth.user.operatorId);
        if (!record) return null;
        return dayPlanAnswer(client, record, dateParam);
      });
      if (answer === null) {
        next(errors.notFound());
        return;
      }
      res.json(answer);
    } catch (err) {
      next(err);
    }
  });

  router.get("/stores/:id/slots", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const answer = await db.withClient(async (client) => {
        const record = await loadStoreRecord(client, req.params.id, auth.user.operatorId);
        if (!record) return null;
        return offeredSlots(client, record);
      });
      if (answer === null) {
        next(errors.notFound());
        return;
      }
      res.json(answer);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export async function holdListForStore(client: PoolClient, storeId: string): Promise<unknown[]> {
  const rows = await client.query<{ id: string; status: string; store_id: string; created_at: Date; expires_at: Date; seconds_left: number; lines: { sku: string; quantity: number }[] }>(
    `SELECT h.id, h.status, h.store_id, h.created_at, h.expires_at,
            (SELECT json_agg(json_build_object('sku', hl.sku, 'quantity', hl.quantity) ORDER BY hl.sku) FROM hold_lines hl WHERE hl.hold_id = h.id) AS lines
       FROM holds h WHERE h.store_id = $1 AND h.status = 'active' ORDER BY h.created_at`,
    [storeId],
  );
  const now = Date.now();
  return rows.rows.map((row) => ({
    id: row.id,
    status: row.status,
    store_id: row.store_id,
    lines: row.lines ?? [],
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
    seconds_left: Math.max(0, Math.ceil((row.expires_at.getTime() - now) / 1000)),
    released_at: null,
  }));
}

export interface HoursAnswer {
  store_id: string;
  timezone: string;
  local_today: string;
  days: DayEntry[];
  upcoming: { effective_from: string; days: DayEntry[] } | null;
}

export async function hoursAnswer(client: PoolClient, store: StoreRecord): Promise<HoursAnswer> {
  const plans = await loadPlans(client, store.id);
  const localToday = localDateInZone(store.timezone, new Date());
  const currentEntry = plans.current;
  const days = currentEntry ? orderedDays(currentEntry.days) : [];
  const upcoming = plans.upcoming ? { effective_from: plans.upcoming.effective_from, days: orderedDays(plans.upcoming.days) } : null;
  return { store_id: store.id, timezone: store.timezone, local_today: localToday, days, upcoming };
}

function orderedDays(days: DayEntry[]): DayEntry[] {
  return [...days].sort((a, b) => a.weekday - b.weekday);
}

function validateHoursBody(body: unknown): ApiErrorShape | null {
  const record = body as { days?: unknown; effective_from?: unknown };
  if (!Array.isArray(record.days) || record.days.length !== 7) {
    return errors.validationFailed({ days: "Seven day entries are required." });
  }
  for (const [index, day] of record.days.entries()) {
    const entry = day as { weekday?: unknown; open?: unknown; opens?: unknown; closes?: unknown };
    if (typeof entry.weekday !== "number" || entry.weekday < 1 || entry.weekday > 7) {
      return errors.validationFailed({ [`days.${index}.weekday`]: "Weekday must be 1 to 7." });
    }
    if (typeof entry.open !== "boolean") {
      return errors.validationFailed({ [`days.${index}.open`]: "Open must be true or false." });
    }
    if (entry.open) {
      const opens = parseTimeOnHalfHour(entry.opens);
      const closes = parseTimeOnHalfHour(entry.closes);
      if (opens === null) return errors.validationFailed({ [`days.${index}.opens`]: "Use a time on the hour or half hour." });
      if (closes === null) return errors.validationFailed({ [`days.${index}.closes`]: "Use a time on the hour or half hour." });
      if (closes <= opens) return errors.validationFailed({ [`days.${index}.closes`]: "Closing time must be after opening time." });
    }
  }
  const weekdays = record.days.map((day) => (day as { weekday: number }).weekday).sort((a, b) => a - b);
  if (weekdays.join(",") !== "1,2,3,4,5,6,7") {
    return errors.validationFailed({ days: "All seven weekdays are required." });
  }
  return null;
}

type ApiErrorShape = ReturnType<typeof errors.validationFailed>;

export async function publishPlan(client: PoolClient, storeId: string, effectiveFrom: string, days: DayEntry[]): Promise<void> {
  if (effectiveFrom === (await currentEffectiveToday(client, storeId))) {
    await client.query("DELETE FROM hours_plans WHERE store_id = $1 AND kind IN ('current','upcoming')", [storeId]);
    for (const day of days) {
      await client.query(
        "INSERT INTO hours_plans (store_id, kind, effective_from, weekday, open, opens, closes) VALUES ($1,'current',$2,$3,$4,$5,$6)",
        [storeId, effectiveFrom, day.weekday, day.open, day.open ? day.opens : null, day.open ? day.closes : null],
      );
    }
    return;
  }
  await client.query("DELETE FROM hours_plans WHERE store_id = $1 AND kind = 'upcoming'", [storeId]);
  for (const day of days) {
    await client.query(
      "INSERT INTO hours_plans (store_id, kind, effective_from, weekday, open, opens, closes) VALUES ($1,'upcoming',$2,$3,$4,$5,$6)",
      [storeId, effectiveFrom, day.weekday, day.open, day.open ? day.opens : null, day.open ? day.closes : null],
    );
  }
}

async function currentEffectiveToday(client: PoolClient, storeId: string): Promise<string> {
  const result = await client.query<{ effective_from: string }>(
    "SELECT to_char(effective_from,'YYYY-MM-DD') as effective_from FROM hours_plans WHERE store_id = $1 AND kind = 'current' LIMIT 1",
    [storeId],
  );
  return result.rows[0]?.effective_from ?? "1970-01-01";
}

export interface DayPlanAnswer {
  store_id: string;
  date: string;
  timezone: string;
  open: boolean;
  opens_local: string | null;
  closes_local: string | null;
  opens_utc: string | null;
  closes_utc: string | null;
  slots: { start_local: string; start_utc: string; utc_offset: string; remaining: number }[];
}

export async function dayPlanAnswer(client: PoolClient, store: StoreRecord, date: string): Promise<DayPlanAnswer> {
  const plans = await loadPlans(client, store.id);
  const entry = planForDate(plans.current, plans.upcoming, date);
  if (!entry) {
    return { store_id: store.id, date, timezone: store.timezone, open: false, opens_local: null, closes_local: null, opens_utc: null, closes_utc: null, slots: [] };
  }
  const frame = dayPlanFrame(store.timezone, date, entry);
  const slots = await Promise.all(
    localSlotsForDate(store.timezone, date, entry).map(async (slot) => ({
      start_local: `${String(Math.floor(slot.minute / 60)).padStart(2, "0")}:${String(slot.minute % 60).padStart(2, "0")}`,
      start_utc: slot.utc.toISOString(),
      utc_offset: utcOffsetString(store.timezone, slot.utc),
      remaining: await remainingForSlot(client, store.id, slot.utc),
    })),
  );
  return {
    store_id: store.id,
    date,
    timezone: store.timezone,
    open: frame.open,
    opens_local: frame.opens_local,
    closes_local: frame.closes_local,
    opens_utc: frame.opens_utc,
    closes_utc: frame.closes_utc,
    slots,
  };
}

async function remainingForSlot(client: PoolClient, storeId: string, utc: Date): Promise<number> {
  const result = await client.query<{ count: string }>(
    "SELECT count(*) as count FROM orders WHERE store_id = $1 AND slot_start_utc = $2 AND status <> 'cancelled'",
    [storeId, utc],
  );
  return Math.max(0, 2 - Number(result.rows[0].count));
}

export interface OfferedSlotsAnswer {
  store_id: string;
  timezone: string;
  days: { date: string; slots: { start_local: string; start_utc: string; utc_offset: string; remaining: number }[] }[];
}

export async function offeredSlots(client: PoolClient, store: StoreRecord): Promise<OfferedSlotsAnswer> {
  const days: { date: string; slots: { start_local: string; start_utc: string; utc_offset: string; remaining: number }[] }[] = [];
  if (store.suspended) return { store_id: store.id, timezone: store.timezone, days: [] };
  const now = Date.now();
  const plans = await loadPlans(client, store.id);
  const firstDate = localDateInZone(store.timezone, new Date(now + 7200 * 1000));
  const lastDate = localDateInZone(store.timezone, new Date(now + 604800 * 1000));
  let date = firstDate;
  while (date <= lastDate) {
    const entry = planForDate(plans.current, plans.upcoming, date);
    if (entry) {
      const slots: { start_local: string; start_utc: string; utc_offset: string; remaining: number }[] = [];
      for (const slot of localSlotsForDate(store.timezone, date, entry)) {
        if (slot.utc.getTime() < now + 7200 * 1000 || slot.utc.getTime() > now + 604800 * 1000) continue;
        const remaining = await remainingForSlot(client, store.id, slot.utc);
        if (remaining <= 0) continue;
        slots.push({
          start_local: `${String(Math.floor(slot.minute / 60)).padStart(2, "0")}:${String(slot.minute % 60).padStart(2, "0")}`,
          start_utc: slot.utc.toISOString(),
          utc_offset: utcOffsetString(store.timezone, slot.utc),
          remaining,
        });
      }
      if (slots.length > 0) days.push({ date, slots });
    }
    date = addDaysToLocalDate(date, 1);
  }
  return { store_id: store.id, timezone: store.timezone, days };
}
