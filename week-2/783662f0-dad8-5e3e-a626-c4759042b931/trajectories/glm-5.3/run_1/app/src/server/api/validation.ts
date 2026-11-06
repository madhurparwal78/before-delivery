/** Field validation with the published copy, and the unknown-field rule. */

import { FieldCopy } from "../../shared/copy.js";

export interface FieldRule {
  required: boolean;
  maxLength?: number;
  minLength?: number;
  pattern?: RegExp;
  patternMessage?: string;
}

export type FieldMessages = { [field: string]: string };

export function validateHandle(value: string | undefined): string | undefined {
  const handle = value ?? "";
  if (handle.trim() === "") return FieldCopy.handle.required;
  if (handle.length > 24) return FieldCopy.handle.tooLong;
  if (!/^[a-z0-9-]{3,24}$/.test(handle)) return FieldCopy.handle.format;
  return undefined;
}

export function validatePasscode(value: string | undefined, join: boolean): string | undefined {
  const passcode = value ?? "";
  if (passcode.trim() === "") return FieldCopy.passcode.required;
  if (passcode.length > 64) return FieldCopy.passcode.tooLong;
  if (join && passcode.length < 8) return FieldCopy.passcode.tooShort;
  return undefined;
}

export function validateDisplayName(value: string | undefined): string | undefined {
  const name = value ?? "";
  if (name.trim() === "") return FieldCopy.displayName.required;
  if (name.length > 40) return FieldCopy.displayName.tooLong;
  return undefined;
}

export function validateEmail(value: string | undefined): string | undefined {
  const email = value ?? "";
  if (email.trim() === "") return FieldCopy.email.required;
  if (email.length > 254) return FieldCopy.email.tooLong;
  const at = email.split("@");
  if (at.length !== 2) return FieldCopy.email.format;
  const [local, domain] = at;
  if (local === undefined || domain === undefined || local.length === 0) return FieldCopy.email.format;
  if (local.length > 64) return FieldCopy.email.tooLong;
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return FieldCopy.email.format;
  return undefined;
}

export function validateServerName(value: string | undefined): string | undefined {
  const name = (value ?? "").trim();
  if (name === "") return FieldCopy.serverName.required;
  if (name.length > 40) return FieldCopy.serverName.tooLong;
  if (!/^[A-Za-z0-9 -]{3,40}$/.test(name)) return FieldCopy.serverName.format;
  return undefined;
}

export function validateCharacterName(value: string | undefined): string | undefined {
  const name = (value ?? "").trim();
  if (name === "") return FieldCopy.characterName.required;
  if (name.length > 20) return FieldCopy.characterName.tooLong;
  if (!/^[A-Za-z0-9 -]{2,20}$/.test(name)) return FieldCopy.characterName.tooShort;
  return undefined;
}

export function validateWorldName(value: string | undefined): string | undefined {
  const name = (value ?? "").trim();
  if (name === "") return FieldCopy.worldName.required;
  if (name.length > 40) return FieldCopy.worldName.tooLong;
  return undefined;
}

export function validatePartyName(value: string | undefined): string | undefined {
  const name = (value ?? "").trim();
  if (name === "") return FieldCopy.partyName.required;
  if (name.length > 30) return FieldCopy.partyName.tooLong;
  return undefined;
}

export function validateMessage(value: string | undefined): string | undefined {
  const text = (value ?? "").trim();
  if (text === "") return FieldCopy.message.required;
  if (text.length > 280) return FieldCopy.message.tooLong;
  return undefined;
}

export function validateStake(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return FieldCopy.stake;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100) return FieldCopy.stake;
  return undefined;
}

export function validateTurnSeconds(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return FieldCopy.turnSeconds;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 5 || n > 120) return FieldCopy.turnSeconds;
  return undefined;
}

export function validateTimeZone(value: unknown, allowed: string[]): string | undefined {
  if (typeof value !== "string" || !allowed.includes(value)) return FieldCopy.timeZone;
  return undefined;
}

export function validateCoinsToOffer(value: unknown, available: number): string | undefined {
  if (value === undefined || value === null || value === "") return FieldCopy.coinsToOffer(available);
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > available) return FieldCopy.coinsToOffer(available);
  return undefined;
}

export function validateItemCount(value: unknown, count: number): string | undefined {
  if (value === undefined || value === null || value === "") return FieldCopy.itemToOffer(count);
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > count) return FieldCopy.itemToOffer(count);
  return undefined;
}

export function validateIdempotencyKey(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return FieldCopy.idempotencyKey;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) return FieldCopy.idempotencyKey;
  return undefined;
}

export const UnknownField = FieldCopy.unknown;
