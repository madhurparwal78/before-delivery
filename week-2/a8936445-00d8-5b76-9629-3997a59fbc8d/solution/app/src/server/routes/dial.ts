// GET /api/dial: every station's blocks for one kitchen day in wall-clock minutes.
import type { Block, DialDay, Station } from "../../shared/api";
import { BOOK_AHEAD_DAYS, DIAL_PAST_DAYS, TIME_ZONE } from "../../shared/kitchen";
import { addDays, clockChanges, isKitchenDate, kitchenIso, kitchenParts } from "../../shared/time";
import { pool, rows } from "../db";
import { validation } from "../errors";
import { route } from "../http";
import { occupying } from "../occupancy";
import { ownedBy } from "../records";
import { cleaningBlocks } from "../rules";

export const dialRoutes = [
  route({
    method: "GET",
    path: "/api/dial",
    roles: ["operator", "owner", "cook"],
    async handle(ctx) {
      const now = kitchenParts(ctx.nowMs);
      const date = ctx.query.get("date") ?? now.date;
      if (!isKitchenDate(date) || date < addDays(now.date, -DIAL_PAST_DAYS) || date > addDays(now.date, BOOK_AHEAD_DAYS)) {
        throw validation({ date: `Choose a date from ${addDays(now.date, -DIAL_PAST_DAYS)} to ${addDays(now.date, BOOK_AHEAD_DAYS)}.` });
      }
      const stations = await rows<Station>(pool, "SELECT id, name, kind, hourly_rate_cents FROM stations ORDER BY position");
      const day = await occupying(pool, [date], ctx.nowMs);
      const user = ctx.user;
      const body: DialDay = {
        date,
        today: now.date,
        now_minute: date === now.date ? now.minute : null,
        time_zone: TIME_ZONE,
        ...clockChanges(date),
        stations: stations.map((station) => {
          const taken = day.filter((b) => b.station_id === station.id);
          const blocks: Block[] = taken.map((b) => {
            if (!ownedBy(user, b.tenant_id)) return { kind: "booked", start_minute: b.start_minute, end_minute: b.end_minute };
            return {
              kind: b.status === "held" ? "hold" : "booking",
              booking_id: b.id,
              ref: b.ref,
              hold_ref: b.hold_ref,
              status: b.status,
              start_minute: b.start_minute,
              end_minute: b.end_minute,
              tenant_id: b.tenant_id,
              tenant_name: b.tenant_name,
              notes: b.notes,
              ...(user.role === "operator" ? { contact_email: b.owner_email } : {}),
              expires_at: b.status === "held" ? kitchenIso(b.hold_expires_at.getTime()) : null,
            };
          });
          const cleaning = cleaningBlocks(taken.map((b) => ({ tenantId: b.tenant_id, start: b.start_minute, end: b.end_minute })));
          blocks.push(...cleaning.map((c): Block => ({ kind: "cleaning", start_minute: c.start, end_minute: c.end })));
          blocks.sort((a, b) => a.start_minute - b.start_minute);
          return { ...station, blocks };
        }),
      };
      return { status: 200, json: body };
    },
  }),
];
