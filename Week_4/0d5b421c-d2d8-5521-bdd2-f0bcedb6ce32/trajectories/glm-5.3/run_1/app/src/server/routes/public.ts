import express from "express";
import { now } from "../clock.js";
import {
  ROOMS, SLOT_TIMES, JOINABLE_PAIRS, turnMinutes, BOOKING_LEAD_MINUTES, BOOKING_HORIZON_DAYS,
  DEPOSIT_CENTS_PER_COVER, DEPOSIT_MIN_PARTY, DEPOSIT_ROOMS, REFUND_CUTOFF_HOURS,
  NO_SHOW_AFTER_MINUTES, HOST_SESSION_HOURS, RESET_MINUTES,
} from "../../shared/seed.js";
import {
  TABLES, PAIRS, fitsBySeatRange, maxSeatsForTarget, turnWindow,
} from "../floor.js";
import { loadWindowsForDate, overlaps, coversFreeByRoom, totalCoversFree, eligibleTargets } from "../occupancy.js";
import { todayInLisbon, lisbonSlotInstant, isSlotTime as isSlot } from "../config.js";
import type { AppCtx } from "../app.js";
import type {
  RulesResponse, FloorResponse, TonightResponse, AvailabilityResponse, PlanResponse, SlotInfo,
} from "../types.js";
import { validDateString, dateInHorizon, partyFromQuery, isoWithLisbonOffset, invalid, partyOrThrow } from "./validate.js";

export function registerPublicRoutes(app: express.Express, ctx: AppCtx): void {
  const { pool } = ctx;

  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/api/status", (_req, res) => {
    const t = now();
    res.json({
      server_now: t.toISOString(),
      holds: ctx.valkey.isHealthy() ? "ok" : "paused",
      deposits: ctx.killbill.isHealthy() ? "ok" : "paused",
    });
  });

  app.get("/api/rules", (_req, res) => {
    res.json({
      timezone: "Europe/Lisbon",
      slot_times: SLOT_TIMES,
      booking_lead_minutes: BOOKING_LEAD_MINUTES,
      booking_horizon_days: BOOKING_HORIZON_DAYS,
      hold_seconds: ctx.cfg.holdSeconds,
      offer_seconds: ctx.cfg.offerSeconds,
      turn_minutes: { "1-2": turnMinutes(2), "3-4": turnMinutes(4), "5-6": turnMinutes(6), "7-8": turnMinutes(8) },
      reset_minutes: RESET_MINUTES,
      deposit_cents_per_cover: DEPOSIT_CENTS_PER_COVER,
      deposit_min_party: DEPOSIT_MIN_PARTY,
      deposit_rooms: DEPOSIT_ROOMS,
      refund_cutoff_hours: REFUND_CUTOFF_HOURS,
      no_show_after_minutes: NO_SHOW_AFTER_MINUTES,
      host_session_hours: HOST_SESSION_HOURS,
    } satisfies RulesResponse);
  });

  app.get("/api/floor", (_req, res) => {
    res.json({
      rooms: ROOMS.map((r) => ({
        room_id: r.room_id,
        name: r.name,
        seats: r.seats,
        tables: r.tables.map((t) => ({ table_id: t.table_id, min_seats: t.min_seats, max_seats: t.max_seats })),
      })),
      joinable_pairs: JOINABLE_PAIRS.map((p) => ({
        pair_id: p.pair_id, tables: [...p.tables], min_seats: p.min_seats, max_seats: p.max_seats,
      })),
    } satisfies FloorResponse);
  });

  app.get("/api/tonight", async (_req, res) => {
    const t = now();
    const date = todayInLisbon(t);
    const windows = await loadWindowsForDate(pool, date, t);
    const nextSlot = earliestBookableSlot(date, t);
    const rooms = ROOMS.map((r) => {
      let covers: number | null = null;
      let nextTwo: string | null = null;
      if (nextSlot) {
        covers = coversFreeByRoom(windows, lisbonSlotInstant(date, nextSlot)).get(r.room_id) ?? 0;
        nextTwo = nextTableForTwo(windows, date, r.room_id, t);
      }
      return {
        room_id: r.room_id, name: r.name, seats: r.seats,
        covers_free_at_next_slot: covers, next_table_for_two: nextTwo,
      };
    });
    res.json({ date, server_now: t.toISOString(), next_slot: nextSlot, rooms } satisfies TonightResponse);
  });

  app.get("/api/availability", async (req, res) => {
    const dateRaw = String(req.query.date ?? "");
    const fields: Record<string, string> = {};
    if (!validDateString(dateRaw) || !dateInHorizon(dateRaw)) fields.date = "Choose a date from today to 30 days ahead.";
    const party = partyFromQuery(req);
    if (party === null) fields.party = "Choose 1 to 8 guests.";
    if (Object.keys(fields).length > 0) invalid(fields);
    const partySize = partyOrThrow(party);
    const date = dateRaw;
    const t = now();
    const windows = await loadWindowsForDate(pool, date, t);
    const slots: SlotInfo[] = SLOT_TIMES.map((time) => {
      const start = lisbonSlotInstant(date, time);
      const startMs = start.getTime();
      const nowMs = t.getTime();
      let bookable = true;
      let reason: SlotInfo["reason"] = null;
      if (startMs <= nowMs) { bookable = false; reason = "past"; }
      else if (startMs < nowMs + BOOKING_LEAD_MINUTES * 60_000) { bookable = false; reason = "too_late"; }
      const coversMap = coversFreeByRoom(windows, start);
      const { fitsFree, smallestMaxSeats } = eligibleTargets(windows, date, time, partySize);
      const eligible = smallestMaxSeats === null
        ? 0
        : fitsFree.filter((id) => maxSeatsForTarget(id) === smallestMaxSeats).length;
      return {
        time, starts_at: isoWithLisbonOffset(start), bookable, reason,
        covers_free: totalCoversFree(coversMap),
        rooms: ROOMS.map((r) => ({ room_id: r.room_id, covers_free: coversMap.get(r.room_id) ?? 0 })),
        eligible_tables: eligible,
      };
    });
    res.json({ date, party_size: partySize, server_now: t.toISOString(), slots } satisfies AvailabilityResponse);
  });

  app.get("/api/plan", async (req, res) => {
    const dateRaw = String(req.query.date ?? "");
    const timeRaw = String(req.query.time ?? "");
    const fields: Record<string, string> = {};
    if (!validDateString(dateRaw) || !dateInHorizon(dateRaw)) fields.date = "Choose a date from today to 30 days ahead.";
    if (!isSlot(timeRaw)) fields.time = "Choose a time from the list.";
    const party = partyFromQuery(req);
    if (party === null) fields.party = "Choose 1 to 8 guests.";
    if (Object.keys(fields).length > 0) invalid(fields);
    const partySize = partyOrThrow(party);
    const date = dateRaw;
    const time = timeRaw;
    const t = now();
    const windows = await loadWindowsForDate(pool, date, t);
    const { fitsFree, smallestMaxSeats } = eligibleTargets(windows, date, time, partySize);
    const eligible = smallestMaxSeats === null
      ? new Set<string>()
      : new Set(fitsFree.filter((id) => maxSeatsForTarget(id) === smallestMaxSeats));
    const start = lisbonSlotInstant(date, time);
    const { end } = turnWindow(start, partySize);
    const tables = TABLES.map((tb) => {
      if (overlaps(windows, [tb.table_id], start, end)) return { ...tb, status: "taken" as const };
      if (!fitsBySeatRange(tb.table_id, partySize)) return { ...tb, status: "not_for_party" as const };
      if (eligible.has(tb.table_id)) return { ...tb, status: "fits" as const };
      return { ...tb, status: "not_for_party" as const };
    });
    const pairs: PlanResponse["pairs"] = [];
    if (partySize >= 7) {
      for (const p of PAIRS) {
        const taken = overlaps(windows, [p.tables[0], p.tables[1]], start, end);
        pairs.push({ pair_id: p.pair_id, status: taken ? "taken" : "fits" });
      }
    }
    res.json({ date, time, party_size: partySize, tables, pairs } satisfies PlanResponse);
  });
}

/** Tonight's next bookable slot: the earliest slot at least 60 minutes ahead. */
function earliestBookableSlot(date: string, t: Date): string | null {
  const nowMs = t.getTime();
  for (const time of SLOT_TIMES) {
    const start = lisbonSlotInstant(date, time).getTime();
    if (start >= nowMs + BOOKING_LEAD_MINUTES * 60_000) return time;
  }
  return null;
}

/** A room's next table for two tonight: earliest bookable slot with a two-seat-range table free. */
function nextTableForTwo(
  windows: Awaited<ReturnType<typeof loadWindowsForDate>>, date: string, roomId: string, t: Date,
): string | null {
  const nowMs = t.getTime();
  const room = ROOMS.find((r) => r.room_id === roomId);
  if (!room) return null;
  for (const time of SLOT_TIMES) {
    const start = lisbonSlotInstant(date, time);
    if (start.getTime() < nowMs + BOOKING_LEAD_MINUTES * 60_000) continue;
    const { end } = turnWindow(start, 2);
    const ok = room.tables.some((tb) =>
      tb.min_seats <= 2 && 2 <= tb.max_seats && !overlaps(windows, [tb.table_id], start, end));
    if (ok) return time;
  }
  return null;
}
