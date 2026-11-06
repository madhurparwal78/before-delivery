import { query, queryOne } from '../db/pool';
import { maskIdentityNumber, maskPersonName } from '../domain/masking';
import { Role } from '../http/runtime';

export interface CustomerRow {
  id: string;
  workspace_slug: string;
  name: string;
  identity_number: string;
  date_of_birth: string;
  deposit_address: string;
}

export async function listCustomers(workspaceSlug: string): Promise<CustomerRow[]> {
  return query<CustomerRow>(
    'SELECT * FROM customers WHERE workspace_slug = $1 ORDER BY sort_order',
    [workspaceSlug],
  );
}

export async function findCustomer(workspaceSlug: string, id: string): Promise<CustomerRow | null> {
  return queryOne<CustomerRow>('SELECT * FROM customers WHERE workspace_slug = $1 AND id = $2', [
    workspaceSlug,
    id,
  ]);
}

export async function findCustomerByDepositAddress(
  workspaceSlug: string,
  address: string,
): Promise<CustomerRow | null> {
  return queryOne<CustomerRow>(
    'SELECT * FROM customers WHERE workspace_slug = $1 AND deposit_address = $2',
    [workspaceSlug, address],
  );
}

export function presentCustomer(row: CustomerRow, role: Role): Record<string, unknown> {
  if (role === 'support_agent') {
    return {
      id: row.id,
      name: maskPersonName(row.name),
      identityNumber: maskIdentityNumber(row.identity_number),
      depositAddress: row.deposit_address,
    };
  }
  return {
    id: row.id,
    name: row.name,
    identityNumber: row.identity_number,
    dateOfBirth: row.date_of_birth,
    depositAddress: row.deposit_address,
  };
}
