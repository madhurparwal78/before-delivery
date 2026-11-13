import type { AddressFields } from "../shared/api";
import { FIELD } from "./errors";

const STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh",
  "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha",
  "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh",
  "Lakshadweep", "Puducherry",
];

export type Fields = Record<string, string>;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function checkEmail(value: unknown, fields: Fields, key = "email"): string {
  const email = text(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) fields[key] = FIELD.email;
  return email;
}

export function checkPhone(value: unknown, fields: Fields, key = "phone"): string {
  const phone = text(value);
  if (!/^\d{10}$/.test(phone)) fields[key] = FIELD.phone;
  return phone;
}

/** A delivery address; error keys are prefixed (`address.line1`) unless `prefix` is empty. */
export function checkAddress(value: unknown, fields: Fields, prefix: string): AddressFields {
  const input = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const key = (name: string) => (prefix ? `${prefix}.${name}` : name);
  const name = text(input.name);
  const line1 = text(input.line1);
  const line2 = typeof input.line2 === "string" ? input.line2.trim() : "";
  const city = text(input.city);
  const state = text(input.state);
  const postcode = text(input.postcode);
  if (!name || name.length > 100) fields[key("name")] = FIELD.name;
  if (!line1 || line1.length > 100) fields[key("line1")] = FIELD.line1;
  if (line2.length > 100) fields[key("line2")] = FIELD.line2;
  if (!city || city.length > 100) fields[key("city")] = FIELD.city;
  if (!STATES.includes(state)) fields[key("state")] = FIELD.state;
  if (!/^\d{6}$/.test(postcode)) fields[key("postcode")] = FIELD.postcode;
  const phone = checkPhone(input.phone, fields, key("phone"));
  return { name, line1, line2, city, state, postcode, phone };
}

export function checkLabel(value: unknown, fields: Fields): string {
  const label = text(value);
  if (label.length < 1 || label.length > 30) fields.label = FIELD.label;
  return label;
}

interface CardInput {
  number: string;
  expiry: string;
  cvc: string;
}

/** Card details; the expiry must be a month not earlier than the current month on server time. */
export function checkCard(value: unknown, fields: Fields, now: Date): CardInput {
  const input = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const number = typeof input.number === "string" ? input.number.replace(/\s+/g, "") : "";
  const expiry = text(input.expiry);
  const cvc = text(input.cvc);
  if (!/^\d{16}$/.test(number)) fields["card.number"] = FIELD.cardNumber;
  const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(expiry);
  const year = match ? 2000 + Number(match[2]) : 0;
  const month = match ? Number(match[1]) : 0;
  if (!match || year < now.getUTCFullYear() || (year === now.getUTCFullYear() && month < now.getUTCMonth() + 1)) fields["card.expiry"] = FIELD.cardExpiry;
  if (!/^\d{3}$/.test(cvc)) fields["card.cvc"] = FIELD.cardCvc;
  return { number, expiry, cvc };
}

export function isIdempotencyKey(value: string | null): value is string {
  return value !== null && value.length >= 8 && value.length <= 128;
}
