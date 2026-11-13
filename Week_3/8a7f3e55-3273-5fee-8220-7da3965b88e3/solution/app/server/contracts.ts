import type { Contract } from "../shared/api.js";
import { type Db, rows } from "./db.js";
import type { RateRow } from "./rules/pricing.js";

interface ContractRow {
  id: string;
  org_id: string;
  org_name: string;
  minimum_minutes: number;
  increment_minutes: number;
  rotation_interval_minutes: number;
}

type StoredRate = RateRow & { contract_id: string };

export async function loadContracts(db: Db, orgId?: string): Promise<Contract[]> {
  const contractRows = await rows<ContractRow>(
    db,
    `SELECT c.id, c.org_id, o.name AS org_name, c.minimum_minutes, c.increment_minutes, c.rotation_interval_minutes
       FROM contracts c JOIN organisations o ON o.id = c.org_id
      WHERE $1::text IS NULL OR c.org_id = $1
      ORDER BY o.name`,
    [orgId ?? null],
  );
  const rateRows = await rows<StoredRate>(
    db,
    `SELECT contract_id, effective_from, hourly_rate_cents, team_surcharge_bp, mileage_cents_per_mile
       FROM contract_rates ORDER BY effective_from`,
  );
  return contractRows.map((contract) => ({
    ...contract,
    rates: rateRows
      .filter((rate) => rate.contract_id === contract.id)
      .map(({ effective_from, hourly_rate_cents, team_surcharge_bp, mileage_cents_per_mile }) => ({
        effective_from,
        hourly_rate_cents,
        team_surcharge_bp,
        mileage_cents_per_mile,
      })),
  }));
}

export async function loadContract(db: Db, orgId: string): Promise<Contract> {
  const contract = (await loadContracts(db, orgId))[0];
  if (contract === undefined) throw new Error(`no contract for ${orgId}`);
  return contract;
}
