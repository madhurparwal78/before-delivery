import { randomBytes } from "node:crypto";

let lastMs = 0;
let counter = 0;

/** A URL-safe unique id that sorts in creation order, so same-millisecond records keep their order. */
export function newId(): string {
  const now = Date.now();
  counter = now === lastMs ? counter + 1 : 0;
  lastMs = now;
  return `${now.toString(16).padStart(12, "0")}${counter.toString(16).padStart(4, "0")}${randomBytes(6).toString("hex")}`;
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}
