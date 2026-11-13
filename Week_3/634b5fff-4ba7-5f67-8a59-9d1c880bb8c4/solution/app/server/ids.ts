import { randomBytes, randomInt, randomUUID } from "node:crypto";

const REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const newReference = (): string => {
  let suffix = "";
  for (let index = 0; index < 6; index += 1) suffix += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `LB-${suffix}`;
};

export const newToken = (): string => randomBytes(24).toString("base64url");

export const newEventId = (prefix: string): string => `${prefix}_${randomUUID().replaceAll("-", "")}`;
