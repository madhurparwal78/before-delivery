import type pg from "pg";
import { errors } from "./errors.js";
import { foldEmail, foldTelephone, isoInstant, makeReference } from "./domain.js";
import { cryptoRandom } from "./auth.js";
import type { Pennies } from "./money.js";
import { penniesToString } from "./money.js";
import { isoDate } from "./dates.js";

export { isoDate };

export type DB = pg.Pool;
export type Tx = pg.PoolClient;

export function money(v: Pennies | null): string | null {
  return v === null ? null : penniesToString(v);
}

export async function tx<T>(pool: DB, fn: (client: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export interface DeskRow {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
}

export async function deskByEmail(db: DB, email: string): Promise<DeskRow | null> {
  const r = await db.query<Record<string, unknown>>(
    "SELECT id, name, email, password_hash FROM desks WHERE email_folded = $1",
    [foldEmail(email)]
  );
  const row = r.rows[0];
  return row ? { id: String(row.id), name: String(row.name), email: String(row.email), passwordHash: String(row.password_hash) } : null;
}

export async function deskById(db: DB, id: string): Promise<DeskRow | null> {
  const r = await db.query<Record<string, unknown>>("SELECT id, name, email, password_hash FROM desks WHERE id = $1", [id]);
  const row = r.rows[0];
  return row ? { id: String(row.id), name: String(row.name), email: String(row.email), passwordHash: String(row.password_hash) } : null;
}

export async function createDesk(db: DB, name: string, email: string, passwordHash: string): Promise<DeskRow> {
  const id = "DK-" + randomId(8);
  await db.query("INSERT INTO desks (id, name, email, email_folded, password_hash, public) VALUES ($1,$2,$3,$4,$5,FALSE)", [
    id,
    name,
    email,
    foldEmail(email),
    passwordHash,
  ]);
  await db.query(
    `INSERT INTO rate_tables (id, desk_id, effective_from, default_margin_percent, waiting_rate_pennies, second_driver_pennies, deposit_minibus, deposit_minibus_higher, deposit_coach, deposit_coach_higher)
     VALUES ($1,$2,'2000-01-01','15',2000,15000,5000,10000,10000,15000)`,
    ["RT-" + randomId(8), id]
  );
  return { id, name, email, passwordHash };
}

export function randomId(len: number): string {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(cryptoRandom() * alphabet.length)];
  return s;
}

export function newToken(prefix: string): string {
  return prefix + randomBytesToken(24);
}

function randomBytesToken(n: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += chars[Math.floor(cryptoRandom() * chars.length)];
  return s;
}

export async function newReference(db: DB, deskId: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const ref = makeReference(cryptoRandom);
    const exists = await db.query("SELECT 1 FROM enquiries WHERE desk_id=$1 AND reference=$2", [deskId, ref]);
    if (exists.rowCount === 0) return ref;
  }
  throw errors.state("internal", "We can't find that.");
}

export interface EnquiryRow {
  id: string;
  deskId: string;
  reference: string;
  customerId: string | null;
  occasion: string;
  state: string;
  journeyType: string;
  departDate: string;
  departTime: string;
  departInstant: Date;
  returnDate: string | null;
  returnTime: string | null;
  returnInstant: Date | null;
  details: string | null;
  people: number;
  large: number;
  medium: number;
  hand: number;
  wheelchairs: number;
  name: string | null;
  email: string | null;
  telephone: string | null;
  language: string;
  submittedBody: string | null;
  createdAt: Date;
  mergedReferences: string[];
  duplicates: { id: string; reference: string }[];
}

export function enquiryRow(r: Record<string, unknown>): EnquiryRow {
  const dupRaw = (r.duplicated as string | null) ?? "";
  return {
    id: String(r.id),
    deskId: String(r.desk_id),
    reference: String(r.reference),
    customerId: (r.customer_id as string | null) ?? null,
    occasion: String(r.occasion),
    state: String(r.state),
    journeyType: String(r.journey_type),
    departDate: isoDate(r.depart_date as Date),
    departTime: String(r.depart_time),
    departInstant: r.depart_instant as Date,
    returnDate: r.return_date ? isoDate(r.return_date as Date) : null,
    returnTime: (r.return_time as string | null) ?? null,
    returnInstant: (r.return_instant as Date | null) ?? null,
    details: (r.details as string | null) ?? null,
    people: Number(r.people),
    large: Number(r.large),
    medium: Number(r.medium),
    hand: Number(r.hand),
    wheelchairs: Number(r.wheelchairs),
    name: (r.name as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    telephone: (r.telephone as string | null) ?? null,
    language: String(r.language),
    submittedBody: (r.submitted_body as string | null) ?? null,
    createdAt: r.created_at as Date,
    mergedReferences: (r.merged_references as string[] | null) ?? [],
    duplicates: dupRaw ? [{ id: dupRaw, reference: dupRaw }] : [],
  };
}


export async function enquiryById(db: DB, deskId: string, id: string): Promise<EnquiryRow | null> {
  const r = await db.query(
    `SELECT e.*, c.name AS customer_name FROM enquiries e LEFT JOIN customers c ON c.id=e.customer_id AND c.desk_id=e.desk_id
     WHERE e.desk_id=$1 AND (e.id=$2 OR e.reference=$2) ORDER BY e.created_at ASC LIMIT 1`,
    [deskId, id]
  );
  const row = r.rows[0];
  if (!row) return null;
  const dup = await duplicatesFor(db, deskId, row.id, row.email, row.telephone);
  const e = enquiryRow(row);
  e.duplicates = dup;
  return e;
}

export async function duplicatesFor(
  db: DB,
  deskId: string,
  selfId: string,
  email: string | null,
  telephone: string | null
): Promise<{ id: string; reference: string }[]> {
  if (!email && !telephone) return [];
  const r = await db.query(
    `SELECT id, reference FROM enquiries WHERE desk_id=$1 AND id<>$2 AND (${email ? "email=$3 OR " : ""}${telephone ? "telephone=$4" : "FALSE"})
     ORDER BY created_at DESC`,
    [deskId, selfId, email ?? "", telephone ?? ""]
  );
  return r.rows.map((x) => ({ id: String(x.id), reference: String(x.reference) }));
}

export async function stopsForEnquiry(db: DB, enquiryId: string): Promise<{ id: string; text: string; checked: boolean; flightCode: string | null }[]> {
  const r = await db.query("SELECT id, text, checked, flight_code FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [enquiryId]);
  return r.rows.map((x) => ({ id: String(x.id), text: String(x.text), checked: Boolean(x.checked), flightCode: (x.flight_code as string | null) ?? null }));
}

export async function hireById(db: DB, deskId: string, id: string): Promise<Record<string, unknown> | null> {
  const r = await db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, id]);
  return r.rows[0] ?? null;
}

export interface VehicleRow {
  id: string;
  hireId: string;
  seats: number;
  position: number;
  operatorId: string | null;
  bought: Pennies | null;
  margin: string | null;
  selling: Pennies;
  vat: Pennies;
  total: Pennies;
  deposit: Pennies;
  depositFixed: boolean;
  departDate: string | null;
  departTime: string | null;
  departInstant: Date | null;
}

export async function vehiclesFor(db: DB, deskId: string, hireId: string): Promise<VehicleRow[]> {
  const r = await db.query("SELECT * FROM vehicles WHERE desk_id=$1 AND hire_id=$2 ORDER BY position", [deskId, hireId]);
  return r.rows.map((x) => ({
    id: String(x.id),
    hireId: String(x.hire_id),
    seats: Number(x.seats),
    position: Number(x.position),
    operatorId: (x.operator_id as string | null) ?? null,
    bought: x.bought_pennies === null ? null : Number(x.bought_pennies),
    margin: (x.margin_percent as string | null) ?? null,
    selling: Number(x.selling_pennies),
    vat: Number(x.vat_pennies),
    total: Number(x.total_pennies),
    deposit: Number(x.deposit_pennies),
    depositFixed: Boolean(x.deposit_fixed),
    departDate: x.depart_date ? isoDate(x.depart_date as Date) : null,
    departTime: (x.depart_time as string | null) ?? null,
    departInstant: (x.depart_instant as Date | null) ?? null,
  }));
}

export async function runsFor(db: DB, deskId: string, hireId: string): Promise<Record<string, unknown>[]> {
  const r = await db.query("SELECT * FROM runs WHERE desk_id=$1 AND hire_id=$2 ORDER BY number", [deskId, hireId]);
  return r.rows;
}

export async function moneyHeld(db: DB, deskId: string): Promise<Pennies> {
  const r = await db.query<{ sum: string | null }>(
    "SELECT COALESCE(SUM(amount_pennies),0) AS sum FROM ledger_lines WHERE desk_id=$1 AND account='clientMoney'",
    [deskId]
  );
  return Number(r.rows[0].sum ?? 0);
}

export async function vehicleMoneyState(db: DB, deskId: string, vehicleId: string): Promise<{ depositPaid: Pennies; balancePaid: Pennies }> {
  const r = await db.query<{ deposit: string; balance: string }>(
    `SELECT COALESCE(SUM(amount_pennies) FILTER (WHERE account='clientMoney'),0) AS deposit,
            COALESCE(SUM(amount_pennies) FILTER (WHERE account='refundsDue'),0) AS balance
     FROM ledger_lines WHERE desk_id=$1 AND vehicle_id=$2`,
    [deskId, vehicleId]
  );
  return { depositPaid: Number(r.rows[0].deposit), balancePaid: Number(r.rows[0].balance) };
}

export interface PaymentStateInfo {
  paid: Pennies;
  owed: Pennies;
  credit: Pennies;
  paymentState: string;
}

export function paymentStateFor(vehicles: { total: Pennies; deposit: Pennies; depositPaid: Pennies; balancePaid: Pennies }[]): PaymentStateInfo {
  let paid = 0;
  let totalDue = 0;
  let depositsDue = 0;
  for (const v of vehicles) {
    paid += v.depositPaid + v.balancePaid;
    totalDue += v.total;
    depositsDue += v.deposit;
  }
  const owed = Math.max(0, totalDue - paid);
  const credit = Math.max(0, paid - totalDue);
  let paymentState = "nothingPaid";
  const allDepositsPaid = vehicles.length > 0 && vehicles.every((v) => v.depositPaid >= v.deposit);
  const allPaid = vehicles.length > 0 && vehicles.every((v) => v.depositPaid + v.balancePaid >= v.total);
  if (allPaid) paymentState = "paidInFull";
  else if (allDepositsPaid && owed > 0) paymentState = "depositPaid";
  else if (vehicles.some((v) => v.depositPaid > 0)) paymentState = paid >= depositsDue ? "depositPaid" : "depositPartPaid";
  if (allPaid) paymentState = "paidInFull";
  return { paid, owed, credit, paymentState };
}

export async function writeMovement(
  tx: Tx,
  deskId: string,
  hireId: string,
  movementId: string,
  vehicleId: string | null,
  amount: Pennies,
  description: string
): Promise<void> {
  await tx.query(
    `INSERT INTO ledger_lines (id, desk_id, hire_id, movement_id, vehicle_id, account, amount_pennies, at, description) VALUES
     ($1,$2,$3,$4,$5,'clientMoney',$6,NOW(),$7),
     ($8,$2,$3,$4,$5,'hireIncome',$9,NOW(),$7)`,
    [movementId + "-A", deskId, hireId, movementId, vehicleId, String(amount), description, movementId + "-B", String(-amount)]
  );
}

export function nowIso(): string {
  return isoInstant(new Date());
}

export function foldedDriverTelephone(tel: string): string {
  return foldTelephone(tel);
}
