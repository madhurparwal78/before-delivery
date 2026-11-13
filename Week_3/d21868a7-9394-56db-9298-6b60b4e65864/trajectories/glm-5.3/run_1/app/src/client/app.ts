// The app shell: routing, the session, the top bar, live polling.
import { api, isNotSignedIn, ApiFailure } from "./api.ts";
import type { UserRecord, WindowRecord, OrderRecord, CardRecord, Suggestion } from "./types.ts";
import { h, clear, text, statusRegion, icon } from "./html.ts";

export type Route = { path: string; render: (params: Match) => void | Promise<void> };
export type Match = { path: string; params: Record<string, string>; query: URLSearchParams };

let me: UserRecord | null = null;
export function currentUser(): UserRecord | null {
  return me;
}

const routes: Array<{ re: RegExp; keys: string[]; render: (m: Match) => void | Promise<void> }> = [];

export function route(pattern: string, render: (m: Match) => void | Promise<void>): void {
  const keys: string[] = [];
  const re = new RegExp(
    "^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/<([^>]+)>/g, (_m, k) => {
      keys.push(String(k));
      return "([^/]+)";
    }) + "$",
  );
  routes.push({ re, keys, render });
}

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  void render();
}

export const ROLE_HOME: Record<UserRecord["role"], string> = {
  grower: "/grower",
  operator: "/field",
  dispatcher: "/board",
  clerk: "/packs",
  reviewer: "/review",
};

const PAGE_ROUTES: Record<UserRecord["role"], RegExp[]> = {
  grower: [/^\/grower$/, /^\/grower\/orders\/new$/, /^\/orders\/ORD-\d+$/],
  operator: [/^\/field$/],
  dispatcher: [/^\/board$/, /^\/channels\/C-[\w-]+\/capacity$/, /^\/restrictions\/\d+$/, /^\/orders\/ORD-\d+$/, /^\/contractors$/],
  clerk: [/^\/packs$/, /^\/packs\/new$/, /^\/packs\/WP-\d+$/, /^\/channels\/C-[\w-]+\/capacity$/, /^\/restrictions\/\d+$/, /^\/orders\/ORD-\d+$/, /^\/contractors$/],
  reviewer: [/^\/review$/, /^\/packs\/WP-\d+$/, /^\/channels\/C-[\w-]+\/capacity$/, /^\/restrictions\/\d+$/],
};

export const ROLE_NAV: Record<UserRecord["role"], Array<[string, string]>> = {
  grower: [["Grower home", "/grower"], ["New order", "/grower/orders/new"]],
  operator: [["Field view", "/field"]],
  dispatcher: [["Channel board", "/board"], ["Contractors", "/contractors"]],
  clerk: [["Packs", "/packs"], ["New pack", "/packs/new"], ["Contractors", "/contractors"]],
  reviewer: [["Review", "/review"]],
};

// the return path check: exactly one leading slash and a page route of the role
export function returnPathAllowed(returnPath: string | null): string | null {
  if (!me || !returnPath) return null;
  if (!returnPath.startsWith("/") || returnPath.startsWith("//") || returnPath.startsWith("/\\")) return null;
  let valid = false;
  try {
    const u = new URL(returnPath, location.origin);
    valid = PAGE_ROUTES[me.role].some((re) => re.test(u.pathname));
  } catch {
    valid = false;
  }
  return valid ? returnPath : null;
}

const root = () => document.getElementById("root")!;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollFn: (() => Promise<void>) | null = null;

// Every open screen polls the server on its own timer; the device clock is
// never used to compute a status or a refresh moment.
export function startPolling(fn: () => Promise<void>, ms = 2000): void {
  stopPolling();
  pollFn = fn;
  pollTimer = setInterval(() => {
    void pollFn?.().catch(() => undefined);
  }, ms);
}

export function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  pollFn = null;
}

export async function goSignIn(fromPath?: string): Promise<void> {
  stopPolling();
  me = null;
  let target = "/sign-in";
  if (fromPath) {
    target = `/sign-in?return=${encodeURIComponent(fromPath)}`;
  }
  if (location.pathname + location.search !== target) {
    history.replaceState(null, "", target);
  }
  await render();
}

async function ensureUser(): Promise<void> {
  try {
    const r = await api<{ user: UserRecord }>("GET", "/api/me");
    me = r.user;
  } catch (e) {
    me = null;
  }
}

export async function render(): Promise<void> {
  const path = location.pathname;
  const query = new URLSearchParams(location.search);
  stopPolling();

  if (path === "/sign-in" || path === "/") {
    if (path === "/" || me) {
      if (me) {
        history.replaceState(null, "", ROLE_HOME[me.role]);
        await renderSignedIn();
        return;
      }
    }
    await renderSignIn();
    return;
  }
  if (!me) {
    await ensureUser();
    if (!me) {
      await goSignIn(path + location.search);
      return;
    }
  }
  await renderSignedIn();
}

async function renderSignIn(): Promise<void> {
  const query = new URLSearchParams(location.search);
  const rootEl = root();
  clear(rootEl);
  const status = statusRegion("Sign-in status", "sign-in-status");
  const email = h("input", { type: "email", id: "email", autocomplete: "username" }) as HTMLInputElement;
  const password = h("input", { type: "password", id: "password", autocomplete: "current-password" }) as HTMLInputElement;
  const submit = h("button", { type: "submit", class: "primary" }, "Sign in");
  const form = h(
    "form",
    { "aria-label": "Sign in", onsubmit: async (ev: Event) => {
      ev.preventDefault();
      clear(status);
      status.append(text("Signing in."));
      try {
        const r = await api<{ user: UserRecord }>("POST", "/api/session", { email: email.value.trim(), password: password.value });
        me = r.user;
        const want = returnPathAllowed(query.get("return"));
        history.replaceState(null, "", want ?? ROLE_HOME[me.role]);
        await render();
      } catch (e) {
        clear(status);
        status.append(text(e instanceof ApiFailure && e.shape.kind === "error" && e.shape.error === "bad_credentials"
          ? "That email and password do not match."
          : "That email and password do not match."));
        password.value = "";
        password.focus();
      }
    } },
    h("label", { for: "email" }, "Email"),
    email,
    h("label", { for: "password" }, "Password"),
    password,
    h("div", { style: "margin-top:12px" }, submit),
    status,
  );
  rootEl.append(
    h("header", { class: "topbar" }, h("span", { class: "brand" }, "Ditchbook")),
    h("div", { class: "signin-wrap" },
      h("div", { class: "signin-card" },
        h("h1", null, "Sign in to Ditchbook"),
        form,
      ),
    ),
  );
  email.focus();
}

async function renderSignedIn(): Promise<void> {
  const path = location.pathname;
  const query = new URLSearchParams(location.search);

  // role route check
  if (me && !PAGE_ROUTES[me.role].some((re) => re.test(path)) && path !== "/sign-in") {
    history.replaceState(null, "", ROLE_HOME[me.role]);
  }

  let matched = false;
  for (const r of routes) {
    const m = r.re.exec(location.pathname);
    if (m) {
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1] ?? "");
      });
      await r.render({ path, params, query });
      matched = true;
      break;
    }
  }
  if (!matched) {
    renderNotFound();
  }
}

function renderNotFound(): void {
  const rootEl = root();
  clear(rootEl);
  rootEl.append(
    h("header", { class: "topbar" }, h("span", { class: "brand" }, "Ditchbook")),
    h("div", { class: "page page-narrow" },
      h("h1", null, "Page not found"),
      h("p", null, "That address does not match anything in Ditchbook."),
    ),
  );
}

export function topBar(activeHref: string, opts?: { noNav?: boolean }): HTMLElement {
  const bar = h("header", { class: "topbar" });
  bar.append(h("a", { class: "brand", href: me ? ROLE_HOME[me.role] : "/" }, "Ditchbook"));
  bar.append(searchBox());
  bar.append(
    h("div", { class: "who" },
      h("b", null, me?.name ?? ""),
      text(`${me?.role === "operator" ? "Channel operator" : me?.role === "dispatcher" ? "Dispatcher" : me?.role === "clerk" ? "Records clerk" : me?.role === "reviewer" ? "Regulator reviewer" : "Grower"}${me?.operator_code ? ` · ${me.operator_code}` : ""}`),
    ),
  );
  bar.append(
    h("button", {
      onclick: async () => {
        try {
          await api("DELETE", "/api/session");
        } catch {
          // the session may already be gone
        }
        me = null;
        await goSignIn();
      },
    }, icon("log-out"), " Sign out"),
  );
  if (!opts?.noNav && me) {
    const nav = h("nav", { class: "nav", "aria-label": "Ditchbook" });
    for (const [label, href] of ROLE_NAV[me.role]) {
      const a = h("a", { href }, label);
      if (href === activeHref || (href !== "/grower" && activeHref.startsWith(href))) a.setAttribute("aria-current", "page");
      nav.append(a);
    }
    bar.append(h("div", { class: "nav-holder" }, nav));
  }
  return bar;
}

function searchBox(): HTMLElement {
  const input = h("input", {
    type: "text",
    role: "combobox",
    "aria-label": "Search turnouts, growers and operators",
    "aria-expanded": "false",
    "aria-controls": "suggestions",
    "aria-autocomplete": "list",
    placeholder: "Search",
  }) as HTMLInputElement;
  const list = h("ul", { id: "suggestions", role: "listbox", class: "suggestions", hidden: true });
  const wrap = h("div", { class: "searchbox" }, input, list);

  let latest = 0;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let activeIndex = -1;

  async function refresh(): Promise<void> {
    const token = ++latest;
    const q = input.value.trim();
    if (q.length < 2) {
      list.hidden = true;
      clear(list);
      input.setAttribute("aria-expanded", "false");
      return;
    }
    try {
      const r = await api<{ suggestions: Suggestion[] }>("GET", `/api/search?q=${encodeURIComponent(q)}`);
      if (token !== latest) return;
      clear(list);
      if (r.suggestions.length === 0) {
        list.hidden = true;
        input.setAttribute("aria-expanded", "false");
        return;
      }
      for (const s of r.suggestions) {
        const a = h("a", { href: s.href, role: "option" },
          h("span", { class: "kind" }, s.kind),
          h("span", null, s.label),
          h("span", { class: "detail" }, s.detail),
        );
        list.append(a);
      }
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      activeIndex = -1;
    } catch {
      if (token === latest) list.hidden = true;
    }
  }

  input.addEventListener("input", () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void refresh(), 250);
  });
  input.addEventListener("keydown", (ev) => {
    const items = Array.from(list.querySelectorAll("a"));
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (items.length === 0) return;
      activeIndex = ev.key === "ArrowDown" ? (activeIndex + 1) % items.length : (activeIndex - 1 + items.length) % items.length;
      (items[activeIndex] as HTMLElement).focus();
    } else if (ev.key === "Escape") {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
    }
  });
  list.addEventListener("keydown", (ev) => {
    const items = Array.from(list.querySelectorAll("a"));
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (items.length === 0) return;
      const idx = items.indexOf(document.activeElement as HTMLAnchorElement);
      const next = ev.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      activeIndex = next;
      (items[next] as HTMLElement).focus();
    }
  });
  document.addEventListener("click", (ev) => {
    if (!wrap.contains(ev.target as Node)) {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
    }
  });
  return wrap;
}

// the district-wide lead counters for packs/contractors/review screens
export async function districtCounters(): Promise<{ committed: string; delivered: string }> {
  const totals = await api<{ channels: Array<{ committed_ml: string; delivered_ml: string }> }>("GET", "/api/totals");
  let committed = 0;
  let delivered = 0;
  for (const c of totals.channels) {
    committed += Number(c.committed_ml);
    delivered += Number(c.delivered_ml);
  }
  return {
    committed: committed.toFixed(3),
    delivered: delivered.toFixed(3),
  };
}

export { renderSignIn };
