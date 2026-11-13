import type { Request } from "express";

/** Route params can be string or string[] under Express 5 typings; collapse safely. */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (Array.isArray(value)) return value.join("/");
  return value ?? "";
}

/** Query values can be string, string[] or undefined; collapse safely. */
export function query(req: Request, name: string): string | null {
  const value = req.query[name];
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : null;
  }
  return typeof value === "string" ? value : null;
}
