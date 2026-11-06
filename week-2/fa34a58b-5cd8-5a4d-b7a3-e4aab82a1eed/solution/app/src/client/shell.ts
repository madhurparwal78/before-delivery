// The frame every page shares: rail (column or drawer), header with hub time, banners, live regions.

import { h, setNum } from "./dom.ts";
import { icon, type IconName } from "./icons.ts";
import { live } from "./live.ts";
import { useUnreachableAlert } from "./api.ts";
import { Sheet } from "./sheets.ts";

const NAV: { path: string; label: string; icon: IconName }[] = [
  { path: "/plan", label: "Plan", icon: "house" },
  { path: "/schedules", label: "Schedules", icon: "layers" },
  { path: "/scenes", label: "Scenes", icon: "palette" },
  { path: "/guests", label: "Guests", icon: "user-round-check" },
  { path: "/log", label: "Day log", icon: "scroll-text" },
  { path: "/notices", label: "Notices", icon: "mail" },
];

const STORAGE_BANNER = "Clip storage is unreachable. New clips wait as 'Storing clip…' until it is back.";

function brandMark(): HTMLElement {
  return h("span", { class: "brand-mark", "aria-hidden": "true" }, icon("house"));
}

export interface Shell {
  main: HTMLElement;
  planTime: HTMLElement;
}

export function buildShell(page: string): Shell {
  const body = document.body;

  const closeRail = h("button", { class: "btn btn-quiet rail-close", type: "button" }, "Close");
  const nav = h(
    "nav",
    { class: "rail-nav", "aria-label": "Nightplan" },
    h("ul", {}, ...NAV.map((item) =>
      h("li", {}, h("a", {
        href: item.path, class: "rail-link", "aria-current": location.pathname === item.path ? "page" : null,
      }, icon(item.icon), h("span", {}, item.label))),
    )),
  );
  const rail = h(
    "div",
    { class: "rail", id: "rail" },
    h("div", { class: "rail-top" }, h("p", { class: "brand" }, brandMark(), h("span", {}, "Gablework Nightplan")), closeRail),
    nav,
  );
  body.append(rail);
  const drawer = new Sheet({ element: rail, label: "Menu", onlyWhen: window.matchMedia("(max-width: 1023.98px)"), className: "drawer" });
  closeRail.addEventListener("click", () => drawer.close());

  const menu = h("button", { class: "btn btn-quiet menu-button", type: "button" }, icon("menu"), h("span", {}, "Menu"));
  menu.addEventListener("click", () => drawer.open(menu));
  const hubTime = h("p", { class: "hub-time" });
  const offline = h("span", { class: "offline-tag" }, "Live updates paused");
  const header = h(
    "header",
    { class: "top" },
    menu,
    h("p", { class: "brand brand-compact" }, brandMark(), h("span", {}, "Nightplan")),
    h("div", { class: "top-end" }, offline, hubTime),
  );
  body.append(header);

  const storage = h("div", { class: "banner", role: "alert", hidden: true });
  const unreachable = h("div", { class: "banner", role: "alert", hidden: true });
  useUnreachableAlert(unreachable);
  body.append(h("div", { class: "banners", "data-never-inert": "" }, storage, unreachable));

  const main = h("main", { id: "main", class: `main page-${page}` });
  body.append(main);

  const region = (name: string) => h("div", { role: "status", "aria-label": name, "aria-live": "polite", class: "visually-hidden" });
  const devices = region("Device updates");
  const scenes = region("Scene changes");
  const connection = region("Connection");
  const planTime = region("Plan time");
  body.append(h("div", { class: "announcements", "data-never-inert": "" }, devices, scenes, connection, page === "plan" ? planTime : null));
  live.useRegions({ devices, scenes, connection });

  const paint = () => {
    const now = live.status.now;
    setNum(hubTime, `Hub time ${now.slice(11, 16)} ${live.zone.abbr(Date.parse(now))}`);
    const down = live.status.services.storage === "down";
    storage.hidden = !down;
    storage.textContent = down ? STORAGE_BANNER : "";
  };
  paint();
  live.on("status", paint);
  return { main, planTime };
}
