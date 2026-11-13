import { state, type Lang, type CurrencyCode } from "./i18n.js";
import { api } from "./api.js";
import { connectEvents, syncTime, onEvent } from "./events.js";
import { setToastMs } from "./ui.js";
import { renderRoute } from "./router.js";
import { uiString } from "./strings.js";

/** Fetch /api/me and seed the shared client state. */
export async function syncStateFromMe(): Promise<void> {
  const res = await api<{ user: { username: string; role: string; manages: string[] } | null; lang: string; cur: string; tier: string; completed_stays: number; perks: string[] }>("/api/me");
  if (!res.ok) return;
  state.lang = res.data.lang as Lang;
  state.cur = res.data.cur as CurrencyCode;
  state.user = res.data.user as typeof state.user;
  state.tier = res.data.tier;
  state.completedStays = res.data.completed_stays;
  state.perks = res.data.perks;
}

export function ui(key: string): string {
  return uiString(state.lang, key);
}

/** The shared site header. */
export function renderHeader(): HTMLElement {
  const existing = document.querySelector<HTMLElement>(".site-header");
  if (existing) { refreshNav(); return existing; }
  const header = document.createElement("header");
  header.className = "site-header";
  const wordmark = document.createElement("a");
  wordmark.className = "wordmark";
  wordmark.href = "/";
  wordmark.textContent = "KIPWELL";
  header.appendChild(wordmark);
  const prefs = document.createElement("div");
  prefs.className = "prefs";
  const langSel = document.createElement("select");
  langSel.dataset.focusKey = "header.lang";
  langSel.setAttribute("aria-label", ui("header.language"));
  for (const [code, name] of [["en", "English"], ["de", "Deutsch"], ["ar", "العربية"]] as const) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = name;
    langSel.appendChild(opt);
  }
  langSel.value = state.lang;
  langSel.addEventListener("change", () => { void changePref({ lang: langSel.value }); });
  const curSel = document.createElement("select");
  curSel.dataset.focusKey = "header.cur";
  curSel.setAttribute("aria-label", ui("header.currency"));
  for (const code of ["EUR", "USD", "JPY", "KWD"]) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = code;
    curSel.appendChild(opt);
  }
  curSel.value = state.cur;
  curSel.addEventListener("change", () => { void changePref({ cur: curSel.value }); });
  prefs.append(langSel, curSel);
  header.appendChild(prefs);
  const nav = document.createElement("nav");
  nav.className = "site-links";
  nav.dataset.slot = "nav";
  header.appendChild(nav);
  document.body.prepend(header);
  refreshNav();
  return header;
}

export async function changePref(patch: { lang?: string; cur?: string }): Promise<void> {
  const res = await api("/api/me/preferences", { method: "PATCH", body: JSON.stringify(patch) });
  if (!res.ok) return;
  state.lang = (res.data as { lang: Lang }).lang;
  state.cur = (res.data as { cur: CurrencyCode }).cur;
  const url = new URL(location.href);
  url.searchParams.set("lang", state.lang);
  url.searchParams.set("cur", state.cur);
  history.pushState({}, "", url);
  await renderRoute(location.pathname + location.search);
}

export function refreshNav(): void {
  const nav = document.querySelector<HTMLElement>('[data-slot="nav"]');
  if (!nav) return;
  nav.replaceChildren();
  const mk = (href: string, key: string, focusKey: string, text?: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.dataset.focusKey = focusKey;
    a.textContent = text ?? ui(key);
    return a;
  };
  nav.appendChild(mk("/destinations", "header.destinations", "header.destinations"));
  nav.appendChild(mk("/for-properties", "header.properties", "header.properties"));
  if (state.user) {
    nav.appendChild(mk("/inbox", "header.inbox", "header.inbox"));
    nav.appendChild(mk("/account", "nav.account", "header.account", state.user.username));
  } else {
    nav.appendChild(mk("/signin", "header.signin", "header.signin"));
  }
}

export async function boot(): Promise<void> {
  setToastMs(Number(process.env.KIP_TOAST_MS));
  const shell = document.createElement("main");
  shell.id = "app-main";
  document.body.appendChild(shell);
  renderHeader();
  await syncTime();
  await syncStateFromMe();
  renderHeader();
  connectEvents();
  // another tab's preference change applies live and replaces this URL's lang and cur
  onEvent((name, data) => {
    if (name !== "account.changed") return;
    if (data.signed_out === true) {
      state.user = null;
      location.href = "/signin";
      return;
    }
    // the shared dispatch already applied lang and cur to the state; compare with the URL
    const url = new URL(location.href);
    const urlLang = url.searchParams.get("lang");
    const urlCur = url.searchParams.get("cur");
    if (urlLang !== state.lang || urlCur !== state.cur) {
      url.searchParams.set("lang", state.lang);
      url.searchParams.set("cur", state.cur);
      history.replaceState({}, "", url);
      renderHeader();
      void renderRoute(location.pathname + location.search);
    }
  }, "account.changed");
  window.addEventListener("popstate", () => {
    void renderRoute(location.pathname + location.search);
  });
  await renderRoute(location.pathname + location.search);
}

void boot();
