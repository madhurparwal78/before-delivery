// Board registration and warranty (brief: Board registration and warranty): Luhn-checked serials, one winner per
// serial or per line's last board, warranty terms from the delivery date in the order country's zone.
import { loadCatalog } from "../catalog.ts";
import { transaction, type Db } from "../db.ts";
import { ApiError, assertValid, invalid, type Fields } from "../errors.ts";
import { iso, now } from "../clock.ts";
import type { User } from "../http.ts";
import { isRowId, normaliseEmail } from "../patterns.ts";
import { wallClock } from "../zones.ts";

/** Warranty terms in calendar months by order country, and the zone each country's dates are read in. */
const WARRANTY: Record<string, { zone: string; board_months: number }> = {
  US: { zone: "America/New_York", board_months: 12 },
  PR: { zone: "America/Puerto_Rico", board_months: 12 },
  CA: { zone: "America/Toronto", board_months: 12 },
  DE: { zone: "Europe/Berlin", board_months: 24 },
  FR: { zone: "Europe/Paris", board_months: 24 },
  AU: { zone: "Australia/Sydney", board_months: 12 },
};
const BATTERY_MONTHS = 18;
const SERIAL = /^TF(\d{8})(\d)$/;
const UNIQUE_VIOLATION = "23505";

interface Registration {
  serial: string;
  order_number: string;
  board_name: string;
  country: string;
  registered_at: string;
  board_warranty_ends_on: string;
  battery_warranty_ends_on: string;
  board_days_left: number;
  battery_days_left: number;
}

interface RegistrationRow {
  serial: string;
  order_number: string;
  board_name: string;
  country: string;
  registered_at: Date;
  board_ends_on: string;
  battery_ends_on: string;
}

/** The Luhn check digit of a digit string. */
function luhnDigit(payload: string): number {
  let sum = 0;
  [...payload].reverse().forEach((char, i) => {
    const doubled = Number(char) * (i % 2 === 0 ? 2 : 1);
    sum += doubled > 9 ? doubled - 9 : doubled;
  });
  return (10 - (sum % 10)) % 10;
}

function isSerial(value: unknown): value is string {
  const m = typeof value === "string" ? SERIAL.exec(value) : null;
  return m !== null && luhnDigit(m[1]!) === Number(m[2]);
}

function localDate(instant: Date, zone: string): string {
  const w = wallClock(instant, zone);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** The date `months` calendar months later; a day missing in the end month moves to that month's last day. */
function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const index = year * 12 + (month - 1) + months;
  const endYear = Math.floor(index / 12);
  const endMonth = index % 12;
  const lastDay = new Date(Date.UTC(endYear, endMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(endYear, endMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function present(row: RegistrationRow): Registration {
  const today = localDate(now(), WARRANTY[row.country]!.zone);
  return {
    serial: row.serial,
    order_number: row.order_number,
    board_name: row.board_name,
    country: row.country,
    registered_at: iso(row.registered_at),
    board_warranty_ends_on: row.board_ends_on,
    battery_warranty_ends_on: row.battery_ends_on,
    board_days_left: Math.max(0, daysBetween(today, row.board_ends_on)),
    battery_days_left: Math.max(0, daysBetween(today, row.battery_ends_on)),
  };
}

const SELECT = "SELECT serial, order_number, board_name, country, registered_at, board_ends_on, battery_ends_on FROM registrations";

/** POST /api/registrations: validation, then the refusals in their published order. */
export async function register(user: User, body: Record<string, unknown>): Promise<Registration> {
  const fields: Fields = {};
  if (!isSerial(body.serial)) fields.serial = "Enter the serial from the deck plate, like TF123456782.";
  if (typeof body.line_id !== "number" || !Number.isInteger(body.line_id)) fields.line_id = "Choose a board.";
  assertValid(fields);
  const serial = body.serial as string;
  const lineId = body.line_id as number;
  try {
    return await transaction(async (tx) => {
      const { rows } = await tx.query<{ type: string; sku: string; quantity: number; status: string; country: string }>(
        `SELECT l.type, l.sku, l.quantity, o.status, o.country FROM order_lines l JOIN orders o ON o.number = l.order_number
         WHERE o.number = $1 AND o.user_id = $2 AND l.id = $3 FOR UPDATE OF l`,
        [typeof body.order_number === "string" ? body.order_number : "", user.id, isRowId(lineId) ? lineId : 0],
      );
      const line = rows[0];
      if (!line) throw new ApiError("not_found");
      if (line.type !== "build") throw new ApiError("not_eligible", { message: "Only boards can be registered." });
      if (line.status !== "delivered") throw new ApiError("not_delivered");
      const taken = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM registrations WHERE line_id = $1", [lineId]);
      if ((taken.rows[0]?.n ?? 0) >= line.quantity) throw new ApiError("nothing_to_register");
      if ((await tx.query("SELECT 1 FROM registrations WHERE serial = $1", [serial])).rowCount) throw new ApiError("already_registered");
      const delivered = await tx.query<{ at: Date }>(
        "SELECT at FROM order_events WHERE order_number = $1 AND status = 'delivered' ORDER BY id DESC LIMIT 1",
        [body.order_number],
      );
      const terms = WARRANTY[line.country]!;
      const start = localDate(delivered.rows[0]!.at, terms.zone);
      const board = (await loadCatalog(tx)).board(line.sku)!;
      const inserted = await tx.query<RegistrationRow>(
        `INSERT INTO registrations (serial, user_id, order_number, line_id, board_name, country, registered_at, board_ends_on, battery_ends_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING serial, order_number, board_name, country, registered_at, board_ends_on, battery_ends_on`,
        [serial, user.id, body.order_number, lineId, board.name, line.country, now(), addMonths(start, terms.board_months), addMonths(start, BATTERY_MONTHS)],
      );
      return present(inserted.rows[0]!);
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === UNIQUE_VIOLATION) throw new ApiError("already_registered");
    throw error;
  }
}

export async function myRegistrations(db: Db, user: User): Promise<Registration[]> {
  const { rows } = await db.query<RegistrationRow>(`${SELECT} WHERE user_id = $1 ORDER BY registered_at, serial`, [user.id]);
  return rows.map(present);
}

/** Moves a registration to another customer; its end dates and country stay. */
export async function transfer(user: User, serial: string, body: Record<string, unknown>): Promise<Registration> {
  return transaction(async (tx) => {
    const owned = await tx.query("SELECT 1 FROM registrations WHERE serial = $1 AND user_id = $2 FOR UPDATE", [serial, user.id]);
    if (!owned.rowCount) throw new ApiError("not_found");
    const email = normaliseEmail(body.email);
    const target = email
      ? (await tx.query<{ id: number }>("SELECT id FROM users WHERE email = $1 AND role = 'customer' AND id <> $2", [email, user.id])).rows[0]
      : undefined;
    if (!target) throw invalid({ email: "Enter the email of another Tern Foils customer." });
    const { rows } = await tx.query<RegistrationRow>(
      `UPDATE registrations SET user_id = $2 WHERE serial = $1
       RETURNING serial, order_number, board_name, country, registered_at, board_ends_on, battery_ends_on`,
      [serial, target.id],
    );
    return present(rows[0]!);
  });
}
