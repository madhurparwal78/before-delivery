import type { Db } from "./db.js";
import type { CredentialRow, PersonRow, RotationRow, RuleRow, TurnRow, VendorRow } from "./model.js";
import { officeDate, officeMidnight, officeMoment } from "./office-time.js";
import { outOfPolicyState, ruleInForce, rulesByVault } from "./rules.js";
import { runsAfter } from "./rotations.js";
import { isDesk } from "./model.js";

export type Health = "sound" | "out_of_policy" | "exposed" | "vendor_breached" | "not_checked";

interface HealthContext {
  exposed: Map<string, number>;
  domains: Set<string>;
}

async function healthContext(db: Db): Promise<HealthContext | null> {
  const row = await db.one<{ exposed: Array<{ id: string; rev: number }>; domains: string[] }>(
    "SELECT exposed, domains FROM breach_checks WHERE ok ORDER BY at DESC LIMIT 1",
  );
  if (!row) return null;
  return { exposed: new Map(row.exposed.map((item) => [item.id, item.rev])), domains: new Set(row.domains) };
}

/** The first of exposed, vendor breached, out of policy that applies; sound otherwise. */
export function healthOf(
  credential: Pick<CredentialRow, "id" | "secret_rev">,
  vendor: Pick<VendorRow, "domain">,
  outOfPolicy: boolean,
  context: HealthContext | null,
): Health {
  if (!context) return "not_checked";
  if (context.exposed.get(credential.id) === credential.secret_rev) return "exposed";
  if (context.domains.has(vendor.domain)) return "vendor_breached";
  return outOfPolicy ? "out_of_policy" : "sound";
}

interface CredentialFacts {
  rule: RuleRow;
  outOfPolicy: boolean;
  since: string | null;
  leewayEndsAt: Date | null;
}

export function factsOf(credential: CredentialRow, rules: RuleRow[], at: Date): CredentialFacts {
  const rule = ruleInForce(rules, officeDate(at));
  return { rule, ...outOfPolicyState(credential.secret_length, credential.imported_on, rule) };
}

interface Holder {
  credential_id: string;
  person_id: string;
  full_name: string;
  left_at: Date | null;
}

function nextTurnOf(
  turns: TurnRow[],
  rotation: RotationRow | undefined,
  at: Date,
): { office_date: string; office_time: string; offset: string } | null {
  const candidates: Array<{ instant: Date; office_date: string; office_time: string; offset: string }> = [];
  for (const turn of turns) {
    if (turn.kind === "scheduled" && turn.run_at && turn.run_date) {
      const moment = officeMoment(turn.run_at);
      candidates.push({ instant: turn.run_at, office_date: turn.run_date, office_time: moment.time, offset: moment.offset });
    } else {
      const midnight = officeMidnight(turn.due_by);
      candidates.push({ instant: midnight, office_date: turn.due_by, office_time: "23:59", offset: officeMoment(midnight).offset });
    }
  }
  if (rotation) {
    const [run] = runsAfter(rotation, at, 1);
    if (run) candidates.push({ instant: run.at, office_date: run.office_date, office_time: run.office_time, offset: run.offset });
  }
  candidates.sort((a, b) => a.instant.getTime() - b.instant.getTime());
  const first = candidates[0];
  return first ? { office_date: first.office_date, office_time: first.office_time, offset: first.offset } : null;
}

/** The login as the API publishes it. It never carries the secret. */
export async function credentialViews(db: Db, rows: CredentialRow[], at: Date): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [holders, turns, rotations, vendors, rules, context] = await Promise.all([
    db.query<Holder>(
      `SELECT h.credential_id, h.person_id, p.full_name, p.left_at FROM holders h JOIN people p ON p.id = h.person_id
       WHERE h.credential_id = ANY($1) ORDER BY h.ord`,
      [ids],
    ),
    db.query<TurnRow>("SELECT * FROM turns WHERE credential_id = ANY($1) AND state <> 'turned'", [ids]),
    db.query<RotationRow>("SELECT * FROM rotations WHERE credential_id = ANY($1)", [ids]),
    db.query<VendorRow>("SELECT * FROM vendors"),
    rulesByVault(db),
    healthContext(db),
  ]);
  const vendorById = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  return rows.map((row) => {
    const vendor = vendorById.get(row.vendor_id);
    if (!vendor) throw new Error("a login has no vendor");
    const facts = factsOf(row, rules.get(row.vault_id) ?? [], at);
    return {
      id: row.id,
      vault_id: row.vault_id,
      vendor: { id: vendor.id, name: vendor.name, domain: vendor.domain, formerly: vendor.formerly },
      label: row.label,
      username: row.username,
      held_by: holders
        .filter((holder) => holder.credential_id === row.id)
        .map((holder) => ({ person_id: holder.person_id, name: holder.full_name, left: holder.left_at !== null })),
      next_turn: nextTurnOf(
        turns.filter((turn) => turn.credential_id === row.id),
        rotations.find((rotation) => rotation.credential_id === row.id),
        at,
      ),
      health: healthOf(row, vendor, facts.outOfPolicy, context),
      out_of_policy: facts.outOfPolicy,
      out_of_policy_since: facts.since,
      leeway_ends_at: facts.leewayEndsAt ? facts.leewayEndsAt.toISOString() : null,
      rule_id: facts.rule.id,
      last_turned_on: row.last_turned_on,
    };
  });
}

export function mayTurn(person: PersonRow): boolean {
  return isDesk(person.role) ? person.role === "office_manager" : person.role === "staff_accountant";
}
