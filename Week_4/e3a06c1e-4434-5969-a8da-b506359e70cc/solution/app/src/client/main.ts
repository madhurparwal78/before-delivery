// Lowfield Console in the browser: routes, the console guard and in-app navigation.
import "./fonts.css";
import "./styles.css";
import type { Me, Role } from "../shared/types";
import { allows, landing, type Action } from "../shared/permissions";
import { api, setOutage, whenSignedOut } from "./api";
import { h } from "./dom";
import { createShell, type Shell } from "./shell";
import { renderPublic } from "./pages/public";
import { renderJoin, renderSignIn } from "./pages/access";
import { renderProjects } from "./pages/projects";
import { renderProject } from "./pages/project";
import { renderSession } from "./pages/session";
import { renderUsage } from "./pages/usage";
import { renderMembers } from "./pages/members";
import { renderPlan } from "./pages/plan";

export interface Page {
  root: HTMLElement;
  params: string[];
  query: URLSearchParams;
  me: Me;
  /** Transient state handed over by the previous screen (the morph source, a status to announce). */
  handover: Handover;
  onLeave(cleanup: () => void): void;
  /** False once the visitor has moved to another screen. */
  current(): boolean;
}

/** Public screens (site, sign in, join) render without a signed-in profile. */
export type PublicPage = Omit<Page, "me">;

interface Handover {
  morph?: { id: string; rect: DOMRect; thumbnail: Element; label: string };
  keysStatus?: string;
}

interface Route {
  pattern: RegExp;
  action?: Action;
  render: (page: Page) => void | Promise<void>;
}

const CONSOLE: Route[] = [
  { pattern: /^\/console\/projects$/, action: "projects.read", render: renderProjects },
  { pattern: /^\/console\/projects\/([^/]+)(?:\/([a-z]+))?$/, action: "projects.read", render: renderProject },
  { pattern: /^\/console\/sessions\/([^/]+)$/, action: "sessions.read", render: renderSession },
  { pattern: /^\/console\/usage$/, action: "usage.read", render: renderUsage },
  { pattern: /^\/console\/org\/members$/, action: "admin", render: renderMembers },
  { pattern: /^\/console\/org\/plan$/, action: "admin", render: renderPlan },
];

const app = document.getElementById("app")!;
let shell: Shell | null = null;
let signedIn: Me | null = null;
let cleanups: (() => void)[] = [];
let generation = 0;
let handover: Handover = {};

export function navigate(path: string, options: { replace?: boolean; handover?: Handover } = {}): void {
  handover = options.handover ?? {};
  if (options.replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  void render();
}

/** Redirects a role away from a screen it may not open, to its landing route. */
export function redirectToLanding(role: Role): void {
  navigate(landing(role), { replace: true });
}

function leave(): void {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
  setOutage("billing", false);
}

async function render(): Promise<void> {
  const ticket = ++generation;
  leave();
  const path = location.pathname;
  const query = new URLSearchParams(location.search);
  const given = handover;
  handover = {};
  const base = {
    query,
    handover: given,
    onLeave: (cleanup: () => void) => cleanups.push(cleanup),
    current: () => ticket === generation,
  };
  if (path === "/" || path === "/sign-in" || path.startsWith("/join/")) {
    shell = null;
    signedIn = null;
    app.className = "public-app";
    const root = h("div", { class: "screen" });
    app.replaceChildren(root);
    if (path === "/") renderPublic({ ...base, root, params: [] });
    else if (path === "/sign-in") renderSignIn({ ...base, root, params: [] });
    else renderJoin({ ...base, root, params: [decodeURIComponent(path.slice("/join/".length))] });
    return;
  }
  if (path === "/console" || path === "/console/") {
    const me = await api<Me>("GET", "/api/me");
    if (me.ok && ticket === generation) redirectToLanding(me.data.user.role);
    return;
  }
  const route = CONSOLE.find((r) => r.pattern.test(path));
  if (!route) {
    shell = null;
    app.className = "public-app";
    app.replaceChildren(
      h("div", { class: "screen centred" }, h("div", { class: "card" }, h("h1", {}, "Page not found"), h("p", {}, "There is nothing at this address."), h("a", { href: "/console/projects", class: "button" }, "Go to the console"))),
    );
    return;
  }
  // Inside the console the known profile renders at once (the list-to-detail morph starts on the
  // click itself); a fresh profile follows, and a role that lost access is sent to its landing route.
  const fresh = api<Me>("GET", "/api/me").then((result) => {
    if (!result.ok || ticket !== generation) return null;
    signedIn = result.data;
    shell?.update(result.data, path);
    if (route.action && !allows(result.data.user.role, route.action)) redirectToLanding(result.data.user.role);
    return result.data;
  });
  const me = shell && signedIn ? signedIn : await fresh;
  if (!me || ticket !== generation) return;
  if (route.action && !allows(me.user.role, route.action)) {
    redirectToLanding(me.user.role);
    return;
  }
  if (!shell) {
    shell = createShell(signOut);
    app.className = "console-app";
    app.replaceChildren(shell.root);
  }
  shell.closeNavigation();
  shell.update(me, path);
  const root = h("div", { class: "page-inner" });
  shell.page.replaceChildren(root);
  document.getElementById("workspace")?.scrollTo?.(0, 0);
  await route.render({ ...base, root, me, params: route.pattern.exec(path)!.slice(1).filter((p): p is string => p !== undefined) });
}

async function signOut(): Promise<void> {
  await api("POST", "/api/auth/sign-out");
  signedIn = null;
  navigate("/sign-in");
}

whenSignedOut(() => {
  if (location.pathname.startsWith("/console")) navigate("/sign-in", { replace: true });
});

// In-app links navigate without a reload; modified clicks keep the browser's behaviour.
document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element).closest?.("a[href]");
  if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute("download") || link.origin !== location.origin) return;
  if (link.pathname.startsWith("/api/") || link.pathname.startsWith("/v1/") || link.pathname.startsWith("/fixtures/")) return;
  event.preventDefault();
  navigate(link.pathname + link.search);
});

addEventListener("popstate", () => void render());
void render();
