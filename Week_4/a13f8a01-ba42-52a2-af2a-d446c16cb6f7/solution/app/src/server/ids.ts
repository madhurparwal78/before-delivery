import { randomBytes, randomInt } from "node:crypto";

const ALPHABET = Array.from({ length: 36 }, (_, digit) => digit.toString(36)).join("");

/** Pens and collections share one opaque 10-character id. */
export const ID_SHAPE = /^[a-z0-9]{10}$/;

export function newId(length = 10): string {
  let id = "";
  for (let i = 0; i < length; i++) id += ALPHABET[randomInt(ALPHABET.length)];
  return id;
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}
