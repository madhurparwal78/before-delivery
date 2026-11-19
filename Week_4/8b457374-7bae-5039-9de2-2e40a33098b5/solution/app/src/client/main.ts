import type { ServiceStatus } from "../shared/api.js";
import { api, whenUnavailable } from "./api.js";
import { h } from "./dom.js";
import { campaignPage } from "./pages/campaign.js";
import { editorPage } from "./pages/editor.js";
import { fixPage } from "./pages/fix.js";
import { homePage } from "./pages/home.js";
import { notFoundPage } from "./pages/notfound.js";
import { pledgesPage } from "./pages/pledges.js";
import { studioPage } from "./pages/studio.js";
import { setNavigator, type Page } from "./page.js";

// The shell every screen shares: header, service notice banners and a small router (brief: Screens and layout).

const BANNERS: Record<keyof ServiceStatus, string> = {
  payments: "Payments are unavailable. New pledges and changes are paused; held cards are safe.",
  email: "Email is delayed. Notices are queued and will be sent when the mail service is back.",
  storage: "Media storage is unavailable. Uploads and statements are paused.",
  documents: "Statements are delayed. They will appear once they are rendered.",
};

const root = document.getElementById("app") as HTMLElement;
const notices = h("div", { class: "notices" });
const main = h("main", { id: "main", tabindex: "-1" });
const header = h("header", { class: "site-header" },
  h("a", { href: "/", class: "wordmark", "aria-label": "Dotgain" }, "DOTGAIN"),
  h("nav", { "aria-label": "Main" },
    h("a", { href: "/#live" }, "Campaigns"),
    h("a", { href: "/pledges" }, "My pledges"),
    h("a", { href: "/studio" }, "Studio")));
root.append(h("a", { href: "#main", class: "skip" }, "Skip to content"), header, notices, main);

// Full-bleed bands break out of their column to the page width without counting the scrollbar.
const pageWidth = () => document.documentElement.style.setProperty("--page-w", `${document.documentElement.clientWidth}px`);
pageWidth();
new ResizeObserver(pageWidth).observe(document.documentElement);

let shownBanners = "";

async function refreshStatus(): Promise<void> {
  const found = await api<ServiceStatus>("GET", "/api/status", { key: null });
  if (!found.ok) return;
  const down = (Object.keys(BANNERS) as (keyof ServiceStatus)[]).filter((service) => found.data[service] === "down");
  const signature = down.join(",");
  if (signature === shownBanners) return;
  shownBanners = signature;
  notices.replaceChildren(...(down.length
    ? [h("section", { class: "banners", "aria-label": "Service notice" }, ...down.map((service) => h("p", { class: "banner" }, BANNERS[service])))]
    : []));
}

whenUnavailable(() => void refreshStatus());
void refreshStatus();
setInterval(() => void refreshStatus(), 15_000);

const ROUTES: [RegExp, Page][] = [
  [/^\/$/, homePage],
  [/^\/campaigns\/([A-Za-z0-9_-]+)$/, campaignPage],
  [/^\/studio$/, studioPage],
  [/^\/studio\/campaigns\/([A-Za-z0-9_-]+)$/, editorPage],
  [/^\/pledges$/, pledgesPage],
  [/^\/fix\/([A-Za-z0-9_-]+)$/, fixPage],
];

let leave: (() => void)[] = [];

function render(): void {
  for (const done of leave) done();
  leave = [];
  main.replaceChildren();
  const path = location.pathname;
  for (const [pattern, page] of ROUTES) {
    const match = pattern.exec(path);
    if (match) {
      page(main, match[1] ?? "", (done) => leave.push(done));
      return;
    }
  }
  notFoundPage(main, "", (done) => leave.push(done));
}

function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  scrollTo({ top: 0, behavior: "instant" });
  render();
}

setNavigator(navigate);

document.addEventListener("click", (event) => {
  const link = (event.target as Element | null)?.closest("a");
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (link.origin !== location.origin || link.hasAttribute("download") || link.target) return;
  if (link.pathname === location.pathname && link.hash) {
    const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (target) {
      event.preventDefault();
      target.scrollIntoView({ block: "center", behavior: "instant" });
      target.focus();
    }
    return;
  }
  event.preventDefault();
  navigate(link.pathname + link.search + link.hash);
});

addEventListener("popstate", render);
render();
