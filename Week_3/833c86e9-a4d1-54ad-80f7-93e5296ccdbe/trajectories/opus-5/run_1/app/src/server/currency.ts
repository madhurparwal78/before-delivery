import { CURS, Cur, CurrencyTable } from '../shared/types';
import { one, query } from './db';

const DEFAULTS: CurrencyTable = { EUR: 1000000, USD: 1080000, JPY: 161500000, KWD: 332000 };

export async function currencyTable(): Promise<CurrencyTable> {
  const row = await one<{ value: CurrencyTable }>(`select value from settings where key = 'currency'`, []);
  return row ? row.value : DEFAULTS;
}

export async function setCurrencyTable(table: CurrencyTable): Promise<void> {
  await query(
    `insert into settings (key, value) values ('currency', $1)
     on conflict (key) do update set value = excluded.value`,
    [JSON.stringify(table)],
  );
}

export function validCurrencyTable(input: unknown): CurrencyTable | null {
  if (typeof input !== 'object' || input === null) return null;
  const record = input as Record<string, unknown>;
  const out: Partial<CurrencyTable> = {};
  for (const code of CURS) {
    const value = record[code];
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
    out[code] = value;
  }
  return out as CurrencyTable;
}

export function isCurrency(value: unknown): value is Cur {
  return typeof value === 'string' && (CURS as string[]).includes(value);
}
