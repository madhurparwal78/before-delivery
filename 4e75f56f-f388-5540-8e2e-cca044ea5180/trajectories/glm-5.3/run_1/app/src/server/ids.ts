import { randomBytes } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("hex").slice(0, 20)}`;
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export function randomSuffix(): string {
  return randomBytes(8).toString("hex");
}

export function randomId(): string {
  return randomBytes(12).toString("hex");
}
