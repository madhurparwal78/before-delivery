import type { Me } from "../shared/types";
import { get } from "./api";
import { startLive } from "./live";
import { setApp } from "./store";

export const homeFor = (me: Me): string => (me.user.role === "owner" ? "/home" : "/today");

/** Asks the server who is signed in, then opens the live channel for that role. */
export async function loadSession(): Promise<Me | null> {
  const answer = await get<Me>("/api/me");
  const me = answer.ok ? answer.data : null;
  setApp({ me });
  if (me) startLive(me.user.role, me.user.id);
  return me;
}
