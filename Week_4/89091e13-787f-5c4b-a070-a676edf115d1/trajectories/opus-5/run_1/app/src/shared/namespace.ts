export const NAMESPACE_BYTES = 9;
export const NAMESPACE_HEX_LENGTH = 18;
export const PADDING_NAMESPACE = 'fffffffffffffffffe';
export const PARITY_NAMESPACE = 'ffffffffffffffffff';

/** Byte-order comparison of two 18-character namespace hex strings. */
export function compareNamespace(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type NamespaceRefusal =
  | { field: 'hex'; message: string }
  | { field: 'name'; message: string };

export function isReservedNamespace(hex: string): boolean {
  if (hex === PADDING_NAMESPACE || hex === PARITY_NAMESPACE) return true;
  return hex.startsWith('00') && hex.slice(2, 16) === '00000000000000';
}

/** The published namespace validation order; the first failure only. */
export function validateNamespace(rawHex: string, name: string): NamespaceRefusal | null {
  const hex = rawHex.trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(hex)) {
    return { field: 'hex', message: 'Namespace must use only the characters 0-9 and a-f.' };
  }
  if (hex.length !== NAMESPACE_HEX_LENGTH) {
    return {
      field: 'hex',
      message: `Namespace must be 18 hex characters (1 version byte and 8 id bytes); this one has ${hex.length}.`,
    };
  }
  if (hex.slice(0, 2) !== '00') {
    return { field: 'hex', message: 'Only namespace version 00 is open to users.' };
  }
  if (isReservedNamespace(hex)) {
    return { field: 'hex', message: `Namespace ${hex} is reserved.` };
  }
  if (name.trim().length === 0) {
    return { field: 'name', message: 'Give the namespace a name.' };
  }
  return null;
}

/** Validation for a namespace used as a lookup (proofs), where no name is given. */
export function validateNamespaceFormat(rawHex: string): string | null {
  const hex = rawHex.trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(hex)) return 'Namespace must use only the characters 0-9 and a-f.';
  if (hex.length !== NAMESPACE_HEX_LENGTH) {
    return `Namespace must be 18 hex characters (1 version byte and 8 id bytes); this one has ${hex.length}.`;
  }
  return null;
}
