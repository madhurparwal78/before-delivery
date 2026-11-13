// The screen dispatcher: renders the route, offline or online (DP-70, DP-88).
import { app, navigate, parseRoute, resumeSession, type Screen } from "../app.js";
import { clear, el } from "../dom.js";
import { renderLanding } from "./landing.js";
import { renderSignup, renderSignin } from "./authScreens.js";
import { renderTonight } from "./tonight.js";
import { renderSession } from "./session.js";
import { renderObjectHistory } from "./objectHistory.js";
import { renderPrograms } from "./programs.js";
import { renderProgram } from "./program.js";
import { renderPacket } from "./packet.js";
import { renderKit } from "./kit.js";
import { apiGet } from "../api.js";
import type { SyncResult } from "../../shared/api.js";
import { journalFor, accountStoreFor } from "../store.js";

export const syncResultsBuffer: SyncResult[] = [];

export function announceSyncResult(result: SyncResult): void {
  syncResultsBuffer.push(result);
  const region = document.querySelector('[role="status"][aria-label="Sync results"]');
  if (region) renderSyncResults(region as HTMLElement);
}

export function renderSyncResults(region: HTMLElement): void {
  clear(region);
  for (const result of syncResultsBuffer) {
    region.append(el("p", { text: syncSentence(result) }));
  }
}

export function syncSentence(result: SyncResult): string {
  const body = result.body as Record<string, unknown>;
  if (typeof body === "object" && body && "designation" in body) {
    const designation = String(body["designation"]);
    const evening = String(body["evening_date"] ?? "");
    if (result.status < 300) return `${designation} (${evening}) synced.`;
    if (result.status === 403) return `${designation} (${evening}) deleted.`;
    return `${designation} (${evening}) did not sync (${String(body["error"] ?? "error")}).`;
  }
  return "";
}

let renderGeneration = 0;

export async function renderApp(results?: SyncResult[]): Promise<void> {
  // A generation guard: an older render that is still awaiting its data must
  // never paint over a newer one (DP-62's display rule, applied to screens).
  const generation = ++renderGeneration;
  const screen = parseRoute(app.route);
  const root = document.getElementById("root")!;
  clear(root);
  if (results) {
    for (const result of results) syncResultsBuffer.push(result);
  }

  // Authentication and offline gating (DP-67, DP-70, DP-88).
  const guarded = isGuarded(screen);
  if (guarded && !app.account) {
    const holdsAccount = Boolean(app.state.lastSignedInEmail);
    if (holdsAccount && (!navigator.onLine || app.state.signedInAccountId)) {
      // The device holds the signed-in account's copy: the working screens
      // show it, with no network and no sign-in redirect. After an explicit
      // sign out this path never applies (Whose device data it is).
      if (!app.state.signedOutExplicitly) {
        await resumeFromDevice(screen, root, generation);
        return;
      }
    }
    if (app.state.lastSignedInEmail && !app.state.signedOutExplicitly) {
      // Try to resume the session before falling back to sign-in.
      try {
        const me = await apiGet.me();
        app.account = me.account;
        app.state.signedInAccountId = me.account.id;
      } catch {
        // fall through to sign-in
      }
    }
    if (!app.account) {
      navigate(`/signin?next=${encodeURIComponent(app.route)}`, true);
      return;
    }
  }
  await renderScreen(screen, root, generation);
}

async function resumeFromDevice(screen: Screen, root: HTMLElement, generation: number): Promise<void> {
  await renderScreen(screen, root, generation);
}

export function isGuarded(screen: Screen): boolean {
  return screen.name !== "landing" && screen.name !== "signin" && screen.name !== "signup";
}

async function renderScreen(screen: Screen, root: HTMLElement, generation: number): Promise<void> {
  const current = (): boolean => generation === renderGeneration;
  if (!current()) return;
  const paint = async (render: () => Promise<void>): Promise<void> => {
    await render();
    // A superseded render may have appended after the newest one cleared the
    // root; drop everything this render painted so only the newest shows.
    if (!current()) clear(root);
  };
  switch (screen.name) {
    case "landing":
      renderLanding(root);
      return;
    case "signup":
      renderSignup(root);
      return;
    case "signin":
      renderSignin(root, screen.next);
      return;
    case "notfound":
      renderNotFound(root);
      return;
    case "tonight":
      await paint(() => renderTonight(root));
      return;
    case "session":
      await paint(() => renderSession(root, screen.sessionId, screen.observationId));
      return;
    case "objectHistory":
      await paint(() => renderObjectHistory(root, screen.objectId));
      return;
    case "programs":
      await paint(() => renderPrograms(root));
      return;
    case "program":
      await paint(() => renderProgram(root, screen.programId));
      return;
    case "packet":
      await paint(() => renderPacket(root, screen.packetId));
      return;
    case "kit":
      await paint(() => renderKit(root));
      return;
  }
}

export function renderNotFound(root: HTMLElement): void {
  const column = el("div", { class: "column narrow" },
    el("p", { class: "notfound", role: "note", text: "We couldn't find that here." }),
    el("p", {}, el("a", { class: "link", href: "/tonight", text: "Tonight" })),
  );
  root.append(column);
}

export function journalCount(): number {
  if (!app.state.signedInAccountId) return 0;
  return journalFor(app.state, app.state.signedInAccountId).length;
}

export function deviceStore() {
  if (!app.state.signedInAccountId) return null;
  return accountStoreFor(app.state, app.state.signedInAccountId);
}
