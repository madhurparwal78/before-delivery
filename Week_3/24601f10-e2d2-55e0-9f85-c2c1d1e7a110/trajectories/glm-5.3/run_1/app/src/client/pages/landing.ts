import { api, el, navigate, state, clear, appEl } from "../app.js";
import { FORMATS, fillTile } from "../objects.js";
import type { TournamentFormat } from "../../shared/types.js";

let chosen: TournamentFormat = "single_elimination";

export async function renderLanding(): Promise<() => void> {
  document.title = "Cupfold";
  const app = appEl();
  clear(app);
  const isPhone = window.innerWidth < 768;
  const signedIn = state.username !== null;

  const tileHost = el("div", {});
  const redrawTile = (): void => {
    clear(tileHost);
    tileHost.appendChild(fillTile(chosen));
  };
  redrawTile();

  const namesHost = el("div", { class: "format-names", attrs: { role: "tablist", "aria-label": "Formats" } });
  const order: TournamentFormat[] = ["single_elimination", "double_elimination", "round_robin", "swiss"];
  const sizes = [56, 44, 34, 26];
  order.forEach((f, i) => {
    const btn = el("button", {
      class: "format-name",
      role: "tab",
      ariaSelected: f === chosen ? "true" : "false",
      attrs: { style: `font-size:${sizes[i]}px`, "aria-controls": "format-panel" },
      on: { click: () => { chosen = f; renderLanding(); } },
    }, [FORMATS[f].name]);
    namesHost.appendChild(btn);
  });

  const panel = el("div", { attrs: { role: "tabpanel", id: "format-panel" } }, [tileHost]);

  app.appendChild(
    el("main", { class: "hero" }, [
      el("div", { class: "stack" }, [
        el("h1", { class: "wordmark" }, ["Cupfold"]),
        el("p", { class: "tagline" }, ["A bracket desk for the one volunteer who runs a local cup."]),
      ]),
      el("div", { class: "stack" }, [
        el("div", { class: "stack hero-right" }, [
          isPhone ? null : el("div", { class: "spread", attrs: { style: "align-items:flex-start" } }, [
            el("div", { class: "grow" }, [namesHost]),
            panel,
          ]),
          isPhone ? namesHost : null,
          isPhone ? panel : null,
          el("p", { class: "fact" }, [FORMATS[chosen].fact]),
          el("div", { class: "row" }, [
            el("a", { href: "/t/new", class: "btn" }, ["Start a tournament"]),
          ]),
          el("div", { class: "row small" }, [
            signedIn
              ? el("a", { href: "/t" }, ["Your tournaments"])
              : el("a", { href: "/signin" }, ["Sign in"]),
            !signedIn ? el("span", { class: "muted" }, ["or "]) : null,
            !signedIn ? el("a", { href: "/signup" }, ["Create account"]) : null,
            signedIn
              ? el("button", {
                  class: "linklike",
                  on: { click: async () => { await api("POST", "/api/auth/signout"); state.username = null; navigate("/"); } },
                }, ["Sign out"])
              : null,
          ]),
        ]),
      ]),
    ])
  );
  return () => {};
}
