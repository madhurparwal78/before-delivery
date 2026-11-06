import type { AddonName } from '../shared/addons';
import { hashPassword, newId, type AccountRow } from './auth';
import { BillingUnavailableError, CAIRN_CATALOG_XML } from './killbill';
import type { Services } from './services';

interface SeedAccount {
  email: string;
  password: string;
  displayName: string;
  timeZone: string;
  operator: boolean;
  addons: AddonName[];
}

export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  {
    email: 'ops@tidewrack.example',
    password: 'cairn-ops-7731-dev',
    displayName: 'Tidewrack Ops',
    timeZone: 'Europe/Lisbon',
    operator: true,
    addons: [],
  },
  {
    email: 'ines.marlow@casefile.example',
    password: 'field-notes-4418',
    displayName: 'Ines Marlow',
    timeZone: 'Europe/Lisbon',
    operator: false,
    addons: ['sync', 'publish'],
  },
  {
    email: 'tomasz.reyes@casefile.example',
    password: 'co-edit-2290',
    displayName: 'Tomasz Reyes',
    timeZone: 'America/Bogota',
    operator: false,
    addons: [],
  },
  {
    email: 'hana.okoye@ledgerdesk.example',
    password: 'other-case-6603',
    displayName: 'Hana Okoye',
    timeZone: 'Asia/Singapore',
    operator: false,
    addons: ['sync'],
  },
];

export async function applySeedAccounts(services: Services): Promise<void> {
  for (const seed of SEED_ACCOUNTS) {
    const existing = await services.db.one<{ id: string }>('select id from accounts where lower(email) = lower($1)', [
      seed.email,
    ]);
    if (existing) continue;
    await services.db.query(
      'insert into accounts (id, email, display_name, password_hash, time_zone, operator) values ($1, $2, $3, $4, $5, $6)',
      [newId(), seed.email, seed.displayName, await hashPassword(seed.password), seed.timeZone, seed.operator],
    );
  }
}

/** Uploads the catalog and creates the seeded subscriptions. False while Kill Bill is unreachable. */
export async function applySeedBilling(services: Services): Promise<boolean> {
  try {
    await services.billing.ensureCatalog(CAIRN_CATALOG_XML);
    for (const seed of SEED_ACCOUNTS) {
      if (seed.addons.length === 0) continue;
      const account = await services.db.one<AccountRow>(
        'select id, email, display_name, password_hash, time_zone, operator from accounts where lower(email) = lower($1)',
        [seed.email],
      );
      if (!account) continue;

      const kbAccountId = await services.billing.ensureAccount({
        accountId: account.id,
        displayName: account.display_name,
        email: account.email,
        timeZone: account.time_zone,
      });
      await services.entitlement.rememberKillBillAccount(account.id, kbAccountId);

      const records = await services.billing.readSubscriptions(kbAccountId);
      for (const addon of seed.addons) {
        if (records[addon].subscribed) continue;
        await services.billing.createSubscription(kbAccountId, account.id, addon);
      }
      await services.entitlement.read(account);
    }
    return true;
  } catch (error) {
    if (error instanceof BillingUnavailableError) return false;
    throw error;
  }
}
