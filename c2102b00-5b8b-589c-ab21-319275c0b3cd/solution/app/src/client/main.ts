// Boot and routing. Every screen asks the server again whenever it is shown, so Back after sign-out
// shows the sign-in panel and nothing else.
import { api, endSession } from "./api.js";
import { h } from "./dom.js";
import { breakdownScreen } from "./screens/breakdown.js";
import { coordinatorCycleScreen } from "./screens/coordinator-cycle.js";
import { cyclesScreen } from "./screens/cycles.js";
import { creditScreen } from "./screens/credit.js";
import { memberCycleScreen } from "./screens/member-cycle.js";
import { memberHomeScreen } from "./screens/member-home.js";
import { signInScreen } from "./screens/sign-in.js";
import { HOME, main, type Me, type Role, renderFrame, resetSession, session, setNavigator } from "./shell.js";

export type Cleanup = () => void;
export type Screen = (params: string[]) => Cleanup | void | Promise<Cleanup | void>;

interface Route {
  pattern: RegExp;
  roles: Role[];
  screen: Screen;
}

const ROUTES: Route[] = [
  { pattern: /^\/$/, roles: ["member"], screen: memberHomeScreen },
  { pattern: /^\/cycles\/([^/]+)$/, roles: ["member"], screen: memberCycleScreen },
  { pattern: /^\/credit$/, roles: ["member"], screen: creditScreen },
  { pattern: /^\/coordinator$/, roles: ["coordinator"], screen: cyclesScreen },
  { pattern: /^\/coordinator\/cycles\/([^/]+)$/, roles: ["coordinator"], screen: coordinatorCycleScreen },
  { pattern: /^\/breakdown$/, roles: ["volunteer", "coordinator"], screen: breakdownScreen },
];

const root = document.getElementById("app")!;
let cleanup: Cleanup | null = null;
let generation = 0;

function notFoundScreen(): void {
  document.title = "Page not found · Tally Split";
  main.replaceChildren(
    h("section", { class: "panel not-found" },
      h("h1", {}, "Page not found"),
      h("p", { class: "muted" }, "Nothing on the manifest at this address."),
      h("p", {}, h("a", { class: "button", href: HOME[session.me!.role] }, "Back to your home")),
    ),
  );
}

async function signOut(): Promise<void> {
  endSession();
  await api("DELETE", "/api/session").catch(() => undefined);
  session.me = null;
  resetSession();
  history.pushState(null, "", "/");
  await render();
}

/** Shows the screen for the current address, landing on the role's home when it may not see it. */
async function render(): Promise<void> {
  const mine = ++generation;
  cleanup?.();
  cleanup = null;
  const me = await api<Me>("GET", "/api/me").catch(() => null);
  if (mine !== generation) return;
  if (!me || me.status !== 200) {
    session.me = null;
    resetSession();
    renderFrame(root, () => void signOut());
    signInScreen(async (signedIn) => {
      session.me = signedIn;
      await landAfterSignIn();
    });
    return;
  }
  session.me = me.body;
  if (!session.club) session.club = (await api("GET", "/api/club")).body;
  if (mine !== generation) return;
  const path = location.pathname;
  const route = ROUTES.find((r) => r.pattern.test(path));
  if (!route) {
    renderFrame(root, () => void signOut());
    notFoundScreen();
    return;
  }
  if (!route.roles.includes(session.me.role)) {
    history.replaceState(null, "", HOME[session.me.role]);
    await render();
    return;
  }
  // The frame appears once the screen holds the server's data, so a signed-in screen is never stale.
  const result = await route.screen(route.pattern.exec(path)!.slice(1).map(decodeURIComponent));
  if (mine !== generation) {
    result?.();
    return;
  }
  cleanup = result ?? null;
  renderFrame(root, () => void signOut());
}

async function landAfterSignIn(): Promise<void> {
  const route = ROUTES.find((r) => r.pattern.test(location.pathname));
  if (route && !route.roles.includes(session.me!.role)) history.replaceState(null, "", HOME[session.me!.role]);
  await render();
}

setNavigator(() => void render());

document.addEventListener("click", (event) => {
  const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || link.hasAttribute("download")) return;
  if (url.hash && url.pathname === location.pathname) return;
  event.preventDefault();
  history.pushState(null, "", url.pathname);
  void render();
});

addEventListener("popstate", () => void render());
addEventListener("pageshow", (event) => {
  if (event.persisted) void render();
});

void render();
