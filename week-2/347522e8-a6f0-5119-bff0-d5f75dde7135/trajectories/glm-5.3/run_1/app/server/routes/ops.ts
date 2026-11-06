import { ApiError } from "../errors.js";
import { json, parseJsonBody, route, requireOperator, requireStaff, requireUser, renterScoped, type RouteContext } from "../router.js";
import { one, rows, withTx } from "../db.js";
import { isoInstant, kitchenToday, isValidDate, minutesToHHMM } from "../kitchenTime.js";
import { balances, ledgerForAccount, availableAccount, recordMovement } from "../ledger.js";
import { checkReachable } from "../killbill.js";

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

route("GET", "/api/usage-sheet", "staff", async (ctx: RouteContext) => {
  requireStaff(ctx);
  const dateParam = ctx.url.searchParams.get("date");
  const date = dateParam ?? kitchenToday(ctx.now);
  if (dateParam && !isValidDate(dateParam)) {
    throw ApiError.validationError({ date: "Enter the date as YYYY-MM-DD." });
  }
  const found = await rows<Record<string, unknown>>(
    ctx.db,
    `select b.id as booking_id, s.name as station_name, r.business_name as renter_business_name,
            b.start_min, b.end_min, b.actual_start, b.actual_end, b.status, b.overage_units, b.overage_usd
     from bookings b join stations s on s.id = b.station_id join renters r on r.id = b.renter_id
     where b.date = $1 and b.status in ('confirmed','checked_in','completed')
     order by b.start_min asc, s.name asc`,
    [date],
  );
  const sheetRows = found.map((row) => ({
    booking_id: row.booking_id,
    station_name: row.station_name,
    renter_business_name: row.renter_business_name,
    start: minutesToHHMM(row.start_min as number),
    end: minutesToHHMM(row.end_min as number),
    actual_start: (row.actual_start as string) ?? null,
    actual_end: (row.actual_end as string) ?? null,
    status: row.status,
    overage_units: (row.overage_units as number) ?? 0,
    overage_usd: row.overage_usd ? String(row.overage_usd) : "0.00",
  }));
  return json({ date, time_zone: "America/Chicago", server_now: isoInstant(ctx.now), rows: sheetRows });
});

route("GET", "/api/packs", "any", async (ctx: RouteContext) => {
  requireUser(ctx);
  const packs = await rows<{ id: string; name: string; hours: number; amount_usd: string }>(
    ctx.db,
    "select id, name, hours, amount_usd::text as amount_usd from packs order by hours asc",
  );
  const reachable = await checkReachable(2000);
  return json({ packs, purchases_available: reachable.kind === "ok" });
});

route("GET", "/api/renters/{renter_id}/ledger", "any", async (ctx: RouteContext) => {
  const user = requireUser(ctx);
  const renterId = ctx.url.pathname.split("/")[3]!;
  if (user.role === "renter") renterScoped(ctx, renterId);
  else if (user.role !== "operator" && user.role !== "shift_lead") throw ApiError.forbidden();
  const balance = await balances(ctx.db, renterId);
  const entries = await ledgerForAccount(ctx.db, renterId, availableAccount(renterId));
  return json({
    balance_minutes: balance.balanceMinutes,
    held_minutes: balance.heldMinutes,
    entries,
  });
});

route("POST", "/api/renters/{renter_id}/adjustments", "operator", async (ctx: RouteContext) => {
  requireOperator(ctx);
  const renterId = ctx.url.pathname.split("/")[3]!;
  const renter = await one<{ id: string }>(ctx.db, "select id from renters where id = $1", [renterId]);
  if (!renter) throw ApiError.notFound();
  const body = parseJsonBody<{ minutes?: unknown; reason?: unknown }>(ctx);
  const minutes = Number(body.minutes);
  const reason = text(body.reason);

  const errors: Record<string, string> = {};
  if (!Number.isInteger(minutes) || minutes === 0 || Math.abs(minutes) % 15 !== 0 || Math.abs(minutes) > 24000) {
    errors.minutes = "Minutes are a non-zero multiple of 15, up to 24000.";
  }
  if (reason.length < 1 || reason.length > 200) errors.reason = "Enter the reason, 1 to 200 characters.";
  if (Object.keys(errors).length > 0) throw ApiError.validationError(errors);
  const balance = await balances(ctx.db, renterId);
  if (minutes < 0 && Math.abs(minutes) > balance.balanceMinutes) {
    throw ApiError.insufficientHours(balance.balanceMinutes, Math.abs(minutes));
  }
  const movementId = await withTx(async (tx) =>
    recordMovement(tx, renterId, "adjustment", minutes, { note: reason }),
  );
  const after = await balances(ctx.db, renterId);
  return json({ movement_id: movementId, balance_minutes: after.balanceMinutes }, 201);
});

