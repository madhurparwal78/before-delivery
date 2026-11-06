import { query, queryOne } from '../db/pool';
import { DueDiligence, NetworkStanding } from '../domain/case';

export interface CounterpartyRow {
  id: string;
  workspace_slug: string;
  legal_name: string;
  normalised_name: string;
  name_from: string;
  lei: string;
  jurisdiction_code: string;
  licence_number: string;
  due_diligence: string;
  network: string;
  contact_email: string;
  notes: string;
  signing_value: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PreviousNameRow {
  counterparty_id: string;
  name: string;
  from_date: string;
  until_date: string;
}

export async function listCounterparties(workspaceSlug: string): Promise<CounterpartyRow[]> {
  return query<CounterpartyRow>(
    'SELECT * FROM counterparties WHERE workspace_slug = $1 ORDER BY legal_name',
    [workspaceSlug],
  );
}

export async function findCounterparty(
  workspaceSlug: string,
  id: string,
): Promise<CounterpartyRow | null> {
  return queryOne<CounterpartyRow>(
    'SELECT * FROM counterparties WHERE workspace_slug = $1 AND id = $2',
    [workspaceSlug, id],
  );
}

export async function previousNames(counterpartyId: string): Promise<PreviousNameRow[]> {
  return query<PreviousNameRow>(
    `SELECT counterparty_id, name, from_date, until_date FROM counterparty_previous_names
     WHERE counterparty_id = $1 ORDER BY from_date, recorded_at`,
    [counterpartyId],
  );
}

export async function registryAddresses(
  workspaceSlug: string,
  counterpartyId: string,
): Promise<string[]> {
  const rows = await query<{ address: string }>(
    'SELECT address FROM address_registry WHERE workspace_slug = $1 AND counterparty_id = $2 ORDER BY address',
    [workspaceSlug, counterpartyId],
  );
  return rows.map((row) => row.address);
}

export async function findByAddress(
  workspaceSlug: string,
  address: string,
): Promise<CounterpartyRow | null> {
  return queryOne<CounterpartyRow>(
    `SELECT c.* FROM address_registry a JOIN counterparties c ON c.id = a.counterparty_id
     WHERE a.workspace_slug = $1 AND a.address = $2`,
    [workspaceSlug, address],
  );
}

export function dueDiligenceOf(row: CounterpartyRow): DueDiligence {
  return row.due_diligence as DueDiligence;
}

export function networkOf(row: CounterpartyRow): NetworkStanding {
  return row.network as NetworkStanding;
}

/** Only the counterparty itself is shown with its current name. */
export function presentCounterparty(row: CounterpartyRow): Record<string, unknown> {
  return {
    id: row.id,
    legalName: row.legal_name,
    lei: row.lei,
    jurisdictionCode: row.jurisdiction_code,
    licenceNumber: row.licence_number,
    dueDiligence: row.due_diligence,
    network: row.network,
    contactEmail: row.contact_email,
    notes: row.notes,
    updatedAt: `${new Date(Math.floor(row.updated_at.getTime() / 1000) * 1000).toISOString().slice(0, 19)}Z`,
  };
}
