import { config } from "./config.js";
import type { Transaction } from "./db.js";
import { withTransaction } from "./db.js";
import { serverDate } from "./domain/dates.js";
import { SCHEMA_SQL } from "./schema.js";
import { hashPassword } from "./passwords.js";

const SEED_PASSWORD = "Tidecraft-demo-2026";

interface SeedPerson {
  id: string;
  name: string;
  firstName: string;
  email: string;
  role: string;
  access: string;
}

const PEOPLE: SeedPerson[] = [
  { id: "PER-001", name: "Mara Okafor", firstName: "Mara", email: "mara@tidecraft.example", role: "founder_admin", access: "active" },
  { id: "PER-002", name: "Anselm Kowalczyk", firstName: "Anselm", email: "anselm@tidecraft.example", role: "option_holder", access: "none" },
  { id: "PER-003", name: "Juniper Vance", firstName: "Juniper", email: "juniper@tidecraft.example", role: "option_holder", access: "active" },
  { id: "PER-004", name: "Kenji Moreau", firstName: "Kenji", email: "kenji@tidecraft.example", role: "option_holder", access: "active" },
  { id: "PER-005", name: "Rafael Ostrowski", firstName: "Rafael", email: "rafael@tidecraft.example", role: "leaver", access: "active" },
  { id: "PER-006", name: "Larkspur Ventures Fund II", firstName: "Larkspur", email: "larkspur@larkspur.example", role: "investor", access: "active" },
  { id: "PER-007", name: "Brightwater Angels LLC", firstName: "Brightwater", email: "brightwater@brightwater.example", role: "investor", access: "active" },
  { id: "PER-008", name: "Priya Natarajan", firstName: "Priya", email: "priya@tidecraft.example", role: "board_member", access: "active" },
  { id: "PER-009", name: "Theo Blackwood", firstName: "Theo", email: "theo@tidecraft.example", role: "board_member", access: "active" },
  { id: "PER-010", name: "Wen Castellanos", firstName: "Wen", email: "wen@tidecraft.example", role: "board_member", access: "active" },
  { id: "PER-011", name: "Harbourline Secondary Partners", firstName: "Harbourline", email: "harbourline@harbourline.example", role: "investor", access: "none" },
];

const HOLDINGS: ReadonlyArray<[string, string, number]> = [
  ["PER-001", "Common", 4000000],
  ["PER-002", "Common", 2000000],
  ["PER-006", "Series A Preferred", 1500000],
  ["PER-007", "Series Seed Preferred", 300000],
];

export async function applySchemaAndSeed(): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.query(SCHEMA_SQL);
  });
  await withTransaction(async (tx) => {
    const existing = await tx.queryOne<{ count: string }>("select count(*)::text as count from people");
    if (existing !== null && Number(existing.count) > 0) return;
    await seedRegister(tx);
  });
}

async function seedRegister(tx: Transaction): Promise<void> {
  const seedTime = new Date();
  const seedDate = serverDate(seedTime);
  const passwordHash = await hashPassword(SEED_PASSWORD);

  for (const person of PEOPLE) {
    await tx.query(
      `insert into people (id, name, first_name, email, role, access, password_hash)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [person.id, person.name, person.firstName, person.email, person.role, person.access, person.access === "none" ? null : passwordHash],
    );
  }

  const windowEnds = new Date(seedTime.getTime() + config.leaverWindowSeconds * 1000);
  const warnings = config.leaverWarningsSeconds
    .map((offset) => new Date(windowEnds.getTime() - offset * 1000))
    .filter((at) => at.getTime() > seedTime.getTime());
  await tx.query(
    `update people
        set terminated_at = $2, termination_date = $3, window_ends_at = $4, warnings_at = $5
      where id = $1`,
    ["PER-005", seedTime, seedDate, windowEnds, warnings.map((at) => at.toISOString())],
  );

  for (const [personId, shareClass, shares] of HOLDINGS) {
    await tx.query("insert into holdings (person_id, share_class, shares) values ($1, $2, $3)", [personId, shareClass, shares]);
    await insertLedgerEntry(tx, seedTime, personId, "issuance", shareClass, shares, 0, null);
  }

  await tx.query("insert into option_pool (id, authorized) values (1, 1000000)");

  await tx.query(
    `insert into grants (id, holder_id, options, strike, vesting_type, vesting_start, state, agreement_status, accepted_at, created_at)
     values ('TC-OPT-0004', 'PER-005', 24000, 0.2210, 'standard', '2021-06-30', 'accepted', 'paper', $1, $1)`,
    [seedTime],
  );
  await insertLedgerEntry(tx, seedTime, "PER-005", "grant_accepted", null, 0, 24000, "TC-OPT-0004");

  await tx.query(
    `insert into grants (id, holder_id, options, strike, vesting_type, vesting_start, state, agreement_status, accepted_at, created_at)
     values ('TC-OPT-0007', 'PER-003', 48000, 0.4185, 'standard', '2025-01-31', 'accepted', 'paper', $1, $1)`,
    [seedTime],
  );
  await insertLedgerEntry(tx, seedTime, "PER-003", "grant_accepted", null, 0, 48000, "TC-OPT-0007");

  const offerExpires = new Date(seedTime.getTime() + config.offerWindowSeconds * 1000);
  const offerWarning = new Date(offerExpires.getTime() - config.offerWarningSeconds * 1000);
  await tx.query(
    `insert into grants (id, holder_id, options, strike, vesting_type, vesting_start, state, agreement_status,
                         offered_at, offer_expires_at, offer_warning_at, created_at)
     values ('TC-OPT-0011', 'PER-004', 12000, 0.6120, 'standard', '2026-11-02', 'offered', 'none', $1, $2, $3, $1)`,
    [seedTime, offerExpires, offerWarning],
  );
  for (const voter of ["PER-008", "PER-009"]) {
    await tx.query("insert into grant_votes (grant_id, person_id, vote, at) values ('TC-OPT-0011', $1, 'approve', $2)", [voter, seedTime]);
  }

  await tx.query(
    `insert into valuations (id, effective_on, expires_on, fmv_per_share, firm, recorded_at)
     values ('VAL-01', '2024-12-01', '2025-11-30', 0.4185, 'Marrowgate Valuation Partners', $1),
            ('VAL-02', '2026-10-01', '2027-09-30', 0.6120, 'Marrowgate Valuation Partners', $1)`,
    [seedTime],
  );

  await tx.query("insert into register_state (key, value) values ('last_vesting_date', $1)", [seedDate]);
}

async function insertLedgerEntry(
  tx: Transaction,
  at: Date,
  holderId: string | null,
  kind: string,
  shareClass: string | null,
  sharesDelta: number,
  optionsDelta: number,
  reference: string | null,
): Promise<void> {
  const row = await tx.queryOne<{ value: string }>("select nextval('ledger_number') as value");
  if (row === null) throw new Error("ledger sequence produced no value");
  const id = `LED-${String(row.value).padStart(6, "0")}`;
  await tx.query(
    `insert into ledger_entries (id, at, holder_id, kind, share_class, shares_delta, options_delta, reference)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, at, holderId, kind, shareClass, sharesDelta, optionsDelta, reference],
  );
}
