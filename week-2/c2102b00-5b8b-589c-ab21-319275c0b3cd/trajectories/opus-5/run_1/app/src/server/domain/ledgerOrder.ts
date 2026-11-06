/** The credit-history order: the one place movement paging is decided. */

export interface LedgerCursor {
  createdAt: string;
  id: number;
}

export function encodeCursor(cursor: LedgerCursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): LedgerCursor | null {
  let text: string;
  try {
    text = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const separator = text.lastIndexOf('|');
  if (separator <= 0) return null;
  const createdAt = text.slice(0, separator);
  const id = text.slice(separator + 1);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(createdAt)) return null;
  if (!/^\d+$/.test(id)) return null;
  return { createdAt, id: Number(id) };
}
