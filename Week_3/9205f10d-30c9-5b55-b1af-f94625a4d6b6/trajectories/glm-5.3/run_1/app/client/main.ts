import { api, homeFor, navigate, parseRoute, type User } from "./api.js";
import { renderRoute, renderShell, setViewer } from "./screens.js";

async function boot(): Promise<void> {
  window.addEventListener("hashchange", async () => {
    const { path, query } = parseRoute();
    const full = query.toString() ? `${path}?${query.toString()}` : path;
    // the viewer may have changed (sign in/out); re-read
    let me: User | null = null;
    try {
      const out = await api<{ user: User }>("GET", "/api/me");
      me = out.user;
    } catch {
      me = null;
    }
    setViewer(me);
    if (!me && path !== "/signin") {
      navigate("/signin");
      return;
    }
    renderShell(path === "/signin" ? (me ? homeFor(me.role) : "/signin") : full);
  });

  let me: User | null = null;
  try {
    const out = await api<{ user: User }>("GET", "/api/me");
    me = out.user;
  } catch {
    me = null;
  }
  setViewer(me);
  const { path, query } = parseRoute();
  if (!me) {
    if (path !== "/signin") {
      navigate("/signin");
      return;
    }
    renderShell("/signin");
    return;
  }
  if (path === "/" || path === "/signin") {
    navigate(homeFor(me.role));
    return;
  }
  renderShell(query.toString() ? `${path}?${query.toString()}` : path);
}

// Escape closes the job detail pane and returns focus to the row that opened it.
window.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  const pane = document.querySelector(".pane");
  const dialog = document.querySelector("dialog[open]");
  if (dialog) return; // dialog handles its own Escape
  if (!pane || !pane.isConnected) return;
  const isStatic = pane.getAttribute("style")?.includes("static");
  if (isStatic) return; // full-page job detail has no opener to return to
  const opener = (document.activeElement && pane.contains(document.activeElement))
    ? null
    : (document.querySelector(".row-button:focus") as HTMLElement | null);
  pane.remove();
  // remember the row that opened the pane via its aria-label
  const lastLabel = window.sessionStorage.getItem("crosshand-last-row");
  const target = opener
    ?? (lastLabel ? document.querySelector(`[aria-label="${CSS.escape(lastLabel)}"]`) as HTMLElement | null : null);
  if (target && target.isConnected) {
    target.focus();
  } else {
    const page = document.getElementById("page");
    (page?.querySelector("h1") as HTMLElement | null)?.focus();
  }
});

// Track the row that opened the pane so Escape can restore focus to it.
document.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement | null;
  if (!target) return;
  const row = target.closest(".row-button") as HTMLElement | null;
  if (row?.getAttribute("aria-label")) {
    window.sessionStorage.setItem("crosshand-last-row", row.getAttribute("aria-label") as string);
  }
});

void boot();
