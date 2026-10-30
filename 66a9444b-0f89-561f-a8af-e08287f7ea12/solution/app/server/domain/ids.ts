// Order refs, pass codes and voucher codes draw from A–Z and 2–9.
import { randomInt, randomUUID } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789";

function code(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export const newId = () => randomUUID();
export const newOrderRef = () => `KF-${code(6)}`;
export const newPassCode = () => `KFP-${code(10)}`;
export const newVoucherCode = () => `KERF-${code(8)}`;
