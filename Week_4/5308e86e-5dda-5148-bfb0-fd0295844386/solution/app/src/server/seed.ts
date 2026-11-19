/** The starting data, written once at the first moment the database is reachable. */
import { createHash } from "node:crypto";
import { PLANS } from "../shared/plans.js";
import type { Tx } from "./db.js";
import { addDays, newYorkDate, newYorkHour } from "./clock.js";
import { createAuditHead } from "./domain/audit.js";
import { hashPassword } from "./domain/auth.js";
import { newId } from "./ids.js";

const DEMO_PASSWORD = "deku-demo-pw-2026";
const NOON = 12;
const SEED_LOCK = 7_301_002;

interface SeedUser {
  email: string;
  name: string;
  role: "owner" | "admin" | "member";
}

async function insertCompany(tx: Tx, name: string, users: SeedUser[], now: Date): Promise<string> {
  const companyId = newId();
  await tx.query("INSERT INTO companies (id, name, created_at) VALUES ($1, $2, $3)", [companyId, name, now]);
  await createAuditHead(tx, companyId);
  for (const user of users) {
    const userId = newId();
    await tx.query("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)", [userId, user.email, user.name, await hashPassword(DEMO_PASSWORD), now]);
    await tx.query("INSERT INTO memberships (user_id, company_id, role) VALUES ($1, $2, $3)", [userId, companyId, user.role]);
  }
  return companyId;
}

async function insertAccount(tx: Tx, companyId: string, name: string, kind: string, balance: number, now: Date): Promise<string> {
  const id = newId();
  await tx.query("INSERT INTO accounts (id, company_id, name, kind, balance_cents, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [id, companyId, name, kind, balance, now]);
  return id;
}

interface SeedTransaction {
  daysBefore: number;
  direction: "credit" | "debit";
  amountCents: number;
  counterparty: string;
  method: string;
}

async function insertTransactions(tx: Tx, companyId: string, accountId: string, firstStart: string, rows: SeedTransaction[]): Promise<void> {
  for (const row of rows) {
    await tx.query(
      `INSERT INTO transactions (id, company_id, account_id, direction, amount_cents, method, counterparty, memo, transfer_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8)`,
      [newId(), companyId, accountId, row.direction, row.amountCents, row.method, row.counterparty, newYorkHour(addDays(firstStart, -row.daysBefore), NOON)],
    );
  }
}

async function insertRecipient(tx: Tx, companyId: string, name: string, account: string, routing: string, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO recipients (id, company_id, kind, method, display_name, status, account_last4, bank_fingerprint, created_at)
     VALUES ($1, $2, 'business', 'ach', $3, 'active', $4, $5, $6)`,
    [newId(), companyId, name, account.slice(-4), createHash("sha256").update(`${routing}:${account}`).digest("hex"), now],
  );
}

/** Writes the seed when the database holds none; returns whether it did. */
export async function seedIfEmpty(tx: Tx, now: Date): Promise<boolean> {
  await tx.query("SELECT pg_advisory_xact_lock($1)", [SEED_LOCK]);
  const existing = await tx.query("SELECT 1 FROM plans LIMIT 1");
  if (existing.rows[0]) return false;
  const firstStart = newYorkDate(now);

  const larkspur = await insertCompany(
    tx,
    "Larkspur Studio",
    [
      { email: "owner@example.com", name: "Rowan Pike", role: "owner" },
      { email: "admin@example.com", name: "Imani Cole", role: "admin" },
      { email: "member@example.com", name: "Theo Marsh", role: "member" },
    ],
    now,
  );
  const checking = await insertAccount(tx, larkspur, "Checking", "checking", 1_842_050, now);
  const savings = await insertAccount(tx, larkspur, "Savings", "savings", 6_000_000, now);
  await insertTransactions(tx, larkspur, checking, firstStart, [
    { daysBefore: 20, direction: "credit", amountCents: 1_555_690, counterparty: "Larkspur Studio", method: "ach" },
    { daysBefore: 12, direction: "credit", amountCents: 420_000, counterparty: "Brightline Media", method: "ach" },
    { daysBefore: 6, direction: "debit", amountCents: 125_000, counterparty: "Northwind Supply", method: "ach" },
    { daysBefore: 2, direction: "debit", amountCents: 8_640, counterparty: "Corner Print Shop", method: "card" },
  ]);
  await insertTransactions(tx, larkspur, savings, firstStart, [
    { daysBefore: 25, direction: "credit", amountCents: 6_000_000, counterparty: "Larkspur Studio", method: "ach" },
  ]);
  await insertRecipient(tx, larkspur, "Northwind Supply", "000123456612", "021000021", now);
  const invoices = [
    ["INV-1002", "Brightline Media", 275_000, "sent"],
    ["INV-1003", "Brightline Media", 90_000, "draft"],
    ["INV-1004", "Fieldstone", 61_875, "sent"],
    ["INV-1005", "Harbor Row Cafe", 12_500, "sent"],
  ] as const;
  for (const [number, customer, total, status] of invoices) {
    await tx.query("INSERT INTO invoices (id, company_id, number, customer_name, total_cents, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [newId(), larkspur, number, customer, total, status, now]);
  }
  await tx.query(
    "INSERT INTO loans (id, company_id, name, principal_cents, drawn_cents, funding_account_id, created_at) VALUES ($1, $2, 'Larkspur Venture Line', 25000000, 0, $3, $4)",
    [newId(), larkspur, checking, now],
  );

  const outpost = await insertCompany(tx, "Outpost Goods", [{ email: "outsider@example.com", name: "Sasha Reyes", role: "owner" }], now);
  const outpostChecking = await insertAccount(tx, outpost, "Outpost Checking", "checking", 250_000, now);
  await insertTransactions(tx, outpost, outpostChecking, firstStart, [
    { daysBefore: 10, direction: "credit", amountCents: 250_000, counterparty: "Outpost Goods", method: "ach" },
  ]);
  await insertRecipient(tx, outpost, "Cedar Freight", "000987654321", "021000021", now);

  for (const plan of PLANS) {
    await tx.query("INSERT INTO plans (id, name, monthly_cents, annual_cents, features) VALUES ($1, $2, $3, $4, $5)", [newId(), plan.name, plan.monthlyCents, plan.annualCents, JSON.stringify(plan.features)]);
  }
  return true;
}
