/** Namespaces are 9 bytes (version byte then 8 id bytes) written as 18 lowercase hex characters. */
const NAMESPACE_HEX_LENGTH = 18;
export const PARITY_NAMESPACE = "ffffffffffffffffff";
export const TAIL_PADDING_NAMESPACE = "fffffffffffffffffe";

type NamespaceCheck = { hex: string } | { error: string };

/** The published checks 1-4 in their published order, first failure only. */
export function checkNamespaceHex(input: string): NamespaceCheck {
  const hex = input.toLowerCase();
  if (!/^[0-9a-f]*$/.test(hex)) return { error: "Namespace must use only the characters 0-9 and a-f." };
  if (hex.length !== NAMESPACE_HEX_LENGTH) {
    return { error: `Namespace must be 18 hex characters (1 version byte and 8 id bytes); this one has ${hex.length}.` };
  }
  if (!hex.startsWith("00")) return { error: "Only namespace version 00 is open to users." };
  if (parseInt(hex.slice(2), 16) <= 0xff) return { error: `Namespace ${hex} is reserved.` };
  return { hex };
}
