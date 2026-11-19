import { one, type Tx } from "./db.js";

// Gapless per-year numbers shared by every instance on the database: the row lock serialises takers and
// a rolled-back transaction gives its number back.

const FORMATS = {
  invoice: (year: number, n: number) => `PY-${year}-${String(n).padStart(6, "0")}`,
  credit_note: (year: number, n: number) => `PY-CN-${year}-${String(n).padStart(6, "0")}`,
};

export async function nextNumber(client: Tx, kind: keyof typeof FORMATS, year: number): Promise<string> {
  const row = await one<{ last: number }>(
    client,
    `INSERT INTO number_sequences (kind, year, last) VALUES ($1, $2, 1)
     ON CONFLICT (kind, year) DO UPDATE SET last = number_sequences.last + 1 RETURNING last`,
    [kind, year],
  );
  return FORMATS[kind](year, row?.last ?? 1);
}
