// Router: renders the right screen for the path, sending users to their role
// landing when they open a screen they cannot use (DP-48).

import { apiJson } from "./lib/api.js";
import { clear } from "./lib/dom.js";
import { loadUser, roleLanding, type AppCtx } from "./lib/shell.js";
import { renderApply, renderSignIn } from "./pages/auth.js";
import { renderBoard } from "./pages/board.js";
import { renderKitchen } from "./pages/kitchen.js";
import { renderOperator } from "./pages/operator.js";
import { renderShift } from "./pages/shift.js";
import { renderShare } from "./pages/share.js";

const root = (): HTMLElement => document.getElementById("root") as HTMLElement;

let todayCache = "";

const today = async (): Promise<string> => {
  if (todayCache) return todayCache;
  try {
    const data = await apiJson<{ date: string }>("/api/stations");
    todayCache = data.date;
  } catch {
    todayCache = "";
  }
  return todayCache;
};

export const boot = async (): Promise<void> => {
  const mount = root();
  const navigate = (path: string, replace = false): void => {
    if (replace) window.history.replaceState({}, "", path);
    else window.history.pushState({}, "", path);
    void render();
  };
  window.addEventListener("popstate", () => {
    void render();
  });

  const render = async (): Promise<void> => {
    const path = window.location.pathname;
    const user = await loadUser();
    const todayValue = await today();
    window.__railsideToday = todayValue;

    if (path.startsWith("/share/")) {
      clear(mount);
      renderShare(mount, window.location.pathname);
      return;
    }

    if (!user) {
      if (path === "/apply") {
        clear(mount);
        renderApply(mount, navigate);
        return;
      }
      if (path !== "/") {
        navigate("/", true);
        return;
      }
      clear(mount);
      renderSignIn(mount, navigate);
      return;
    }

    // Signed in: "/" goes to the role landing.
    if (path === "/") {
      navigate(roleLanding(user), true);
      return;
    }

    const ctx: AppCtx = { user, navigate, today: todayValue, rerender: render };
    clear(mount);

    const allowed =
      path === "/board" ||
      (path === "/kitchen" && user.role === "renter") ||
      (path === "/operator" && user.role === "operator") ||
      (path === "/shift" && (user.role === "operator" || user.role === "shift_lead"));

    if (!allowed) {
      navigate(roleLanding(user), true);
      return;
    }

    if (path === "/board") {
      await renderBoard(mount, ctx);
      return;
    }
    if (path === "/kitchen") {
      await renderKitchen(mount, ctx);
      return;
    }
    if (path === "/operator") {
      await renderOperator(mount, ctx);
      return;
    }
    if (path === "/shift") {
      await renderShift(mount, ctx);
      return;
    }
    navigate(roleLanding(user), true);
  };

  await render();
};

void boot();
