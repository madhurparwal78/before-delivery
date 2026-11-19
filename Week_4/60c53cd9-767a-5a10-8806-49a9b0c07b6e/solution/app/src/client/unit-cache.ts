/** Reads of GET /api/units/{code}, shared by the lens and the open home so one unit is not fetched twice at once. */
import type { PublicUnit } from "../shared/api-types.js";
import { api, NetworkError } from "./api.js";

type UnitRead =
  | { readonly status: "ok"; readonly unit: PublicUnit; readonly message: null }
  | { readonly status: "gone"; readonly unit: null; readonly message: string }
  | { readonly status: "error"; readonly unit: null; readonly message: string };

interface Entry {
  readonly at: number;
  readonly read: Promise<UnitRead>;
}

const entries = new Map<string, Entry>();
const FRESH_MS = 4_000;

const fetchUnit = async (code: string): Promise<UnitRead> => {
  try {
    const result = await api<{ unit: PublicUnit } | { error: { message: string } }>("GET", `/api/units/${encodeURIComponent(code)}`);
    if (result.ok) return { status: "ok", unit: (result.body as { unit: PublicUnit }).unit, message: null };
    const message = (result.body as { error?: { message: string } } | null)?.error?.message ?? "";
    return result.status === 404 ? { status: "gone", unit: null, message } : { status: "error", unit: null, message };
  } catch (error) {
    if (error instanceof NetworkError) return { status: "error", unit: null, message: "" };
    throw error;
  }
};

/** A read no older than a few seconds, so a signed view link is still good when it is used. */
export const readUnit = (code: string, force = false): Promise<UnitRead> => {
  const existing = entries.get(code);
  if (!force && existing && Date.now() - existing.at < FRESH_MS) return existing.read;
  const read = fetchUnit(code);
  entries.set(code, { at: Date.now(), read });
  return read;
};
