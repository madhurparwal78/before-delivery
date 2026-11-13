// The working-screen shell: navigation, connection and sync status regions
// (DP-17, DP-23, DP-67).
import { app, signOutNow, persist, navigate, currentPathAndQuery } from "../app.js";
import { el } from "../dom.js";
import { accountSentences, connectionSentences } from "../../shared/sentences.js";
import { journalFor } from "../store.js";

export interface ShellParts {
  readonly column: HTMLElement;
  readonly connection: HTMLElement;
  readonly syncResults: HTMLElement;
}

export function shell(title: string, content: HTMLElement[]): ShellParts {
  const connection = el("div", { class: "status connection", role: "status", "aria-label": "Connection" });
  const nav = el("nav", { class: "nav", role: "navigation", "aria-label": "Main" },
    el("a", { class: "nav-link", href: "/tonight", text: "Tonight" }),
    el("a", { class: "nav-link", href: "/programs", text: "Programs" }),
    el("a", { class: "nav-link", href: "/kit", text: "Kit" }),
    el("button", {
      class: "button ghost",
      text: "Sign out",
      onclick: async () => {
        try {
          await signOutNow();
          app.state.signedOutExplicitly = true;
          persist();
          navigate("/");
        } catch {
          renderConnectionMessage(connection, accountSentences.signOutNoSignal);
        }
      },
    }),
  );

  const syncResults = el("div", { class: "status sync-results", role: "status", "aria-label": "Sync results" });
  const heading = el("h1", { class: "heading", text: title });
  const column = el("div", { class: "column", id: "column" }, nav, heading, connection, syncResults, ...content);
  renderConnection(connection);
  return { column, connection, syncResults };
}

export function renderConnectionMessage(region: HTMLElement, sentence: string): void {
  region.append(el("p", { class: "banner account-action", text: sentence }));
}

export function renderConnection(region: HTMLElement): void {
  region.textContent = "";
  const accountId = app.state.signedInAccountId;
  const waiting = accountId ? journalFor(app.state, accountId).length : 0;
  if (!navigator.onLine) {
    region.append(el("p", { class: "banner offline", text: connectionSentences.offline }));
  }
  // The signed-out line appears only when a sync answered 401 with changes
  // waiting (DP-67); offline with the device copy it never shows.
  if (waiting > 0 && !app.account && app.syncRefused) {
    region.append(el("p", { class: "banner signed-out", text: connectionSentences.signedOutWaiting(waiting) }),
      el("a", { class: "link inline-link", href: `/signin?next=${encodeURIComponent(currentPathAndQuery())}`, text: "Sign in" }));
  } else if (waiting > 0) {
    region.append(el("p", { class: "waiting-count", text: connectionSentences.waitingChanges(waiting) }));
  }
}
