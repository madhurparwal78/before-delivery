// Today: opens today's daily note, creating it if needed.

import { api, type ObjectJson } from "./api.js";
import { openObjectScreen } from "./object.js";

export async function openToday(reveal: boolean): Promise<void> {
  try {
    const res = await api<{ date: string; object: ObjectJson }>("POST", "/api/daily/today");
    openObjectScreen(res.object.id, reveal);
  } catch {
    // unreachable in the seeded workspace
  }
}
