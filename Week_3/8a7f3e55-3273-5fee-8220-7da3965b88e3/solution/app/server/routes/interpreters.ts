import type { InterpreterChoice } from "../../shared/api.js";
import { rows } from "../db.js";
import { apiErrors } from "../errors.js";
import { canView, loadBooking } from "../bookings.js";
import { ok, route } from "../http.js";
import { FIELD_MESSAGES } from "../messages.js";
import { isQualified } from "../rules/qualification.js";
import { TEXT_LIMITS, textLength } from "../../shared/text.js";
import { allInterpreters, busyInterpreterIds, choiceCard } from "../seatOps.js";
import { parseId, requireRole } from "./bookings.js";

export function registerInterpreterRoutes(): void {
  route("GET", "/api/interpreters", async (ctx) => {
    const bookingText = ctx.query.get("booking_id");
    const named = bookingText !== null && bookingText !== "";
    const booking = named ? await loadBooking(ctx.db, parseId(bookingText)) : null;
    if (named && (booking === null || !canView(booking, ctx.user))) throw apiErrors.notFound();
    requireRole(ctx, "coordinator");
    const search = ctx.query.get("q") ?? "";
    if (textLength(search) > TEXT_LIMITS.search) throw apiErrors.validation({ q: FIELD_MESSAGES.q });
    const needle = search.trim().toLowerCase();

    const credentialRows = await rows<{ interpreter_id: string; code: string; expires_on: string }>(
      ctx.db,
      "SELECT interpreter_id, code, expires_on FROM credentials ORDER BY id",
    );
    const busy = booking === null ? new Set<string>() : await busyInterpreterIds(ctx.db, booking);
    const interpreters = (await allInterpreters(ctx.db))
      .filter((interpreter) => interpreter.name.toLowerCase().includes(needle))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const choices: InterpreterChoice[] = interpreters.map((interpreter) => {
      const credentials = credentialRows.filter((credential) => credential.interpreter_id === interpreter.user_id);
      return {
        ...choiceCard(interpreter, credentials),
        qualified: booking === null ? null : isQualified(credentials, booking.row.setting, booking.row.start_date),
        busy: booking === null ? null : busy.has(interpreter.user_id),
      };
    });
    return ok({ interpreters: choices });
  });
}
