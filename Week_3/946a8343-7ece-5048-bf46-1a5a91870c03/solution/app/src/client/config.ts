// Page config, read once at load from the server-inlined `<script type="application/json" id="spur-config">`:
//   {"toastMs":5000,"user":{"id","username","time_zone"}|null,"storage":"up"|"down"}
// `config` is a snapshot of the first page load. Anything that can change afterwards (the signed-in user, the storage state)
// lives in its own store: `session.ts` (useUser) and `instance.ts` (useInstance).
import { asNumber, asString, isRecord } from "./util.ts";

export interface SessionUser {
  id: number;
  username: string;
  time_zone: string;
}

interface SpurConfig {
  toastMs: number;
  user: SessionUser | null;
  storage: "up" | "down";
}

export function parseUser(value: unknown): SessionUser | null {
  if (!isRecord(value)) return null;
  const id = asNumber(value.id);
  const username = asString(value.username);
  const zone = asString(value.time_zone);
  if (id === null || username === null) return null;
  return { id, username, time_zone: zone ?? "UTC" };
}

function readConfig(): SpurConfig {
  const element = document.getElementById("spur-config");
  let raw: unknown = null;
  try {
    raw = element?.textContent ? JSON.parse(element.textContent) : null;
  } catch {
    raw = null;
  }
  const data = isRecord(raw) ? raw : {};
  return {
    toastMs: asNumber(data.toastMs) ?? 5000,
    user: parseUser(data.user),
    storage: data.storage === "down" ? "down" : "up",
  };
}

export const config: SpurConfig = readConfig();
