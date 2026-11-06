import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function code(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export const newBookingRef = (): string => `HB-${code(6)}`;
export const newGiftRef = (): string => `HG-${code(6)}`;
export const newEnquiryRef = (): string => `EQ-${code(6)}`;
export const newTicketCode = (): string => `T-${code(8)}`;
export const newHoldId = (): string => randomUUID();

/** Capability token: 43 base64url characters from 32 random bytes. */
export const newToken = (): string => randomBytes(32).toString("base64url");

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export const newStepupCode = (): string => String(randomInt(1_000_000)).padStart(6, "0");
