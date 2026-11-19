/** Time-ordered identifiers: the ids of rows created in one process increase in creation order. */
import { randomBytes } from "node:crypto";
import { businessNow } from "./clock.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let lastMillis = 0;
let sequence = 0;

export function newId(): string {
  const millis = businessNow().getTime();
  if (millis > lastMillis) {
    lastMillis = millis;
    sequence = 0;
  } else {
    sequence += 1;
  }
  const bytes = randomBytes(16);
  bytes.writeUIntBE(lastMillis, 0, 6);
  bytes[6] = 0x70 | ((sequence >> 8) & 0x0f);
  bytes[7] = sequence & 0xff;
  bytes[8] = (bytes[8] ?? 0) & 0x3f | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
