// Client entry: session bootstrap, routing, and the app shell.
import { api, type User, type EventObj, type RotaHeat } from "./api.js";
import { h, statusLabels } from "./ui.js";
import { renderSignIn, renderJoin } from "./screens/auth.js";
import { renderEvents, renderEventOverview } from "./screens/event.js";
import { renderTiming } from "./screens/timing.js";
import { renderRota } from "./screens/rota.js";
import { renderLive } from "./screens/live.js";
import { renderProtests, renderCorrections, renderPublish } from "./screens/protests.js";
import { renderIndexTables, renderSeason } from "./screens/tables.js";
import { renderOperator } from "./screens/operator.js";

interface Route {
  pattern: RegExp;
  render: (params: string[]) => Promise<void>;
}

const routes: Route[] = [
  { pattern: /^\/signin$/, render: async () => void (await renderSignIn()) },
  { pattern: /^\/join\/([a-z0-9-]+)$/, render: async (m) => void (await renderJoin(m[0])) },
  { pattern: /^\/events$/, render: async () => void (await renderEvents()) },
  { pattern: /^\/events\/([^/]+)$/, render: async (m) => void (await renderEventOverview(m[0])) },
  { pattern: /^\/events\/([^/]+)\/timing$/, render: async (m) => void (await renderTiming(m[0])) },
  { pattern: /^\/events\/([^/]+)\/rota$/, render: async (m) => void (await renderRota(m[0])) },
  { pattern: /^\/events\/([^/]+)\/live$/, render: async (m) => void (await renderLive(m[0])) },
  { pattern: /^\/events\/([^/]+)\/protests$/, render: async (m) => void (await renderProtests(m[0])) },
  { pattern: /^\/events\/([^/]+)\/corrections$/, render: async (m) => void (await renderCorrections(m[0])) },
  { pattern: /^\/events\/([^/]+)\/publish$/, render: async (m) => void (await renderPublish(m[0])) },
  { pattern: /^\/index-tables$/, render: async () => void (await renderIndexTables()) },
  { pattern: /^\/season$/, render: async () => void (await renderSeason()) },
  { pattern: /^\/operator$/, render: async () => void (await renderOperator()) },
];

export interface AppState {
  user: User | null;
}

export const state: AppState = { user: null };

export async function navigate(path: string): Promise<void> {
  if (path !== location.pathname) history.pushState(null, "", path);
  await render();
}

export async function render(): Promise<void> {
  const currentPath = location.pathname;
  for (const route of routes) {
    const match = currentPath.match(route.pattern);
    if (match) {
      try {
        await route.render(match.slice(1));
      } catch (e) {
        if ((e as { status?: number }).status === 401) {
          await renderSignIn();
          return;
        }
        throw e;
      }
      return;
    }
  }
  if (state.user) {
    await navigate(state.user.roles.includes("operator") ? "/operator" : "/events");
  } else {
    await renderSignIn();
  }
}

window.addEventListener("popstate", () => void render());

export async function boot(): Promise<void> {
  try {
    const session = await api.get<{ user: User }>("/api/session");
    state.user = session.user;
  } catch {
    state.user = null;
  }
  await render();
}

/** The shared shell: top bar, optional left rail of heats, content area. */
export async function shell(content: HTMLElement, options: { eventId?: string } = {}): Promise<void> {
  const root = document.getElementById("root") as HTMLElement;
  root.textContent = "";

  if (!state.user) {
    root.appendChild(content);
    return;
  }

  const app = h("div", { class: "app-shell" });

  const topbar = h("div", { class: "topbar" });
  const brand = h("a", { class: "brand", href: "#", text: "Conecount Paddock", onclick: (e: Event) => { e.preventDefault(); void navigate(state.user?.roles.includes("operator") ? "/operator" : "/events"); } });
  topbar.appendChild(brand);

  const currentPath = location.pathname;
  const nav = h("nav", null);
  if (state.user.roles.includes("operator")) {
    nav.appendChild(navLink("/operator", "Operator", currentPath === "/operator"));
  } else {
    nav.appendChild(navLink("/events", "Events", currentPath === "/events"));
    nav.appendChild(navLink("/season", "Season", currentPath === "/season"));
    nav.appendChild(navLink("/index-tables", "Index tables", currentPath === "/index-tables"));
  }
  topbar.appendChild(nav);

  const signOut = h("button", {
    text: "Sign out",
    onclick: async () => {
      await api.del("/api/session");
      state.user = null;
      await navigate("/signin");
    },
  });
  topbar.appendChild(signOut);
  app.appendChild(topbar);

  const main = h("div", { class: "main" });

  if (options.eventId) {
    try {
      const event = (await api.get<{ event: EventObj }>(`/api/events/${options.eventId}`)).event;
      const layout = h("div", { class: "event-layout" });
      const rota = (await api.get<{ heats: RotaHeat[] }>(`/api/events/${options.eventId}/rota`)).heats;

      if (event.status === "running") {
        const strip = h("div", { class: "live-strip", role: "status", "aria-label": "Live heat", text: `Heat ${event.runningHeat} running` });
        app.insertBefore(strip, topbar);
      }

      const rail = h("aside", { class: "left-rail" });
      const railNav = h("nav", { "aria-label": "Heats" });
      for (const heat of event.heats) {
        const info = rota.find((r) => r.number === heat.number);
        const open = info ? info.unfilled : 0;
        const item = h("a", { class: "rail-item", href: `#/events/${event.id}/rota`, onclick: (e: Event) => { e.preventDefault(); void navigate(`/events/${event.id}/rota`); } });
        item.appendChild(h("div", { class: "heat-link", text: `Heat ${heat.number}` }));
        item.appendChild(h("div", { class: "classes", text: heat.classes.join(", ") }));
        item.appendChild(h("div", { class: "count", text: `${open} ${open === 1 ? "station" : "stations"} open` }));
        railNav.appendChild(item);
      }
      rail.appendChild(railNav);
      layout.appendChild(rail);

      // Under 1024px the rail becomes a combobox with the same information.
      const comboWrap = h("div", { class: "heat-combobox" });
      const combo = document.createElement("select");
      combo.setAttribute("aria-label", "Heat");
      for (const heat of event.heats) {
        const option = document.createElement("option");
        option.value = String(heat.number);
        option.textContent = `Heat ${heat.number}`;
        if (heat.number === 1) option.selected = true;
        combo.appendChild(option);
      }
      const comboInfo = h("div", null);
      const drawHeatInfo = (heatNumber: number) => {
        const heat = event.heats.find((hh) => hh.number === heatNumber);
        const info = rota.find((r) => r.number === heatNumber);
        const open = info ? info.unfilled : 0;
        comboInfo.textContent = "";
        if (heat) comboInfo.appendChild(h("div", { class: "classes", text: heat.classes.join(", ") }));
        comboInfo.appendChild(h("div", { class: "count", text: `${open} ${open === 1 ? "station" : "stations"} open` }));
        const section = document.getElementById(`heat-${heatNumber}`);
        if (section) section.scrollIntoView({ block: "start" });
      };
      combo.addEventListener("change", () => drawHeatInfo(Number(combo.value)));
      drawHeatInfo(1);
      comboWrap.appendChild(combo);
      comboWrap.appendChild(comboInfo);

      layout.appendChild(h("div", { class: "content" }, comboWrap, content));
      main.appendChild(layout);
    } catch {
      main.appendChild(h("div", { class: "content" }, content));
    }
  } else {
    main.appendChild(h("div", { class: "content" }, content));
  }

  app.appendChild(main);
  root.appendChild(app);
}

function navLink(path: string, label: string, current: boolean): HTMLElement {
  return h("a", {
    href: `#${path}`,
    text: label,
    "aria-current": current ? "page" : null,
    onclick: (e: Event) => {
      e.preventDefault();
      void navigate(path);
    },
  });
}

/** Event section navigation shown on every event screen. */
export function eventSectionsNav(event: EventObj, current: string): HTMLElement {
  const roles = state.user?.roles ?? [];
  const canTime = roles.includes("chair") || roles.includes("timing");
  const canPublish = roles.includes("chair");
  const links: [string, string, boolean][] = [["Overview", `/events/${event.id}`, current === "overview"]];
  if (canTime) links.push(["Timing", `/events/${event.id}/timing`, current === "timing"]);
  links.push(["Rota", `/events/${event.id}/rota`, current === "rota"]);
  links.push(["Live results", `/events/${event.id}/live`, current === "live"]);
  links.push(["Protests", `/events/${event.id}/protests`, current === "protests"]);
  links.push(["Corrections", `/events/${event.id}/corrections`, current === "corrections"]);
  if (canPublish) links.push(["Publish", `/events/${event.id}/publish`, current === "publish"]);
  const nav = h("nav", { "aria-label": "Event sections" });
  for (const [label, path, isCurrent] of links) {
    nav.appendChild(h("a", {
      href: `#${path}`,
      text: label,
      "aria-current": isCurrent ? "page" : null,
      onclick: (e: Event) => {
        e.preventDefault();
        void navigate(path);
      },
    }));
  }
  return nav;
}

export { statusLabels };
boot();
