import type { Account } from "../../shared/types";
import { COPY } from "../../shared/messages";
import { api, Unreachable } from "../lib/api";
import { navigate, currentLocation, safeNext } from "../lib/router";
import { app, emptyServerCopy } from "./model";
import {
  broadcast,
  busIn,
  explicitlySignedOut,
  LS_ACTIVE,
  LS_SIGNED_OUT,
  loadAccount,
  lsExpired,
  reloadTouched,
  readActiveAccount,
} from "./persist";
import { refreshDevice } from "./refresh";
import { requestSync, startSyncLoop } from "./sync";

async function activate(account: Account, offline: boolean, landOn?: string): Promise<void> {
  const { server, journal } = await loadAccount(account.id);
  if (landOn) navigate(landOn, { replace: true });
  app.set({
    account,
    auth: "in",
    server,
    journal,
    deviceLoaded: true,
    expired: window.localStorage.getItem(lsExpired(account.id)) === "1" && journal.length > 0,
    reachable: !offline,
  });
  if (!offline) {
    void refreshDevice();
    void requestSync();
  }
}

function leave(): void {
  app.set({ account: null, auth: "out", server: emptyServerCopy(), journal: [], expired: false, syncSentences: [], notice: null });
}

export async function boot(): Promise<void> {
  startSyncLoop();
  window.addEventListener("storage", (event) => {
    if (event.key === LS_ACTIVE || event.key === LS_SIGNED_OUT) void followAccountChange();
  });
  busIn.on((message) => {
    if (message.t === "account") void followAccountChange();
    if (message.t === "expired" && message.account === app.get().account?.id) app.set({ expired: true });
    if (message.t === "data" && message.account === app.get().account?.id) void reloadTouched(message.account, message.touched);
  });
  const active = readActiveAccount();
  const out = explicitlySignedOut();
  try {
    const answer = await api<{ account?: Account }>("GET", "/api/auth/me");
    if (answer.status === 200 && answer.body.account) {
      const account = answer.body.account;
      window.localStorage.setItem(LS_ACTIVE, JSON.stringify(account));
      window.localStorage.removeItem(LS_SIGNED_OUT);
      window.localStorage.removeItem(lsExpired(account.id));
      await activate(account, false);
    } else if (active && !out) {
      const { journal } = await loadAccount(active.id);
      if (journal.length > 0) {
        window.localStorage.setItem(lsExpired(active.id), "1");
        await activate(active, false);
        app.set({ expired: true });
      } else leave();
    } else leave();
  } catch (error) {
    if (!(error instanceof Unreachable)) throw error;
    if (active && !out) await activate(active, true);
    else leave();
  }
  app.set({ phase: "ready" });
}

/** Follows a sign-out or sign-in made in another tab of this browser. */
async function followAccountChange(): Promise<void> {
  const state = app.get();
  if (explicitlySignedOut()) {
    if (state.account) {
      leave();
      navigate("/");
    }
    return;
  }
  const active = readActiveAccount();
  if (active && active.id !== state.account?.id) {
    await activate(active, !navigator.onLine);
    navigate("/tonight");
  }
}

type AuthOutcome =
  | { ok: true }
  | { ok: false; status: number; body: { error?: string; fields?: Record<string, string> } }
  | { ok: false; status: 0; body: { error: "unreachable" } };

async function enter(path: string, payload: Record<string, string>, next: string): Promise<AuthOutcome> {
  let outcome: AuthOutcome = { ok: false, status: 0, body: { error: "unreachable" } };
  await navigator.locks.request("lowlamp-account", async () => {
    try {
      const answer = await api<{ account?: Account; error?: string; fields?: Record<string, string> }>("POST", path, payload);
      if ((answer.status === 200 || answer.status === 201) && answer.body.account) {
        const account = answer.body.account;
        window.localStorage.setItem(LS_ACTIVE, JSON.stringify(account));
        window.localStorage.removeItem(LS_SIGNED_OUT);
        window.localStorage.removeItem(lsExpired(account.id));
        await activate(account, false, next);
        broadcast({ t: "account" });
        outcome = { ok: true };
      } else {
        outcome = { ok: false, status: answer.status, body: answer.body };
      }
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
    }
  });
  return outcome;
}

export function signIn(email: string, password: string): Promise<AuthOutcome> {
  const next = safeNext(new URLSearchParams(currentLocation().search).get("next"));
  return enter("/api/auth/signin", { email, password }, next);
}

export function signUp(email: string, password: string, displayName: string): Promise<AuthOutcome> {
  return enter("/api/auth/signup", { email, password, display_name: displayName }, "/kit");
}

export async function signOut(): Promise<void> {
  await navigator.locks.request("lowlamp-account", async () => {
    try {
      const answer = await api("POST", "/api/auth/signout", {});
      if (answer.status !== 204 && answer.status !== 200 && answer.status !== 401) {
        app.set({ notice: COPY.serverError });
        return;
      }
      window.localStorage.setItem(LS_SIGNED_OUT, "1");
      leave();
      broadcast({ t: "account" });
      navigate("/");
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      app.set({ notice: COPY.needsSignal });
    }
  });
}
