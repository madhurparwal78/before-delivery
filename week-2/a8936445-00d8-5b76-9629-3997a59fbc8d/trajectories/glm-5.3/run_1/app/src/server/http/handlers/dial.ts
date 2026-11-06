/** GET /api/dial: every station's blocks for one kitchen day in wall-clock minutes. */

import { isValidKitchenDate } from "../../../shared/kitchen-time.js";
import type { DialBlock, DialDay, DialStation } from "../../../shared/api-types.js";
import {
  cleaningBlocks,
  dialBlockFor,
  loadDayBookings,
  loadStations,
  toMinuteBlocks
} from "../../domain/bookings.js";
import { resolveTenantStatuses } from "../../domain/tenants.js";
import { validation } from "../errors.js";
import type { App } from "../server.js";
import { json, requireUser } from "./helpers.js";

export function registerDialRoutes(app: App): void {
  app.route("GET", "/api/dial", "signed_in", async ({ ctx, db }) => {
    const user = await requireUser({ ctx, db } as never);
    await resolveTenantStatuses(db);

    const clock = db.clock;
    const today = clock.today();
    const dateParam = ctx.url.searchParams.get("date") ?? today;
    if (!isValidKitchenDate(dateParam)) {
      throw validation({ date: "Give the kitchen date to show." });
    }
    const days = clock.daysBetween(today, dateParam);
    if (days < -30 || days > 365) {
      throw validation({ date: "The day must be within 30 days behind and 365 days ahead of today." });
    }

    const change = clock.clockChange(dateParam);
    const stations = await loadStations(db);
    const out: DialStation[] = [];
    for (const station of stations) {
      const rows = await loadDayBookings(db, station.id, dateParam);
      const blocks: DialBlock[] = [];
      const minuteBlocks = toMinuteBlocks(rows, clock);
      for (const row of rows) {
        const role: "operator" | "tenant" | "own" =
          user.role === "operator" ? "operator" : row.tenant_id === user.tenant_id ? "own" : "tenant";
        blocks.push(dialBlockFor(row, role, clock));
      }
      for (const cleaning of cleaningBlocks(minuteBlocks)) {
        blocks.push({ kind: "cleaning", start_minute: cleaning.start, end_minute: cleaning.end });
      }
      blocks.sort((a, b) => a.start_minute - b.start_minute);
      out.push({
        id: station.id,
        name: station.name,
        kind: station.kind,
        hourly_rate_cents: station.hourly_rate_cents,
        blocks
      });
    }

    const response: DialDay = {
      date: dateParam,
      today,
      now_minute: dateParam === today ? clock.minuteOfDayNow() : null,
      time_zone: clock.zone,
      skipped: change.skipped ? [change.skipped.start, change.skipped.end] : null,
      repeated: change.repeated ? [change.repeated.start, change.repeated.end] : null,
      stations: out
    };
    return json(200, response);
  });
}
