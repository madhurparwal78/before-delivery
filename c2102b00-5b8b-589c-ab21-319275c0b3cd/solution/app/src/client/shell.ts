// The signed-in frame: top bar, the Notices region, the screen's live regions and navigation.
import { h } from "./dom.js";

export type Role = "coordinator" | "member" | "volunteer";

export interface Me {
  role: Role;
  name: string;
  household_code: string | null;
}

interface Club {
  name: string;
  time_zone: string;
  distributor: string;
}

export const session: { me: Me | null; club: Club | null } = { me: null, club: null };

export const HOME: Record<Role, string> = { coordinator: "/coordinator", member: "/", volunteer: "/breakdown" };

// ---- Live regions ------------------------------------------------------------------------------

type LiveName = "Pledge updates" | "Credit updates" | "Coordinator updates" | "Bag updates";

const regions = new Map<LiveName, HTMLElement>();
const updatesSlot = h("div", { class: "updates" });

function region(name: LiveName): HTMLElement {
  let el = regions.get(name);
  if (!el) {
    el = h("div", { role: "status", "aria-live": "polite", "aria-label": name, class: "live" });
    regions.set(name, el);
  }
  return el;
}

/** Shows the screen's live regions; each keeps its last text across screens of one sign-in. */
export function useLive(...names: LiveName[]): void {
  updatesSlot.replaceChildren(
    ...names.map((n) => h("div", { class: "update-line" }, h("span", { class: "label", "aria-hidden": "true" }, n.toUpperCase()), region(n))),
  );
  updatesSlot.hidden = names.length === 0;
}

/** A new announcement replaces the previous text; nothing else clears a live region. */
export function announce(name: LiveName, text: string): void {
  const el = region(name);
  el.textContent = text;
  el.closest(".update-line")?.classList.toggle("has-text", text !== "");
}

// ---- Notices -----------------------------------------------------------------------------------

const noticesEl = h("section", { class: "notices", "aria-label": "Notices" });
const notices = new Map<string, HTMLElement>();

/** Shows or removes one banner in the Notices region. */
export function setNotice(id: string, text: string | null, tone: "alert" | "info" = "alert"): void {
  const existing = notices.get(id);
  if (text === null) {
    existing?.remove();
    notices.delete(id);
    return;
  }
  if (existing) {
    if (existing.textContent !== text) existing.textContent = text;
    return;
  }
  const el = h("p", { class: `banner banner-${tone}` }, text);
  notices.set(id, el);
  noticesEl.append(el);
}

function clearNotices(): void {
  for (const el of notices.values()) el.remove();
  notices.clear();
}

// ---- Frame -------------------------------------------------------------------------------------

export const main = h("main", { id: "main", class: "screen" });
const topbar = h("header", { class: "topbar" });

export function renderFrame(root: HTMLElement, onSignOut: () => void): void {
  if (!session.me) {
    root.replaceChildren(h("div", { class: "frame signed-out" }, main));
    return;
  }
  const signOut = h("button", { type: "button", class: "button quiet", onclick: onSignOut }, "Sign out");
  topbar.replaceChildren(
    h("a", { class: "brand", href: HOME[session.me.role] },
      h("span", { class: "brand-mark", "aria-hidden": "true" }),
      h("span", { class: "brand-name" }, session.club?.name ?? "")),
    h("p", { class: "who" }, h("span", { class: "label" }, "Signed in"), " ", h("span", { class: "who-name" }, session.me.name)),
    signOut,
  );
  root.replaceChildren(h("div", { class: "frame" }, topbar, noticesEl, updatesSlot, main));
}

export function resetSession(): void {
  regions.clear();
  updatesSlot.replaceChildren();
  clearNotices();
}

// ---- Navigation --------------------------------------------------------------------------------

let onNavigate: () => void = () => undefined;

export function setNavigator(render: () => void): void {
  onNavigate = render;
}

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  onNavigate();
}
