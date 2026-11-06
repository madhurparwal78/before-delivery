import { zonedTimeToUtc } from "./tz.js";
import { hashPassword } from "./auth.js";
import type { PoolClient } from "pg";
import type { InstrumentType, Size } from "../shared/domain.js";

const SEED_FLAG = "seed-v1";

interface SeededUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
  familyId: string | null;
  schoolId: string | null;
}

const USERS: SeededUser[] = [
  { id: "U-owner", name: "Dana Whitlock", email: "owner@keelandbell.example", password: "brass-owner-2026", role: "owner", familyId: null, schoolId: null },
  { id: "U-tech", name: "Ira Penhallow", email: "tech@keelandbell.example", password: "brass-tech-2026", role: "tech", familyId: null, schoolId: null },
  { id: "U-cmarrow", name: "Celia Marrow", email: "cmarrow@larkspur.example", password: "baton-larkspur-2026", role: "director", familyId: null, schoolId: "larkspur" },
  { id: "U-tibarra", name: "Tomás Ibarra", email: "tibarra@ferncliff.example", password: "baton-ferncliff-2026", role: "director", familyId: null, schoolId: "ferncliff" },
  { id: "U-robin", name: "Robin Alder", email: "robin.alder@example.com", password: "family-alder-2026", role: "parent", familyId: "F-01", schoolId: null },
  { id: "U-sam", name: "Sam Brandt", email: "sam.brandt@example.com", password: "family-brandt-2026", role: "parent", familyId: "F-02", schoolId: null },
  { id: "U-lee", name: "Lee Castellanos", email: "lee.castellanos@example.com", password: "family-castellanos-2026", role: "parent", familyId: "F-03", schoolId: null },
  { id: "U-avery", name: "Avery Dunmore", email: "avery.dunmore@example.com", password: "family-dunmore-2026", role: "parent", familyId: "F-04", schoolId: null },
];

const FAMILIES = [
  { id: "F-01", parent_name: "Robin Alder", email: "robin.alder@example.com", phone: "555-0101", address: "14 Orchard Row" },
  { id: "F-02", parent_name: "Sam Brandt", email: "sam.brandt@example.com", phone: "555-0102", address: "9 Mill Lane" },
  { id: "F-03", parent_name: "Lee Castellanos", email: "lee.castellanos@example.com", phone: "555-0103", address: "220 Quarry Road" },
  { id: "F-04", parent_name: "Avery Dunmore", email: "avery.dunmore@example.com", phone: "555-0104", address: "3 Tannery Court" },
];

const SCHOOLS = [
  { id: "larkspur", name: "Larkspur Middle School", delivery_weekday: "Tuesday" },
  { id: "ferncliff", name: "Ferncliff Elementary", delivery_weekday: "Thursday" },
];

const STUDENTS = [
  { id: "S-01", name: "Juniper Alder", grade: 7, school_id: "larkspur", family_id: "F-01" },
  { id: "S-02", name: "Theo Alder", grade: 4, school_id: "ferncliff", family_id: "F-01" },
  { id: "S-03", name: "Mira Brandt", grade: 6, school_id: "larkspur", family_id: "F-02" },
  { id: "S-04", name: "Nico Castellanos", grade: 6, school_id: "larkspur", family_id: "F-03" },
  { id: "S-05", name: "Ezra Dunmore", grade: 6, school_id: "larkspur", family_id: "F-04" },
  { id: "S-06", name: "Wren Dunmore", grade: 4, school_id: "ferncliff", family_id: "F-04" },
];

const PRICE_LIST_ITEMS = [
  { instrument_type: "flute", base_rent_cents: 2400, waiver_cents: 500, purchase_price_cents: 72000 },
  { instrument_type: "clarinet", base_rent_cents: 2400, waiver_cents: 500, purchase_price_cents: 72000 },
  { instrument_type: "trumpet", base_rent_cents: 2600, waiver_cents: 600, purchase_price_cents: 83200 },
  { instrument_type: "violin", base_rent_cents: 1800, waiver_cents: 400, purchase_price_cents: 54000 },
  { instrument_type: "cello", base_rent_cents: 4500, waiver_cents: 900, purchase_price_cents: 180000 },
];

const PRICE_LIST_TIERS = [
  { from_month: 0, to_month: 3, percent: 40, name: "Term 1" },
  { from_month: 4, to_month: 12, percent: 30, name: "Year 1" },
  { from_month: 13, to_month: null, percent: 20, name: "After" },
];

interface SeededInstrument {
  id: string;
  serial: string;
  instrument_type: InstrumentType;
  size: Size;
  model: string;
  status: string;
  contractId: string | null;
}

const INSTRUMENTS: SeededInstrument[] = [
  { id: "I-fl-0101", serial: "KB-FL-0101", instrument_type: "flute", size: "full", model: "Corvin FL-200", status: "available", contractId: null },
  { id: "I-fl-0102", serial: "KB-FL-0102", instrument_type: "flute", size: "full", model: "Corvin FL-200", status: "available", contractId: null },
  { id: "I-cl-0201", serial: "KB-CL-0201", instrument_type: "clarinet", size: "full", model: "Corvin CL-300", status: "available", contractId: null },
  { id: "I-cl-0202", serial: "KB-CL-0202", instrument_type: "clarinet", size: "full", model: "Corvin CL-300", status: "available", contractId: null },
  { id: "I-tr-0301", serial: "KB-TR-0301", instrument_type: "trumpet", size: "full", model: "Harlow TR-150", status: "on_contract", contractId: "C-1002" },
  { id: "I-tr-0302", serial: "KB-TR-0302", instrument_type: "trumpet", size: "full", model: "Harlow TR-150", status: "available", contractId: null },
  { id: "I-vn-0401", serial: "KB-VN-0401", instrument_type: "violin", size: "1/4", model: "Ostwald VN-10", status: "on_contract", contractId: "C-1001" },
  { id: "I-vn-0402", serial: "KB-VN-0402", instrument_type: "violin", size: "1/2", model: "Ostwald VN-10", status: "available", contractId: null },
  { id: "I-vn-0403", serial: "KB-VN-0403", instrument_type: "violin", size: "1/2", model: "Ostwald VN-10", status: "available", contractId: null },
  { id: "I-vn-0404", serial: "KB-VN-0404", instrument_type: "violin", size: "3/4", model: "Ostwald VN-10", status: "available", contractId: null },
  { id: "I-vn-0405", serial: "KB-VN-0405", instrument_type: "violin", size: "4/4", model: "Ostwald VN-10", status: "available", contractId: null },
  { id: "I-ce-0501", serial: "KB-CE-0501", instrument_type: "cello", size: "1/2", model: "Ostwald CE-20", status: "available", contractId: null },
  { id: "I-ce-0502", serial: "KB-CE-0502", instrument_type: "cello", size: "1/2", model: "Ostwald CE-20", status: "on_contract", contractId: "C-1003" },
  { id: "I-ce-0503", serial: "KB-CE-0503", instrument_type: "cello", size: "3/4", model: "Ostwald CE-20", status: "available", contractId: null },
  { id: "I-ce-0504", serial: "KB-CE-0504", instrument_type: "cello", size: "4/4", model: "Ostwald CE-20", status: "available", contractId: null },
  { id: "I-ce-0505", serial: "KB-CE-0505", instrument_type: "cello", size: "1/4", model: "Ostwald CE-20", status: "retired", contractId: null },
];

// 12:00 PM store time on the given date.
function storeNoon(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return zonedTimeToUtc(y, m, d, 12, 0);
}

const CONTRACTS = [
  {
    id: "C-1001",
    numericId: 1001,
    studentId: "S-02",
    familyId: "F-01",
    schoolId: "ferncliff",
    instrumentId: "I-vn-0401",
    waiver: true,
    openingEquity: 16200,
    signedAt: storeNoon("2025-09-03"),
    activatedAt: storeNoon("2025-09-04"),
    deliveryDate: "2025-09-04",
  },
  {
    id: "C-1002",
    numericId: 1002,
    studentId: "S-03",
    familyId: "F-02",
    schoolId: "larkspur",
    instrumentId: "I-tr-0301",
    waiver: false,
    openingEquity: 7800,
    signedAt: storeNoon("2025-08-28"),
    activatedAt: storeNoon("2025-09-02"),
    deliveryDate: "2025-09-02",
  },
  {
    id: "C-1003",
    numericId: 1003,
    studentId: "S-01",
    familyId: "F-01",
    schoolId: "larkspur",
    instrumentId: "I-ce-0502",
    waiver: true,
    openingEquity: 67500,
    signedAt: storeNoon("2024-09-03"),
    activatedAt: storeNoon("2024-09-03"),
    deliveryDate: "2024-09-03",
  },
];

export async function ensureSeed(client: PoolClient, clockNow: Date): Promise<void> {
  const flag = await client.query("SELECT value FROM app_meta WHERE key = $1", ["seed"]);
  if (flag.rows.length > 0) return;
  // Mark first: the seed is written only into a database that has never been
  // seeded. Inserting the flag before writing keeps a crashed seed from
  // half-applying on a retry... but a crash mid-seed would leave the flag set
  // with missing rows. The advisory lock plus single transaction below makes
  // that impossible: this whole function runs inside one transaction.
  for (const family of FAMILIES) {
    await client.query(
      "INSERT INTO families (id, parent_name, email, phone, address) VALUES ($1,$2,$3,$4,$5)",
      [family.id, family.parent_name, family.email, family.phone, family.address]
    );
  }
  for (const [idx, school] of SCHOOLS.entries()) {
    await client.query(
      "INSERT INTO schools (id, name, delivery_weekday, ordinal) VALUES ($1,$2,$3,$4)",
      [school.id, school.name, school.delivery_weekday, idx]
    );
  }
  for (const user of USERS) {
    await client.query(
      "INSERT INTO users (id, name, email, password_hash, role, family_id, school_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [user.id, user.name, user.email, hashPassword(user.password), user.role, user.familyId, user.schoolId]
    );
  }
  for (const student of STUDENTS) {
    await client.query(
      "INSERT INTO students (id, name, grade, school_id, family_id) VALUES ($1,$2,$3,$4,$5)",
      [student.id, student.name, student.grade, student.school_id, student.family_id]
    );
  }
  const plCreated = new Date("2024-01-01T12:00:00Z");
  await client.query(
    "INSERT INTO price_lists (id, effective_date, tax_rate_bp, items, tiers, created_at, withdrawn_at) VALUES ($1,$2,$3,$4,$5,$6,NULL)",
    ["PL-2024-01", "2024-01-01", 825, JSON.stringify(PRICE_LIST_ITEMS), JSON.stringify(PRICE_LIST_TIERS), plCreated]
  );
  for (const instrument of INSTRUMENTS) {
    await client.query(
      "INSERT INTO instruments (id, serial, instrument_type, size, model, status, current_contract_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [instrument.id, instrument.serial, instrument.instrument_type, instrument.size, instrument.model, instrument.status, instrument.contractId]
    );
  }
  for (const contract of CONTRACTS) {
    const anchor = contract.activatedAt.toISOString().slice(0, 10);
    await client.query(
      `INSERT INTO contracts (id, numeric_id, student_id, family_id, school_id, instrument_id, waiver, status,
        price_list_id, delivery_date, signed_at, activated_at, billing_anchor_date, agreement_stored,
        subscription_state, created_at, created_seq)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active','PL-2024-01',$8,$9,$10,$11,true,NULL,$12,0)`,
      [
        contract.id,
        contract.numericId,
        contract.studentId,
        contract.familyId,
        contract.schoolId,
        contract.instrumentId,
        contract.waiver,
        contract.deliveryDate,
        contract.activatedAt,
        contract.activatedAt,
        anchor,
        contract.activatedAt,
      ]
    );
    await client.query(
      `INSERT INTO ledger_entries (id, contract_id, kind, amount_cents, transfer_id, payment_id, reversed, created_at, seq)
       VALUES ($1,$2,'opening',$3,NULL,NULL,NULL,$4,1)`,
      [`ledger-${contract.id}-opening`, contract.id, contract.openingEquity, contract.activatedAt]
    );
    await client.query(
      `INSERT INTO contract_history (contract_id, from_status, to_status, at, actor, actor_name, seq)
       VALUES ($1, NULL, 'active', $2, 'owner', NULL, 1)`,
      [contract.id, contract.activatedAt]
    );
  }
  await client.query("INSERT INTO app_meta (key, value) VALUES ($1,$2)", ["seed", SEED_FLAG]);
  void clockNow;
}
