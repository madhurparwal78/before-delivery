import { validation, fieldMsg } from "../errors";
import { isValidDate, isValidMonth } from "../studiodays";

// Validation limits and messages, exactly as published. Each 422 names the failing
// field with its message.

export function checkTitle(value: unknown): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (v.length < 1 || v.length > 80) throw validation({ title: fieldMsg.title });
  return v;
}

export function checkName(value: unknown): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (v.length < 1 || v.length > 80) throw validation({ name: fieldMsg.name });
  return v;
}

export function checkPassword(value: unknown): string {
  const v = typeof value === "string" ? value : "";
  if (v.length < 10 || v.length > 128) throw validation({ password: fieldMsg.password });
  return v;
}

export function checkHandle(value: unknown): string {
  const v = typeof value === "string" ? value : "";
  if (!/^[a-z0-9-]{3,24}$/.test(v)) throw validation({ handle: fieldMsg.handleFormat });
  return v;
}

export function checkEmail(value: unknown): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw validation({ email: fieldMsg.email });
  return v.toLowerCase();
}

export function checkDimension(fields: string[], body: Record<string, unknown>): number[] {
  const out: number[] = [];
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const raw = body[f];
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    const ok = Number.isFinite(n) && n > 0 && n <= 24 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-9;
    if (!ok) errors[f] = fieldMsg.dimension;
    out.push(n);
  }
  if (Object.keys(errors).length > 0) throw validation(errors);
  return out;
}

export function checkRateField(field: string, value: unknown): number {
  const ok = typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100;
  if (!ok) throw validation({ [field]: fieldMsg.rate });
  return value;
}

export function checkPickupWindow(value: unknown): number {
  const ok = typeof value === "number" && Number.isInteger(value) && value >= 3 && value <= 60;
  if (!ok) throw validation({ pickup_window_days: fieldMsg.pickupWindow });
  return value;
}

export function checkStorageFee(value: unknown): number {
  const ok = typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 500;
  if (!ok) throw validation({ storage_fee_cents: fieldMsg.storageFee });
  return value;
}

export function checkAmountCents(value: unknown): number {
  const ok = typeof value === "number" && Number.isInteger(value) && value !== 0 && value >= -100000 && value <= 100000;
  if (!ok) throw validation({ amount_cents: fieldMsg.amount });
  return value;
}

export function checkReason(value: unknown): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (v.length < 1 || v.length > 200) throw validation({ reason: fieldMsg.reason });
  return v;
}

export function checkEffectiveFrom(value: unknown): string {
  const v = typeof value === "string" ? value : "";
  if (!isValidDate(v)) throw validation({ effective_from: fieldMsg.effectiveFrom });
  return v;
}

export function checkMonth(value: unknown): string {
  const v = typeof value === "string" ? value : "";
  if (!isValidMonth(v)) throw validation({ month: fieldMsg.month });
  return v;
}

export function checkDay(value: unknown): string {
  const v = typeof value === "string" ? value : "";
  if (!isValidDate(v)) throw validation({ date: fieldMsg.day });
  return v;
}

export function checkRole(value: unknown): "kiln_tech" | "member" {
  if (value !== "kiln_tech" && value !== "member") throw validation({ role: fieldMsg.role });
  return value;
}

export function checkMembership(value: unknown): "member" | "drop_off" {
  if (value !== "member" && value !== "drop_off") throw validation({ membership: fieldMsg.role });
  return value;
}
