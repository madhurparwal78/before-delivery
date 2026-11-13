import { api, state, render, setRenderRoot, route, navigate, prefersReducedMotion, clear, el, appEl, bands } from "./app.js";
import type { ApiConfig } from "../shared/types.js";
import { renderLanding } from "./pages/landing.js";
import { renderAuth } from "./pages/auth.js";
import { renderTournamentList, renderCreate } from "./pages/create.js";
import { renderSetup } from "./pages/setup.js";
import { renderBracket } from "./pages/bracket.js";

import { renderMe, renderDisputes, renderHistory, renderShare } from "./pages/me.js";


route("/", renderLanding);
route("/signup", () => renderAuth("signup"));
route("/signin", () => renderAuth("signin"));
route("/t", renderTournamentList);
route("/t/new", renderCreate);
route("/t/:id", async (p) => {
  // organizers go to /setup before start and /bracket after; everyone else to /bracket
  const t = await api<{ tournament: import("../shared/types.js").Tournament }>("GET", `/api/tournaments/${p.id}`);
  const role = t.tournament.my_role;
  if (role === "organizer" || role === "co_organizer") {
    if (t.tournament.state === "draft" || t.tournament.state === "checkin_open" || t.tournament.state === "checkin_closed") {
      navigate(`/t/${p.id}/setup`, true);
      return;
    }
    navigate(`/t/${p.id}/bracket`, true);
    return;
  }
  navigate(`/t/${p.id}/bracket`, true);
});
route("/t/:id/setup", (p) => renderSetup(p.id));
route("/t/:id/bracket", (p) => renderBracket(p.id));
route("/t/:id/disputes", (p) => renderDisputes(p.id));
route("/t/:id/me", (p) => renderMe(p.id));
route("/s/:code", (p) => renderShare(p.code));
route("/u/:username", (p) => renderHistory(p.username));

setRenderRoot(() => {
  void render();
});

window.addEventListener("popstate", () => {
  void render();
});

window.addEventListener("keydown", (ev) => {
  // Z toggles the whole bracket view on bracket and share pages
  if (ev.key.toLowerCase() === "z" && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
    const target = ev.target as HTMLElement;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
    if (document.querySelector("dialog[open]")) return;
    const btn = document.querySelector('button[data-whole-bracket]') as HTMLButtonElement | null;
    if (btn) {
      ev.preventDefault();
      btn.click();
    }
  }
});

async function boot(): Promise<void> {
  state.reducedMotion = prefersReducedMotion();
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
    state.reducedMotion = e.matches;
  });
  try {
    state.config = await api<ApiConfig>("GET", "/api/config");
  } catch {
    state.config = {
      server_time: new Date().toISOString(),
      confirm_window_ms: 600000,
      match_limit_ms: 1800000,
      swiss_round_ms: 3000000,
      toast_ms: 4000,
      roster_max_bytes: 65536,
      logo_max_bytes: 524288,
    };
  }
  try {
    const me = await api<{ user: { username: string } }>("GET", "/api/me");
    state.username = me.user.username;
  } catch {
    state.username = null;
  }
  const app = appEl();
  clear(app);
  const bandHost = el("div", { id: "bands" });
  document.body.insertBefore(bandHost, app);
  const renderBands = (): void => {
    const host = document.getElementById("bands");
    if (!host) return;
    clear(host);
    for (const n of bands()) host.appendChild(n);
  };
  // one render per navigation, with the bands refreshed after it
  const patchRender = (): void => {
    void render().then(renderBands);
  };
  setRenderRoot(patchRender);
  patchRender();
}

void boot();
