import { app } from "./model";
import { broadcast, lsExpired } from "./persist";

/**
 * A request answered 401. With changes waiting the device keeps its copy and offers Sign in;
 * with none, the visitor goes to the sign-in route.
 */
export function handleUnauthorized(): void {
  const state = app.get();
  const account = state.account;
  if (!account) return;
  if (state.journal.length > 0) {
    window.localStorage.setItem(lsExpired(account.id), "1");
    app.set({ expired: true });
    broadcast({ t: "expired", account: account.id });
  } else {
    app.set({ auth: "out" });
  }
}
