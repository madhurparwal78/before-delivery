import { get } from "./api";
import type { Me } from "./types";

let current: Me | null = null;

// The signed-in player for this page load (null without a session).
export async function loadMe(): Promise<Me | null> {
  const result = await get<Me>("/v1/me");
  current = result.status === 200 ? result.data : null;
  return current;
}

export function me(): Me | null {
  return current;
}

export function setMe(value: Me | null): void {
  current = value;
}
