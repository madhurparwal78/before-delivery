import { api, Me } from "./api.js";
import { announce, resetLiveRegions } from "./live.js";
import { clear, el } from "./util.js";
import { openDialog } from "./dialog.js";

export interface SessionState {
  me: Me | null;
}

export const session: SessionState = { me: null };

export async function loadMe(): Promise<Me | null> {
  try {
    const { data } = await api<Me>("/api/me");
    session.me = data;
    return data;
  } catch {
    session.me = null;
    return null;
  }
}

export function roleHome(me: Me): string {
  if (me.role === "coordinator") return "/coordinator";
  if (me.role === "volunteer") return "/breakdown";
  return "/";
}

/** Renders the top bar shown on every signed-in screen. */
export function renderTopBar(clubName: string, me: Me): void {
  const bar = document.getElementById("topbar")!;
  clear(bar);
  bar.append(
    el("span", { class: "club-name", text: clubName }),
    el("span", { class: "person", text: me.name }),
    el(
      "button",
      { text: "Sign out", onclick: () => void signOut() }
    )
  );
}

export function clearTopBar(): void {
  clear(document.getElementById("topbar")!);
}

export interface AppHooks {
  signOutReset: () => void;
  afterSignIn: (path: string, me: Me) => void;
  renderRoute: () => Promise<void>;
}

export const hooks: AppHooks = {
  signOutReset: () => {},
  afterSignIn: () => {},
  renderRoute: async () => {},
};

export async function signOut(): Promise<void> {
  try {
    await api("/api/session", { method: "DELETE" });
  } catch {
    /* the session cookie is cleared by the server response */
  }
  session.me = null;
  resetLiveRegions();
  hooks.signOutReset();
  history.replaceState(null, "", "/");
  await hooks.renderRoute();
}

/** Shows the sign-in panel on the page it was opened at. */
export function showSignIn(path: string): void {
  clearTopBar();
  const main = document.getElementById("main")!;
  clear(main);
  const panel = el("div", { class: "signin-panel" });
  const code = el("input", { type: "text", id: "access-code", autocomplete: "off" });
  code.setAttribute("aria-label", "ACCESS CODE");
  const errorLine = el("div", { class: "field-error", role: "alert", hidden: true });
  const submit = el("button", { text: "Sign in" });
  panel.append(
    el("h1", { text: "Tare & Tally" }),
    el("div", { class: "field" }, el("label", { class: "label", for: "access-code", text: "ACCESS CODE" }), code, errorLine),
    submit
  );
  const wrap = el("div", { class: "page" }, panel);
  main.append(wrap);

  const doSignIn = async () => {
    if (submit.hasAttribute("disabled")) return;
    submit.setAttribute("disabled", "");
    submit.textContent = "Signing in...";
    errorLine.hidden = true;
    try {
      const { data } = await api<Me>("/api/session", { method: "POST", body: JSON.stringify({ code: (code as HTMLInputElement).value }) });
      session.me = data;
      hooks.afterSignIn(path, data);
    } catch (e) {
      submit.removeAttribute("disabled");
      submit.textContent = "Sign in";
      errorLine.hidden = false;
      errorLine.textContent = "That code doesn't match anyone in this club.";
    }
  };
  submit.addEventListener("click", () => void doSignIn());
  code.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void doSignIn();
  });
  code.focus();
}

export interface ClubInfo {
  name: string;
  time_zone: string;
  distributor: string;
}

let clubCache: ClubInfo | null = null;

export async function clubInfo(): Promise<ClubInfo> {
  if (!clubCache) {
    const { data } = await api<ClubInfo>("/api/club");
    clubCache = data;
  }
  return clubCache;
}

export function forgetClub(): void {
  clubCache = null;
}

/** Payments status banner state, shared by member screens. */
let paymentsPaused = false;
const listeners: ((paused: boolean) => void)[] = [];

export function isPaymentsPaused(): boolean {
  return paymentsPaused;
}

export function onPaymentsChange(cb: (paused: boolean) => void): void {
  listeners.push(cb);
}

export async function refreshPaymentsStatus(): Promise<void> {
  try {
    const { data } = await api<{ payments: "available" | "paused" }>("/api/payments/status");
    const paused = data.payments === "paused";
    if (paused !== paymentsPaused) {
      paymentsPaused = paused;
      for (const cb of listeners) cb(paused);
    }
  } catch {
    /* keep the last known state */
  }
}

export function startPaymentsPolling(): void {
  setInterval(() => void refreshPaymentsStatus(), 10000);
}
