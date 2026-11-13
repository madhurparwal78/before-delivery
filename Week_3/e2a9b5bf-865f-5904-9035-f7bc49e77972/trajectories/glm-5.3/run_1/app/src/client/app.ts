// Application state, routing and cross-tab coordination (DP-70, DP-90, DP-91).
import { loadState, saveState, freshState, type SavedState, type JournalEntry } from "./store.js";
import type { Account, Kit, ObjectHistory, Packet, ProgramSummary, SessionWithObservations, Site, SyncChange, SyncResult } from "../shared/api.js";
import { safeNextPath } from "../shared/nextpath.js";
import { apiGet, apiPost, networkState } from "./api.js";
import { renderConnection } from "./pages/shell.js";
import { renderApp } from "./pages/router.js";

export const app = {
  state: loadState(),
  account: null as Account | null,
  online: navigator.onLine,
  syncRunning: false,
  // Set when a sync answered 401 with changes waiting (DP-67).
  syncRefused: false,
  route: window.location.pathname + window.location.search,
  lastRefreshAt: 0,
};

export type Screen =
  | { name: "landing" }
  | { name: "signup" }
  | { name: "signin"; next: string }
  | { name: "notfound" }
  | { name: "tonight" }
  | { name: "session"; sessionId: string; observationId: string | null }
  | { name: "objectHistory"; objectId: string }
  | { name: "programs" }
  | { name: "program"; programId: string }
  | { name: "packet"; packetId: string }
  | { name: "kit" };

const ROUTES: readonly { pattern: RegExp; build: (match: RegExpMatchArray) => Screen }[] = [
  { pattern: /^\/$/, build: () => ({ name: "landing" }) },
  { pattern: /^\/signup$/, build: () => ({ name: "signup" }) },
  { pattern: /^\/signin$/, build: (m) => ({ name: "signin", next: safeNextPath(new URLSearchParams(m.input?.split("?")[1] ?? "").get("next")) }) },
  { pattern: /^\/tonight$/, build: () => ({ name: "tonight" }) },
  { pattern: /^\/sessions\/([^/?]+)$/, build: (m) => ({ name: "session", sessionId: m[1]!, observationId: null }) },
  { pattern: /^\/sessions\/([^/?]+)\?observation=([^&]+)$/, build: (m) => ({ name: "session", sessionId: m[1]!, observationId: m[2]! }) },
  { pattern: /^\/objects\/([^/?]+)$/, build: (m) => ({ name: "objectHistory", objectId: m[1]! }) },
  { pattern: /^\/programs$/, build: () => ({ name: "programs" }) },
  { pattern: /^\/programs\/([^/?]+)$/, build: (m) => ({ name: "program", programId: m[1]! }) },
  { pattern: /^\/packets\/([^/?]+)$/, build: (m) => ({ name: "packet", packetId: m[1]! }) },
  { pattern: /^\/kit$/, build: () => ({ name: "kit" }) },
];

export function parseRoute(pathAndQuery: string): Screen {
  const [path, query] = pathAndQuery.split("?");
  for (const route of ROUTES) {
    const candidate: string = query !== undefined ? `${path}?${query}` : (path ?? "");
    const match = candidate.match(route.pattern) ?? (path ?? "").match(route.pattern);
    if (match) {
      if (route.pattern.source.startsWith("^\\/sessions\\/") && query) {
        const params = new URLSearchParams(query);
        const observation = params.get("observation");
        if (observation) return { name: "session", sessionId: match[1]!, observationId: observation };
        return { name: "session", sessionId: match[1]!, observationId: null };
      }
      return route.build(match);
    }
  }
  return { name: "notfound" };
}

export function navigate(pathAndQuery: string, replace = false): void {
  if (replace) {
    window.history.replaceState({}, "", pathAndQuery);
  } else {
    window.history.pushState({}, "", pathAndQuery);
  }
  app.route = pathAndQuery;
  broadcast({ type: "route", path: pathAndQuery });
  renderApp();
}

export function currentPathAndQuery(): string {
  return window.location.pathname + window.location.search;
}

// ---- cross-tab coordination ----------------------------------------------

export type BroadcastMessage =
  | { type: "route"; path: string }
  | { type: "journal"; accountId: string }
  | { type: "account"; accountId: string | null; email: string | null }
  | { type: "sync-results"; accountId: string; results: SyncResult[] }
  | { type: "device-name"; name: string };

const CHANNEL = "lowlamp-tabs";

export function broadcast(message: BroadcastMessage): void {
  try {
    localStorage.setItem("lowlamp-broadcast", JSON.stringify({ ...message, nonce: Math.random() }));
  } catch {
    // Storage unavailable: single tab still works.
  }
}

export function listenForBroadcasts(): void {
  window.addEventListener("storage", (event) => {
    if (event.key !== "lowlamp-broadcast" || !event.newValue) return;
    let message: BroadcastMessage & { nonce?: number };
    try {
      message = JSON.parse(event.newValue);
    } catch {
      return;
    }
    if (message.type === "route") {
      app.route = message.path;
      renderApp();
    } else if (message.type === "journal" || message.type === "sync-results") {
      app.state = loadState();
      if (message.type === "sync-results" && message.accountId === app.state.signedInAccountId) {
        renderApp(message.results);
      } else {
        renderApp();
      }
    } else if (message.type === "account") {
      app.state = loadState();
      app.account = null;
      if (message.accountId) {
        void resumeSession(message.accountId).then(() => renderApp());
      } else {
        renderApp();
      }
    } else if (message.type === "device-name") {
      app.state = loadState();
      renderApp();
    }
  });
}

export async function resumeSession(accountId: string): Promise<void> {
  try {
    const me = await apiGet.me();
    app.account = me.account;
    app.state.signedInAccountId = me.account.id;
    app.state.accountEmail = me.account.email;
    app.state.lastSignedInEmail = me.account.email;
    saveState(app.state);
  } catch {
    app.account = null;
    app.state.signedInAccountId = null;
    saveState(app.state);
  }
  void accountId;
}

// ---- sign-in and sign-out -------------------------------------------------

export async function signIn(email: string, password: string): Promise<Account> {
  const result = await apiPost.signin({ email, password });
  app.account = result.account;
  app.state.signedInAccountId = result.account.id;
  app.state.accountEmail = result.account.email;
  app.state.lastSignedInEmail = result.account.email;
  saveState(app.state);
  broadcast({ type: "account", accountId: result.account.id, email: result.account.email });
  return result.account;
}

export async function signOutNow(): Promise<void> {
  const waiting = app.state.signedInAccountId ? journalLength(app.state.signedInAccountId) : 0;
  try {
    await apiPost.signout();
  } catch (error) {
    if (waiting > 0) {
      // A sign-out action with no network and changes waiting shows the
      // needs-signal sentence and signs nothing out.
      throw new Error("needs-signal");
    }
  }
  app.account = null;
  const hadAccount = app.state.signedInAccountId;
  app.state.signedInAccountId = null;
  app.state.accountEmail = null;
  saveState(app.state);
  broadcast({ type: "account", accountId: null, email: null });
  void hadAccount;
}

function journalLength(accountId: string): number {
  return (app.state.journals[accountId] ?? []).length;
}

export function persist(): void {
  saveState(app.state);
}

export function resetAppState(): void {
  app.state = freshState();
  saveState(app.state);
}

export type { SavedState, JournalEntry };

// The connection regions of the open screen, so the waiting-count line and
// the signed-out line follow each queued change without a reload.
function refreshConnectionRegions(): void {
  const regions = document.querySelectorAll<HTMLElement>('[role="status"][aria-label="Connection"]');
  for (const region of regions) {
    renderConnection(region);
  }
}

export function queueChangeLocal(accountId: string, change: SyncChange, kind: JournalEntry["kind"]): void {
  const journal = app.state.journals[accountId] ?? [];
  journal.push({ change, kind });
  app.state.journals[accountId] = journal;
  saveState(app.state);
  // The waiting-count line follows each queued change in this tab at once,
  // and the broadcast carries it to the other tabs within 2 seconds (DP-90).
  refreshConnectionRegions();
  broadcast({ type: "journal", accountId });
  // An online save is sent at once (Offline and sync).
  void import("./sync.js").then(({ flushJournal }) => flushJournal()).catch(() => {
    // The journal stays queued until signal returns.
  });
}
