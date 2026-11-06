import { syncWritable } from '../shared/addons';
import type { AccountRow, Caller } from './auth';
import type { Database } from './db';
import { ApiError, notFound } from './errors';
import type { EntitlementReader } from './entitlement';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Anything that is not a well-formed id is simply not found. */
export function requireUuid(value: string | undefined): string {
  if (!value || !UUID.test(value)) throw notFound();
  return value;
}

export interface VaultAccess {
  id: string;
  name: string;
  role: 'owner' | 'partner';
  created_at: Date;
  owner_account_id: string;
  key_envelope: unknown;
}

export async function requireVaultMember(db: Database, accountId: string, vaultId: string | undefined): Promise<VaultAccess> {
  const id = requireUuid(vaultId);
  const row = await db.one<VaultAccess>(
    `select v.id, v.name, m.role, v.created_at, v.owner_account_id, v.key_envelope
       from vaults v join vault_members m on m.vault_id = v.id
      where v.id = $1 and m.account_id = $2`,
    [id, accountId],
  );
  if (!row) throw notFound();
  return row;
}

export function requireApprovedDevice(caller: Caller): void {
  if (!caller.device.approved) {
    throw new ApiError(403, 'device_not_approved', 'Approve this device from the email we sent you.');
  }
}

/** Pushes and restores follow the vault owner's Sync state. */
export async function requireWritableVault(
  db: Database,
  entitlement: EntitlementReader,
  vault: VaultAccess,
): Promise<void> {
  const owner = await db.one<AccountRow>(
    'select id, email, display_name, password_hash, time_zone, operator from accounts where id = $1',
    [vault.owner_account_id],
  );
  if (!owner) throw notFound();
  const plans = await entitlement.read(owner);
  if (!syncWritable(plans.sync.state)) {
    throw new ApiError(403, 'vault_read_only', 'This vault is read-only because Sync has lapsed.');
  }
}
