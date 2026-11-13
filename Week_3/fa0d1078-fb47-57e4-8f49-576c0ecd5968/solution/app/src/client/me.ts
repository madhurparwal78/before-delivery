import type { Player } from "../shared/protocol";
import { ApiFailure, get, post } from "./api";
import { Store, useStore } from "./store";

/** The signed-in player: undefined until the first answer, null when signed out. */
const me = new Store<Player | null | undefined>(undefined);

export const useMe = (): Player | null | undefined => useStore(me);

export function setMe(player: Player | null): void {
  me.set(player);
}

export async function loadMe(): Promise<void> {
  try {
    me.set((await get<{ player: Player }>("/api/me")).player);
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 401) me.set(null);
    else throw error;
  }
}

export async function signOut(): Promise<void> {
  await post("/api/auth/signout");
  me.set(null);
}
