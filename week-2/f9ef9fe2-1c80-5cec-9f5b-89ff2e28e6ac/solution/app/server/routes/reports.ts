import { pool } from "../db.js";
import { type BookingRow, type InvoiceRow, type Kitchen, TIER_COUNTING_STATES } from "../domain.js";
import { refuse } from "../errors.js";
import { json, route } from "../http.js";
import { kitchenDate, toInstant } from "../kitchenTime.js";
import { decimal, hoursText } from "../money.js";
import { BOOKING_COLUMNS, INVOICE_COLUMNS, kitchenMembers, loadStations, packBalance, userKitchen } from "../store.js";
import { allow, authed } from "../validate.js";

// The one-kitchen monthly usage report and its CSV (brief: Reports). Months are kitchen-local.

/** Hours a member is charged for: bookings that count toward the tiers. */
const charged = (b: BookingRow): boolean => TIER_COUNTING_STATES.includes(b.state);

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const year = (y ?? 0) + ((m ?? 1) === 12 ? 1 : 0);
  return `${year}-${String(((m ?? 1) % 12) + 1).padStart(2, "0")}`;
}

async function monthData(kitchen: Kitchen, month: string) {
  const bookings = await pool.query<BookingRow>(
    `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE kitchen_id = $1 AND to_char(date, 'YYYY-MM') = $2`,
    [kitchen.id, month],
  );
  const invoices = await pool.query<InvoiceRow>(
    `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE kitchen_id = $1 AND issued_at >= $2 AND issued_at < $3 ORDER BY issued_at, ref`,
    [kitchen.id, toInstant(kitchen.timezone, `${month}-01`, "00:00"), toInstant(kitchen.timezone, `${nextMonth(month)}-01`, "00:00")],
  );
  return { bookings: bookings.rows, invoices: invoices.rows };
}

function readMonth(value: string | null): string {
  if (value === null || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw refuse.validation({ month: "Choose a month as YYYY-MM." });
  return value;
}

async function reportKitchen(kitchenId: string | undefined, user: Parameters<typeof userKitchen>[0]): Promise<Kitchen> {
  const kitchen = await userKitchen(user, kitchenId);
  allow(user, "operator", "bookkeeper");
  return kitchen;
}

route(
  "GET",
  "/api/kitchens/:kitchen_id/reports/usage",
  authed(async (request, user) => {
    const kitchen = await reportKitchen(request.params.kitchen_id, user);
    const month = readMonth(request.query.get("month"));
    const { bookings, invoices } = await monthData(kitchen, month);
    const members = await kitchenMembers(kitchen.id);
    const stations = await loadStations(kitchen.id);
    const business = new Map(members.map((m) => [m.id, m.business]));
    const sum = (rows: BookingRow[], pick: (b: BookingRow) => number): number => rows.reduce((total, b) => total + pick(b), 0);
    const chargedBookings = bookings.filter(charged);
    const memberRows = await Promise.all(
      members.map(async (m) => {
        const own = bookings.filter((b) => b.member_id === m.id);
        return {
          member_id: m.id,
          business: m.business,
          booked_hours: hoursText(sum(own.filter(charged), (b) => b.quarters)),
          cancelled_in_window_hours: hoursText(sum(own.filter((b) => b.state === "cancelled_in_window"), (b) => b.quarters)),
          billed_cents: invoices.filter((i) => i.member_id === m.id).reduce((total, i) => total + i.total_cents, 0),
          refunded_cents: sum(own, (b) => b.refund_cents),
          pack_balance_hours: hoursText(await packBalance(m.id)),
        };
      }),
    );
    return json(200, {
      kitchen: { id: kitchen.id, name: kitchen.name, timezone: kitchen.timezone },
      month,
      members: memberRows,
      stations: stations.map((s) => ({
        station_id: s.id,
        name: s.name,
        booked_hours: hoursText(chargedBookings.reduce((total, b) => total + b.cells.filter((c) => c.station_id === s.id).length, 0)),
      })),
      invoices: invoices.map((i) => ({
        invoice_id: i.id,
        ref: i.ref,
        kind: i.kind,
        member_id: i.member_id,
        business: business.get(i.member_id) ?? "",
        killbill_invoice_id: i.killbill_invoice_id,
        total_cents: i.total_cents,
        issued_on: kitchenDate(kitchen.timezone, i.issued_at),
      })),
      totals: {
        booked_hours: hoursText(sum(chargedBookings, (b) => b.quarters)),
        billed_cents: invoices.reduce((total, i) => total + i.total_cents, 0),
        refunded_cents: sum(bookings, (b) => b.refund_cents),
      },
    });
  }),
);

// Adapted from kit/modules/csv_safe: formula neutralisation, then RFC 4180 quoting.
function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csvRow = (values: (string | number)[]): string => `${values.map(csvCell).join(",")}\r\n`;

route(
  "GET",
  "/api/kitchens/:kitchen_id/reports/usage.csv",
  authed(async (request, user) => {
    const kitchen = await reportKitchen(request.params.kitchen_id, user);
    const month = readMonth(request.query.get("month"));
    const { invoices } = await monthData(kitchen, month);
    const business = new Map((await kitchenMembers(kitchen.id)).map((m) => [m.id, m.business]));
    const ids = invoices.flatMap((i) => i.booking_ids);
    const bookings = new Map(
      (await pool.query<BookingRow>(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ANY($1)`, [ids])).rows.map((b) => [b.id, b]),
    );
    let csv = csvRow(["invoice_ref", "kind", "member", "booking_ref", "date", "station", "tier", "paid_by", "hours", "amount"]);
    for (const invoice of invoices) {
      const member = business.get(invoice.member_id) ?? "";
      if (invoice.kind === "pack") {
        for (const line of invoice.lines) {
          csv += csvRow([invoice.ref, invoice.kind, member, "", kitchenDate(kitchen.timezone, invoice.issued_at), "", "", "cash", "20.00",
            decimal(line.amount_cents)]);
        }
        continue;
      }
      for (const id of invoice.booking_ids) {
        const booking = bookings.get(id);
        if (!booking) continue;
        for (const line of booking.lines) {
          csv += csvRow([invoice.ref, invoice.kind, member, booking.ref, booking.date, line.station, line.tier, line.paid_by, line.hours,
            decimal(line.amount_cents)]);
        }
      }
    }
    return {
      status: 200,
      bytes: Buffer.from(csv, "utf8"),
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pilotlight-usage-${kitchen.id}-${month}.csv"`,
        "Cache-Control": "no-store",
      },
    };
  }),
);

