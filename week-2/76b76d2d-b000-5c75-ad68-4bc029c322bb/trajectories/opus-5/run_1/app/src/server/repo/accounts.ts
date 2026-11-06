import type { Locale } from '../../shared/money.ts';
import { one, query } from '../db/pool.ts';
import { createAccount } from '../killbill/client.ts';

export type BillingAccount = { external_key: string; kb_account_id: string; name: string; email: string };

async function remember(externalKey: string, kbAccountId: string, name: string, email: string): Promise<void> {
  await query(
    `insert into kb_accounts(external_key, kb_account_id, name, email) values($1,$2,$3,$4)
       on conflict (external_key) do update set kb_account_id = excluded.kb_account_id`,
    [externalKey, kbAccountId, name, email],
  );
}

export async function ensurePatronBillingAccount(account: {
  id: number;
  number: string | null;
  name: string;
  email: string;
  locale: Locale;
  kb_account_id: string | null;
}): Promise<string> {
  if (account.kb_account_id !== null) return account.kb_account_id;
  const externalKey = account.number ?? `account-${account.id}`;
  const kbAccountId = await createAccount({
    externalKey,
    name: account.name,
    email: account.email,
    locale: account.locale,
  });
  await query('update accounts set kb_account_id = $2 where id = $1', [account.id, kbAccountId]);
  await remember(externalKey, kbAccountId, account.name, account.email);
  return kbAccountId;
}

export async function ensureGuestBillingAccount(input: {
  name: string;
  email: string;
  locale: Locale;
}): Promise<string> {
  const externalKey = `guest-${input.email.toLowerCase()}`;
  const existing = await one<{ kb_account_id: string }>(
    'select kb_account_id from kb_accounts where external_key = $1',
    [externalKey],
  );
  if (existing !== null) return existing.kb_account_id;
  const kbAccountId = await createAccount({
    externalKey,
    name: input.name,
    email: input.email,
    locale: input.locale,
  });
  await remember(externalKey, kbAccountId, input.name, input.email);
  return kbAccountId;
}

export async function allBillingAccounts(): Promise<BillingAccount[]> {
  return query<BillingAccount>('select external_key, kb_account_id, name, email from kb_accounts');
}

export async function nextAccountNumber(): Promise<string> {
  const row = await one<{ value: number }>(
    `insert into counters(name, value) values('account_number', 100001)
       on conflict (name) do update set value = counters.value + 1 returning value`,
  );
  return `A-${String(row?.value ?? 100001).padStart(6, '0')}`;
}

export async function accountByNumber(number: string): Promise<{
  id: number;
  number: string;
  name: string;
  email: string;
  locale: Locale;
  role: string;
  kb_account_id: string | null;
} | null> {
  return one(
    'select id, number, name, email, locale, role, kb_account_id from accounts where upper(number) = upper($1)',
    [number],
  );
}
