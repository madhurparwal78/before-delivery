import { randomBytes } from "node:crypto";

const ID = /^[A-Za-z0-9_-]{16}$/;

export function newId(): string {
  return randomBytes(12).toString("base64url");
}

export function isId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}
