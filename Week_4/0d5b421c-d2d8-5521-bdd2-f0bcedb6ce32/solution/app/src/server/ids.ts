import { randomBytes, randomInt, randomUUID } from "node:crypto";

/** 128 bits of randomness, URL-safe: hold ids, manage tokens and offer tokens. */
export function newToken(): string {
  return randomBytes(16).toString("base64url");
}

export function newId(): string {
  return randomUUID();
}

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** `SS-` followed by six uppercase letters or digits. */
export function newReferenceCandidate(): string {
  let suffix = "";
  for (let index = 0; index < 6; index += 1) suffix += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `SS-${suffix}`;
}
