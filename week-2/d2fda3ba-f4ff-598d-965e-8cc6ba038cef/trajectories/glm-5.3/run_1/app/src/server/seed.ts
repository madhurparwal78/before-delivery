import { q } from './db';
import { hashPassword } from './crypt';
import { kb } from './killbill';
import { setSubscription } from './billing';

interface SeedAccount {
  email: string; password: string; displayName: string; timeZone: string; operator: boolean;
  addons: Array<'sync' | 'publish'>;
}

const SEED_ACCOUNTS: SeedAccount[] = [
  { email: 'ops@tidewrack.example', password: 'cairn-ops-7731-dev', displayName: 'Tidewrack Ops', timeZone: 'Europe/Lisbon', operator: true, addons: [] },
  { email: 'ines.marlow@casefile.example', password: 'field-notes-4418', displayName: 'Ines Marlow', timeZone: 'Europe/Lisbon', operator: false, addons: ['sync', 'publish'] },
  { email: 'tomasz.reyes@casefile.example', password: 'co-edit-2290', displayName: 'Tomasz Reyes', timeZone: 'America/Bogota', operator: false, addons: [] },
  { email: 'hana.okoye@ledgerdesk.example', password: 'other-case-6603', displayName: 'Hana Okoye', timeZone: 'Asia/Singapore', operator: false, addons: ['sync'] },
];

/** Creates the missing seed accounts and records which add-ons they carry. */
export const seed = async (): Promise<void> => {
  for (const s of SEED_ACCOUNTS) {
    const existing = await q<{ id: string }>('select id from accounts where email = $1', [s.email]);
    let id = existing.rows[0]?.id;
    if (!id) {
      const passwordHash = await hashPassword(s.password);
      const inserted = await q<{ id: string }>(
        'insert into accounts(email, password_hash, display_name, time_zone, operator) values ($1, $2, $3, $4, $5) on conflict (email) do nothing returning id',
        [s.email, passwordHash, s.displayName, s.timeZone, s.operator],
      );
      id = inserted.rows[0]?.id;
    }
    if (!id) continue;
    for (const addon of s.addons) {
      await q('insert into seed_addons(account_id, addon) values ($1, $2) on conflict do nothing', [id, addon]);
    }
  }
  await syncSeededAddons();
};

/** Makes sure every seeded add-on has its Kill Bill subscription; safe to run on every sweep. */
export const syncSeededAddons = async (): Promise<void> => {
  const rows = await q<{ account_id: string; addon: 'sync' | 'publish' }>(
    'select account_id, addon from seed_addons',
  );
  for (const row of rows.rows) {
    const info = await q<{ display_name: string; email: string; time_zone: string }>(
      'select display_name, email, time_zone from accounts where id = $1', [row.account_id],
    );
    const account = info.rows[0];
    if (!account) continue;
    const sub = await kb.getSubscriptionByExternalKey(row.account_id, row.addon);
    if (!sub.ok || sub.value.subscription_id) continue;
    try {
      await setSubscription(row.account_id, row.addon, true, account);
    } catch {
      // Kill Bill down: the next sweep retries
    }
  }
};
