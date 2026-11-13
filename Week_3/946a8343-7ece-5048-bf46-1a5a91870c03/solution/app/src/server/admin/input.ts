// Reading request bodies without trusting their shape.
import { isRecord } from "../json.ts";

export type Body = Readonly<Record<string, unknown>>;

export function bodyOf(value: unknown): Body {
  return isRecord(value) ? value : {};
}

export function text(body: Body, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

export function flag(body: Body, key: string): boolean | undefined {
  const value = body[key];
  return typeof value === "boolean" ? value : undefined;
}

export function whole(body: Body, key: string): number | undefined {
  const value = body[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export function strings(body: Body, key: string): string[] | undefined {
  const value = body[key];
  if (!Array.isArray(value)) return undefined;
  return value.every((item): item is string => typeof item === "string") ? [...value] : undefined;
}
