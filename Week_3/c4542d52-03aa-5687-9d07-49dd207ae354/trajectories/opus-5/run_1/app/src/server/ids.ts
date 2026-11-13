import type { Transaction } from "./db.js";

async function nextNumber(tx: Transaction, sequence: string): Promise<number> {
  const row = await tx.queryOne<{ value: string }>(`select nextval('${sequence}') as value`);
  if (row === null) throw new Error(`sequence ${sequence} produced no value`);
  return Number(row.value);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export async function nextGrantId(tx: Transaction): Promise<string> {
  return `TC-OPT-${pad(await nextNumber(tx, "grant_number"), 4)}`;
}

export async function nextOrderId(tx: Transaction): Promise<string> {
  return `EXO-${pad(await nextNumber(tx, "order_number"), 6)}`;
}

export async function nextTenderId(tx: Transaction): Promise<string> {
  return `TND-${pad(await nextNumber(tx, "tender_number"), 3)}`;
}

export async function nextDocumentId(tx: Transaction): Promise<string> {
  return `DOC-${pad(await nextNumber(tx, "document_number"), 6)}`;
}

export async function nextLedgerId(tx: Transaction): Promise<string> {
  return `LED-${pad(await nextNumber(tx, "ledger_number"), 6)}`;
}

export async function nextPersonId(tx: Transaction): Promise<string> {
  return `PER-${pad(await nextNumber(tx, "person_number"), 3)}`;
}

export async function nextValuationId(tx: Transaction): Promise<string> {
  return `VAL-${pad(await nextNumber(tx, "valuation_number"), 2)}`;
}

export async function nextScenarioId(tx: Transaction): Promise<string> {
  return `SCN-${pad(await nextNumber(tx, "scenario_number"), 3)}`;
}
