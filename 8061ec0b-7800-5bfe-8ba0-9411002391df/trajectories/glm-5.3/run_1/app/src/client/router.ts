// The single-page router. Signed-in routes redirect a signed-out visitor to
// /?next=<path and query> (DP-66).
import { loadSession, landingPath, routeOpenTo, type SessionUser } from "./state.js";
import { renderSignIn } from "./screens/signin.js";
import { renderRegister } from "./screens/register.js";
import { renderContractSheet } from "./screens/contractSheet.js";
import { renderFamily } from "./screens/family.js";
import { renderReserve } from "./screens/reserve.js";
import { renderSigningPage } from "./screens/signing.js";
import { renderPriceLists } from "./screens/priceLists.js";
import { renderSchools } from "./screens/schools.js";
import { renderRoster } from "./screens/roster.js";
import { h, clearChildren } from "./ui/dom.js";
import { buildTopBar, roleHome } from "./ui/topbar.js";

export interface RenderContext {
  root: HTMLElement;
  path: string;
  query: URLSearchParams;
  user: SessionUser | null;
}

export function navigate(path: string, replace = false): void {
  if (replace) {
    history.replaceState(null, "", path);
  } else {
    history.pushState(null, "", path);
  }
  void route();
}

export async function route(): Promise<void> {
  document.dispatchEvent(new CustomEvent("bellroll:navigate"));
  const root = document.getElementById("root")!;
  const url = new URL(window.location.href);
  const path = url.pathname;
  const query = url.searchParams;

  // Public routes first: the signing page and sign in.
  if (path.startsWith("/sign/")) {
    await renderSigningPage(root, path.slice("/sign/".length));
    return;
  }

  const user = await loadSession();

  if (path === "/" || path === "/index.html" || path === "") {
    if (user) {
      const next = query.get("next");
      const target = landingPath(next, user.role, roleHome(user));
      if (target !== window.location.pathname + window.location.search) {
        history.replaceState(null, "", target);
      }
      await renderProtected(root, target, query, user);
    } else {
      await renderSignIn(root, query.get("next"));
    }
    return;
  }

  if (!user) {
    // A signed-out request for a signed-in route goes to /?next=<path and
    // query>, whatever the role it asks for.
    if (routeOpenToAny(path) || !knownPublicRoute(path)) {
      const nextValue = encodeURIComponent(path + (url.search || ""));
      history.replaceState(null, "", `/?next=${nextValue}`);
      await renderSignIn(root, path + (url.search || ""));
      return;
    }
    history.replaceState(null, "", "/");
    await renderSignIn(root, null);
    return;
  }

  if (!routeOpenTo(path, user.role)) {
    history.replaceState(null, "", roleHome(user));
    await renderProtected(root, roleHome(user), new URLSearchParams(), user);
    return;
  }

  await renderProtected(root, path, query, user);
}

function routeOpenToAny(path: string): boolean {
  return (
    path === "/register" ||
    path === "/family" ||
    path === "/reserve" ||
    path === "/price-lists" ||
    path === "/schools" ||
    path === "/roster" ||
    path.startsWith("/contracts/")
  );
}

function knownPublicRoute(path: string): boolean {
  return path === "/" || path === "/index.html" || path === "" || path.startsWith("/sign/");
}

async function renderProtected(
  root: HTMLElement,
  path: string,
  query: URLSearchParams,
  user: SessionUser
): Promise<void> {
  clearChildren(root);
  root.appendChild(buildTopBar(user));
  const main = h("main", { class: "page", id: "main" });
  root.appendChild(main);
  const ctx: RenderContext = { root: main, path, query, user };

  if (path === "/register") return renderRegister(ctx);
  if (path === "/family") return renderFamily(ctx);
  if (path === "/reserve") return renderReserve(ctx);
  if (path.startsWith("/contracts/")) return renderContractSheet(ctx);
  if (path === "/price-lists") return renderPriceLists(ctx);
  if (path === "/schools") return renderSchools(ctx);
  if (path === "/roster") return renderRoster(ctx);
  // Unknown route: the role's home.
  return renderProtected(root, roleHome(user), new URLSearchParams(), user);
}

window.addEventListener("popstate", () => {
  void route();
});

const originalPushState = history.pushState.bind(history);
history.pushState = ((...args: Parameters<typeof originalPushState>) => {
  originalPushState(...args);
  document.dispatchEvent(new CustomEvent("bellroll:navigate"));
}) as typeof history.pushState;
