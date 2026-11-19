// Each domain rule is decided here once: quote money, deposits, plans, seats, statements, cells and the ledger's movements.
import { randomInt } from "node:crypto";
import type { Db } from "./db.js";
import { one, rows } from "./db.js";
import { newId, parseMoney, moneyText, notFound } from "./http.js";
import { addDays, isRealDate, type LocalDate } from "../shared/time.js";
import type { HireRow, VehicleRow, LedgerLineRow } from "./records.js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const newReference = (): string => `CV-${Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;

// ---- Quote money, in whole pennies.
export const halfUp = (numerator: number, denominator: number): number => Math.floor((2 * numerator + denominator) / (2 * denominator));
const sellingPrice = (bought: number, marginHalves: number): number => halfUp(bought * (200 + marginHalves), 200);
const vatOn = (seats: number, selling: number): number => (seats === 8 ? halfUp(selling * 20, 100) : 0);
const isMinibus = (seats: number): boolean => seats <= 16;
export interface RateTable {
  id: string; effective_from: string; margin_halves: number; waiting_rate: number; second_driver: number;
  deposit_minibus: number; deposit_minibus_higher: number; deposit_coach: number; deposit_coach_higher: number;
}
export const depositFor = (seats: number, total: number, rates: RateTable): number => {
  if (isMinibus(seats)) return total > 75000 ? rates.deposit_minibus_higher : rates.deposit_minibus;
  return total > 100000 ? rates.deposit_coach_higher : rates.deposit_coach;
};
export const parseMargin = (value: unknown): number | null => {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^\d{1,2}(\.\d+)?$/.test(text)) return null;
  const halves = Number(text) * 2;
  return Number.isInteger(halves) && halves >= 0 && halves <= 120 ? halves : null;
};
export const marginText = (halves: number): string => (halves % 2 ? `${Math.floor(halves / 2)}.5` : String(halves / 2));
export const MARGIN_COPY = "Margin is 0 to 60 in steps of 0.5.";

/** A bid price as typed (1250, 1,250, 1250.5, 1,250.50) in pennies, or null. */
export const parseBidPrice = (typed: unknown): number | null => {
  if (typeof typed !== "string" || !/^(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(typed)) return null;
  return parseMoney(typed.replace(/,/g, ""));
};

export const rateInForce = async (db: Db, deskId: string, date: LocalDate): Promise<RateTable> =>
  (await one<RateTable>(db, "SELECT * FROM rate_tables WHERE desk_id=$1 AND effective_from<=$2 ORDER BY effective_from DESC LIMIT 1", [deskId, date])) as RateTable;
export const rateById = async (db: Db, id: string): Promise<RateTable> => (await one<RateTable>(db, "SELECT * FROM rate_tables WHERE id=$1", [id])) as RateTable;
export const addDefaultRates = async (db: Db, deskId: string): Promise<void> => {
  await db.query(
    "INSERT INTO rate_tables (id,desk_id,effective_from,margin_halves,waiting_rate,second_driver,deposit_minibus,deposit_minibus_higher,deposit_coach,deposit_coach_higher) VALUES ($1,$2,'2000-01-01',30,2000,15000,5000,10000,10000,15000)",
    [newId("RT"), deskId],
  );
};

// ---- Enquiry states.
const LEGAL_STATES: Record<string, string[]> = { new: ["priced", "lost"], priced: ["new", "quoted", "lost"], quoted: ["priced", "won", "lost"], won: ["lost"], lost: ["new"] };
export const isEnquiryState = (state: unknown): state is string => typeof state === "string" && state in LEGAL_STATES;
/** The one place an enquiry changes state: legal changes only, at the row itself. Answers whether it moved. */
export const moveEnquiryState = async (db: Db, hireId: string, to: string): Promise<boolean> => {
  const sources = Object.keys(LEGAL_STATES).filter((from) => LEGAL_STATES[from].includes(to));
  return ((await db.query("UPDATE hires SET state=$2 WHERE id=$1 AND state=ANY($3)", [hireId, to, sources])).rowCount ?? 0) > 0;
};

// ---- Trip plan.
export const SIZES = [70, 56, 49, 31, 16, 12, 8];
export const SIZES_COPY = "Choose sizes from 8, 12, 16, 31, 49, 56 and 70.";
const BAG_UNITS: Record<number, number> = { 8: 16, 12: 24, 16: 32, 31: 62, 49: 98, 56: 112, 70: 140 };
const hasLift = (seats: number): boolean => seats === 16 || seats === 49;
export interface Party { people: number; large: number; medium: number; hand: number; wheelchairs: number }
const bagUnits = (party: Party): number => party.large * 3 + party.medium * 2 + party.hand;
const fits = (plan: number[], party: Party): boolean =>
  plan.reduce((a, s) => a + s, 0) >= party.people && plan.reduce((a, s) => a + BAG_UNITS[s], 0) >= bagUnits(party)
  && plan.filter(hasLift).length * 2 >= party.wheelchairs;
const combinations = (count: number, from = 0): number[][] => {
  if (count === 0) return [[]];
  const out: number[][] = [];
  for (let i = from; i < SIZES.length; i += 1) for (const rest of combinations(count - 1, i)) out.push([SIZES[i], ...rest]);
  return out;
};
export const suggestPlan = (party: Party): number[] => {
  for (let count = 1; ; count += 1) {
    const candidates = combinations(count).filter((plan) => fits(plan, party));
    if (!candidates.length) continue;
    const seats = (plan: number[]): number => plan.reduce((a, s) => a + s, 0);
    candidates.sort((a, b) => seats(a) - seats(b) || b.reduce((order, s, i) => order || s - a[i], 0));
    return candidates[0];
  }
};
export const planRefusal = (sizes: number[], party: Party): string | null => {
  if (!sizes.length || sizes.some((s) => !SIZES.includes(s))) return SIZES_COPY;
  const short = party.people - sizes.reduce((a, s) => a + s, 0);
  if (short > 0) return short === 1 ? "This plan leaves 1 person without a seat." : `This plan leaves ${short} people without a seat.`;
  const bags = bagUnits(party) - sizes.reduce((a, s) => a + BAG_UNITS[s], 0);
  if (bags > 0) return bags === 1 ? "Bags need 1 more unit of space." : `Bags need ${bags} more units of space.`;
  const lifts = party.wheelchairs - sizes.filter(hasLift).length * 2;
  if (lifts > 0) return lifts === 1 ? "This plan has no lift for 1 wheelchair user." : `This plan has no lift for ${lifts} wheelchair users.`;
  return null;
};
export const largerThanNeeded = (sizes: number[], suggested: number[]): boolean =>
  sizes.length > suggested.length
  || (sizes.length === suggested.length && sizes.reduce((a, s) => a + s, 0) > suggested.reduce((a, s) => a + s, 0));
/** km as a decimal string times 0.621371, half up to one decimal, in exact integers. */
export const milesFromKm = (km: string): string => {
  const [whole, fraction = ""] = km.split(".");
  const scaled = BigInt(whole + fraction) * 621371n;
  const denominator = 10n ** BigInt(fraction.length + 6 - 1);
  const tenths = (2n * scaled + denominator) / (2n * denominator);
  return `${tenths / 10n}.${tenths % 10n}`;
};

// ---- Seats.
export const seatLabels = (seats: number): string[] => {
  const letters = seats === 8 ? ["A", "B", "C"] : ["A", "B", "C", "D"];
  return Array.from({ length: seats }, (_, i) => `${Math.floor(i / letters.length) + 1}${letters[i % letters.length]}`);
};
export const WHEELCHAIR_SEATS = ["2A", "2B"];
export const liftOn = hasLift;
export const splitAmong = (total: number, people: number): number[] => {
  const each = Math.floor(total / people);
  const extra = total - each * people;
  return Array.from({ length: people }, (_, i) => each + (i < extra ? 1 : 0));
};

// ---- Files.
const RISKY = /^[=+\-@]/;
const csvCell = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (RISKY.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
export const csvFile = (lines: (string | number | null)[][]): Buffer =>
  Buffer.from(`﻿${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`);
export const downloadHeaders = (filename: string, type: string): Record<string, string> => ({
  "Content-Type": type,
  "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
});
/** RFC 4180 rows from text, with or without a byte order mark. */
export const parseDelimited = (input: string, delimiter = ","): string[][] => {
  const text = input.replace(/^﻿/, "");
  const out: string[][] = [];
  let line: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { line.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      line.push(cell);
      out.push(line);
      line = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || line.length) { line.push(cell); out.push(line); }
  return out;
};

// ---- Statements.
const REFERENCE = /CV[- ]*([0-9A-Z]{5})(?![A-Za-z0-9])/gi;
const READ_AS: Record<string, string> = { O: "0", I: "1", L: "1" };
const VALID = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/;
/** Every reference a description may hold, in the published grammar with O as zero and I and L as one. */
export const referencesIn = (description: string): string[] => {
  const found: string[] = [];
  for (const match of description.matchAll(REFERENCE)) {
    const body = match[1].toUpperCase().replace(/[OIL]/g, (c) => READ_AS[c]);
    if (VALID.test(body)) found.push(`CV-${body}`);
  }
  return found;
};
export const statementAmount = (typed: string): number | null => {
  const text = typed.trim();
  if (!/^-?(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const pennies = parseMoney(text.replace(/^-/, "").replace(/,/g, ""));
  if (pennies === null) return null;
  return negative ? -pennies : pennies;
};

// ---- The ledger: every movement writes two lines in the caller's transaction.
export type Account = "clientMoney" | "hireIncome" | "refundsDue" | "operatorOwed";
export const ACCOUNT_NAMES: Record<Account, string> = { clientMoney: "Client money", hireIncome: "Hire income", refundsDue: "Refunds due", operatorOwed: "Operator owed" };
interface Movement {
  deskId: string; hireId: string; vehicleId: string | null; plus: Account; minus: Account; pennies: number; at: number; part: "deposit" | "balance" | "credit" | "charge" | "secondDriver" | "refundDue" | "refundPaid"; description: string;
}
export const writeMovement = async (tx: Db, m: Movement): Promise<void> => {
  const movement = newId("MV");
  const insert = "INSERT INTO ledger_lines (id,desk_id,movement_id,hire_id,vehicle_id,account,pennies,at,part,description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)";
  await tx.query(insert, [newId("LN"), m.deskId, movement, m.hireId, m.vehicleId, m.plus, m.pennies, m.at, m.part, m.description]);
  await tx.query(insert, [newId("LN"), m.deskId, movement, m.hireId, m.vehicleId, m.minus, -m.pennies, m.at, m.part, m.description]);
};

// ---- Reading a hire with its vehicles and money.
export const ledgerOf = (db: Db, hireId: string): Promise<LedgerLineRow[]> => rows<LedgerLineRow>(db, "SELECT * FROM ledger_lines WHERE hire_id=$1 ORDER BY seq", [hireId]);

export interface VehicleMoney {
  id: string; position: number; seats: number; operator_id: string | null; bought: number; margin_halves: number; deposit: number; charges: number;
  depart_date: string; depart_time: string; depart_repeated: string | null; depart_instant: number;
  selling: number; vat: number; total: number; depositPaid: number; balancePaid: number; refundsDue: number; owed: number; paid: number; retained: number; runId: string | null;
}
export const vehicleTotals = (v: { seats: number; bought: number; margin_halves: number; charges: number }): { selling: number; vat: number; total: number } => {
  const selling = sellingPrice(v.bought, v.margin_halves);
  const vat = vatOn(v.seats, selling);
  return { selling, vat, total: selling + vat + v.charges };
};
export const vehiclesOf = async (db: Db, hireId: string): Promise<VehicleMoney[]> => {
  const list = await rows<VehicleRow & { run_id: string | null }>(db, "SELECT v.*, (SELECT r.id FROM runs r WHERE r.vehicle_id=v.id) AS run_id FROM vehicles v WHERE v.hire_id=$1 ORDER BY v.position", [hireId]);
  const lines = await ledgerOf(db, hireId);
  return list.map((v) => {
    const mine = lines.filter((l) => l.vehicle_id === v.id);
    const sum = (test: (l: LedgerLineRow) => boolean): number => mine.filter(test).reduce((a, l) => a + l.pennies, 0);
    const depositPaid = sum((l) => l.account === "clientMoney" && l.part === "deposit");
    const balancePaid = sum((l) => l.account === "clientMoney" && l.part === "balance");
    const refundsDue = -sum((l) => l.account === "refundsDue");
    const client = sum((l) => l.account === "clientMoney");
    const totals = vehicleTotals(v);
    return { ...v, ...totals, runId: v.run_id, depositPaid, balancePaid, refundsDue, paid: depositPaid + balancePaid, retained: client - refundsDue, owed: Math.max(totals.total - (client - refundsDue), 0) };
  });
};
interface HireMoney { paid: number; owed: number; credit: number; paymentState: "nothingPaid" | "depositPartPaid" | "depositPaid" | "paidInFull" }
export const PAYMENT_NAMES: Record<HireMoney["paymentState"], string> = { nothingPaid: "Nothing paid", depositPartPaid: "Part of the deposit paid", depositPaid: "Deposit paid", paidInFull: "Paid in full" };
export const hireMoney = async (db: Db, hireId: string, vehicles: VehicleMoney[]): Promise<HireMoney> => {
  const lines = (await ledgerOf(db, hireId)).filter((l) => l.account === "clientMoney");
  const paid = lines.filter((l) => l.part !== "refundPaid").reduce((a, l) => a + l.pennies, 0);
  const credit = lines.filter((l) => l.part === "credit").reduce((a, l) => a + l.pennies, 0);
  const owed = vehicles.reduce((a, v) => a + v.owed, 0);
  let paymentState: HireMoney["paymentState"] = "depositPartPaid";
  if (paid === 0) paymentState = "nothingPaid";
  else if (owed === 0) paymentState = "paidInFull";
  else if (vehicles.every((v) => v.depositPaid >= v.deposit)) paymentState = "depositPaid";
  return { paid, owed, credit, paymentState };
};

/** Brings one payment in: deposits by departure then list order, then balances, and what is left stays as credit. */
export const allocatePayment = async (tx: Db, deskId: string, hireId: string, amount: number, description: string, at: number): Promise<void> => {
  const vehicles = (await vehiclesOf(tx, hireId)).sort((a, b) => a.depart_instant - b.depart_instant || a.position - b.position);
  let left = amount;
  const move = async (vehicleId: string | null, pennies: number, part: "deposit" | "balance" | "credit"): Promise<void> => {
    await writeMovement(tx, { deskId, hireId, vehicleId, plus: "clientMoney", minus: "hireIncome", pennies, at, part, description });
    left -= pennies;
  };
  for (const v of vehicles) {
    const due = Math.min(left, Math.max(v.deposit - v.depositPaid, 0));
    if (due > 0) await move(v.id, due, "deposit");
  }
  for (const v of vehicles) {
    const due = Math.min(left, Math.max(v.total - Math.max(v.deposit, v.depositPaid) - v.balancePaid, 0));
    if (due > 0) await move(v.id, due, "balance");
  }
  if (left > 0) await move(null, left, "credit");
};

export const lineJson = (l: LedgerLineRow): Record<string, unknown> => ({
  id: l.id, movementId: l.movement_id, account: l.account, amount: moneyText(l.pennies), at: new Date(l.at * 1000).toISOString().replace(/\.\d+Z$/, "Z"), vehicleId: l.vehicle_id,
});
export const requireHire = async (db: Db, deskId: string, id: string, lock = false): Promise<HireRow> => {
  let hire = await one<HireRow>(db, `SELECT * FROM hires WHERE id=$1 AND desk_id=$2${lock ? " FOR UPDATE" : ""}`, [id, deskId]);
  if (hire?.merged_into) hire = await one<HireRow>(db, `SELECT * FROM hires WHERE id=$1 AND desk_id=$2${lock ? " FOR UPDATE" : ""}`, [hire.merged_into, deskId]);
  if (!hire) throw notFound();
  return hire;
};
export const threeYearsBefore = (date: LocalDate): LocalDate => {
  const year = Number(date.slice(0, 4)) - 3;
  const candidate = `${year}${date.slice(4)}`;
  return isRealDate(candidate) ? candidate : addDays(`${year}-03-01`, -1);
};
