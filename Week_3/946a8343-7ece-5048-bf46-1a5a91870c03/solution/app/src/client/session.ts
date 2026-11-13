// Signed-in user store, seeded from the page config. `useUser()` re-renders when the user signs in, signs out or changes the
// profile time zone. `setUser` is called by the auth pages, the account menu and the API layer (on 401).
import { config, type SessionUser } from "./config.ts";
import { createStore, useStore } from "./store.ts";

const userStore = createStore<SessionUser | null>(config.user);

export function setUser(user: SessionUser | null): void {
  userStore.set(user);
}

export function useUser(): SessionUser | null {
  return useStore(userStore);
}
