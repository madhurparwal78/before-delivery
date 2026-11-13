import type { Tx } from "./db.js";
import { hashPassword } from "./people.js";
import { MARKS } from "../shared/vesting.js";
import { leaverWindowEnd, offerExpiry } from "./deadlines.js";
import { now, pacificDate } from "./time.js";
import { writeLedgerEntry } from "./ledger.js";
import { latestMark } from "./vesting.js";
import { loadValuations } from "./registry.js";
import { valuationState } from "./valuations.js";

const DEMO_PASSWORD = "Tidecraft-demo-2026";

type SeedPerson = { id: string; name: string; email: string; role: string; access: "active" | "none" };

const PEOPLE: SeedPerson[] = [
  { id: "PER-001", name: "Mara Okafor", email: "mara@tidecraft.example", role: "founder_admin", access: "active" },
  { id: "PER-002", name: "Anselm Kowalczyk", email: "anselm@tidecraft.example", role: "option_holder", access: "none" },
  { id: "PER-003", name: "Juniper Vance", email: "juniper@tidecraft.example", role: "option_holder", access: "active" },
  { id: "PER-004", name: "Kenji Moreau", email: "kenji@tidecraft.example", role: "option_holder", access: "active" },
  { id: "PER-005", name: "Rafael Ostrowski", email: "rafael@tidecraft.example", role: "leaver", access: "active" },
  { id: "PER-006", name: "Larkspur Ventures Fund II", email: "larkspur@larkspur.example", role: "investor", access: "active" },
  { id: "PER-007", name: "Brightwater Angels LLC", email: "brightwater@brightwater.example", role: "investor", access: "active" },
  { id: "PER-008", name: "Priya Natarajan", email: "priya@tidecraft.example", role: "board_member", access: "active" },
  { id: "PER-009", name: "Theo Blackwood", email: "theo@tidecraft.example", role: "board_member", access: "active" },
  { id: "PER-010", name: "Wen Castellanos", email: "wen@tidecraft.example", role: "board_member", access: "active" },
  { id: "PER-011", name: "Harbourline Secondary Partners", email: "harbourline@harbourline.example", role: "investor", access: "none" },
];

const HOLDINGS: Array<{ holder: string; shareClass: "Common" | "Series Seed Preferred" | "Series A Preferred"; shares: number }> = [
  { holder: "PER-001", shareClass: "Common", shares: 4000000 },
  { holder: "PER-002", shareClass: "Common", shares: 2000000 },
  { holder: "PER-006", shareClass: "Series A Preferred", shares: 1500000 },
  { holder: "PER-007", shareClass: "Series Seed Preferred", shares: 300000 },
];

/** The register as it stands at seed time: people, holdings, grants, the pool and two valuations. */
export async function seedRegister(tx: Tx): Promise<void> {
  const seededAt = now();
  const today = pacificDate(seededAt);
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const person of PEOPLE) {
    await tx.query(
      "INSERT INTO people (id, name, first_name, email, role, access, password_hash) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [person.id, person.name, person.name.split(" ")[0], person.email, person.role, person.access, person.access === "active" ? passwordHash : null],
    );
  }
  await tx.query("UPDATE people SET terminated_at = $2, termination_date = $3, window_ends_at = $4 WHERE id = $1", [
    "PER-005",
    seededAt,
    today,
    leaverWindowEnd(seededAt),
  ]);

  await tx.query(
    `INSERT INTO valuations (id, effective_on, expires_on, fmv_units, firm) VALUES
       ('VAL-01', '2024-12-01', '2025-11-30', 4185, 'Marrowgate Valuation Partners'),
       ('VAL-02', '2026-10-01', '2027-09-30', 6120, 'Marrowgate Valuation Partners')`,
  );
  await tx.query("INSERT INTO settings (key, value) VALUES ('authorized', to_jsonb(1000000::bigint))");

  await tx.query(
    `INSERT INTO grants (id, holder_id, options, strike_units, vesting_type, vesting_start, state, accepted_at, agreement_paper, announced_mark)
     VALUES ('TC-OPT-0004', 'PER-005', 24000, 2210, 'standard', '2021-06-30', 'accepted', $1, true, $3),
            ('TC-OPT-0007', 'PER-003', 48000, 4185, 'standard', '2025-01-31', 'accepted', $1, true, $2)`,
    [seededAt, latestMark("2025-01-31", today), MARKS],
  );
  await tx.query(
    `INSERT INTO grants (id, holder_id, options, strike_units, vesting_type, vesting_start, state, offered_at, offer_expires_at)
     VALUES ('TC-OPT-0011', 'PER-004', 12000, 6120, 'standard', '2026-11-02', 'offered', $1, $2)`,
    [seededAt, offerExpiry(seededAt)],
  );
  await tx.query(
    `INSERT INTO votes (grant_id, voter_id, vote, voted_at) VALUES
       ('TC-OPT-0011', 'PER-008', 'approve', $1), ('TC-OPT-0011', 'PER-009', 'approve', $1)`,
    [seededAt],
  );

  for (const holding of HOLDINGS) {
    await writeLedgerEntry(tx, {
      holderId: holding.holder,
      kind: "issuance",
      shareClass: holding.shareClass,
      sharesDelta: holding.shares,
      optionsDelta: 0,
      reference: "Opening holding",
    });
  }
  for (const grant of [{ holder: "PER-005", options: 24000, id: "TC-OPT-0004" }, { holder: "PER-003", options: 48000, id: "TC-OPT-0007" }]) {
    await writeLedgerEntry(tx, {
      holderId: grant.holder,
      kind: "grant_accepted",
      shareClass: null,
      sharesDelta: 0,
      optionsDelta: grant.options,
      reference: grant.id,
    });
  }
  const { current } = await loadValuations(tx);
  await tx.query("INSERT INTO settings (key, value) VALUES ('valuation_state', $1::jsonb)", [JSON.stringify(valuationState(current))]);
}
