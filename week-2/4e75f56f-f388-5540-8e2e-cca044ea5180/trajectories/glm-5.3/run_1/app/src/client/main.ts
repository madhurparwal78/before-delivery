import { el, clear, openDialog } from "./ui.js";
import { state, refreshBenches, refreshContent, refreshMe, subscribe } from "./state.js";
import { buildSite, CHAPTERS, type SiteHandle } from "./site.js";
import { buildAccount } from "./account.js";
import { buildDesk } from "./desk.js";
import { buildContentDesk } from "./contentdesk.js";
import { buildCheckin } from "./checkin.js";

/**
 * The app shell: routes the five served paths, owns the chapter rail, the
 * reserve bar and the two-second poll that keeps every surface in step with
 * the server.
 */

let site: SiteHandle | null = null;
let pollTimer = 0;

function isMobile(): boolean {
  return window.innerWidth < 768;
}

function buildRail(): void {
  const rail = document.getElementById("chapter-rail")!;
  if (!site || isMobile()) {
    rail.hidden = true;
    return;
  }
  rail.hidden = false;
  clear(rail);
  for (const chapter of CHAPTERS) {
    const link = el(
      "a",
      { href: `#${chapter.id}`, "data-chapter": chapter.id },
      el("span", { class: "no num" }, chapter.no),
      el("span", {}, chapter.name),
      el("span", { class: "tick", "aria-hidden": "true" })
    );
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = document.getElementById(chapter.id);
      target?.scrollIntoView({ behavior: "smooth" });
      window.setTimeout(() => {
        document.getElementById(`${chapter.id}-heading`)?.focus();
      }, 350);
    });
    rail.append(el("li", {}, link));
  }
}

function updateRail(): void {
  if (!site || isMobile()) return;
  const rail = document.getElementById("chapter-rail")!;
  const links = Array.from(rail.querySelectorAll<HTMLAnchorElement>("a"));
  let current: string | null = null;
  let best = 0;
  for (const link of links) {
    const section = document.getElementById(link.dataset.chapter!);
    if (!section) continue;
    const rect = section.getBoundingClientRect();
    const visible = Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top);
    if (visible > best) {
      best = visible;
      current = link.dataset.chapter!;
    }
  }
  for (const link of links) {
    if (link.dataset.chapter === current) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
}

function openMenuDialog(opener: HTMLElement): void {
  openDialog({
    label: "Chapters",
    opener,
    build: (dialog) => {
      const wrap = el("div", {});
      wrap.append(el("h2", {}, "Chapters"));
      const close = el("button", { class: "btn btn-quiet", style: "margin-bottom:1rem" }, "Close menu");
      close.addEventListener("click", () => dialog.close());
      wrap.append(close);
      const list = el("nav", { "aria-label": "Chapters" });
      for (const chapter of CHAPTERS) {
        const link = el("a", { href: `#${chapter.id}`, style: "display:block;padding:0.6rem 0;color:var(--bone);text-decoration:none" },
          el("span", { class: "no num", style: "margin-right:0.6rem" }, chapter.no),
          chapter.name);
        link.addEventListener("click", (event) => {
          event.preventDefault();
          dialog.close();
          document.getElementById(chapter.id)?.scrollIntoView({ behavior: "smooth" });
          window.setTimeout(() => {
            document.getElementById(`${chapter.id}-heading`)?.focus();
          }, 350);
        });
        list.append(link);
      }
      wrap.append(list);
      return wrap;
    },
  });
}

function renderHeader(): void {
  const headerBar = document.getElementById("reserve-bar")!;
  if (!site || isMobile()) {
    headerBar.hidden = true;
    return;
  }
  headerBar.hidden = false;
  clear(headerBar);
  const benches = state.benches;
  const seats = el("span", { class: "seats" },
    el("strong", { class: "num" }, String(benches?.seats_remaining ?? "…")),
    " of 24 seats remaining"
  );
  const reserve = el("button", { class: "btn btn-live", id: "reserve" }, "Reserve a bench");
  reserve.addEventListener("click", () => {
    document.getElementById("chapter-lab")?.scrollIntoView({ behavior: "smooth" });
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(".bench-btn[tabindex='0']")?.focus();
    }, 350);
  });
  headerBar.append(seats, reserve);
}

async function boot(): Promise<void> {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const main = document.getElementById("main")!;
  clear(main);

  await Promise.all([refreshMe(), refreshBenches(), refreshContent()]);

  const known = ["/", "/account", "/desk", "/desk/content", "/checkin"];
  if (!known.includes(path)) {
    const notfound = el("div", { class: "notfound" },
      el("h1", { class: "chapter-title" }, "This page is not on the programme"),
      el("p", { class: "lede" }, "Head back to the lab and pick a bench."),
      el("a", { class: "btn btn-live", href: "/" }, "Back to the overture")
    );
    main.append(notfound);
    document.getElementById("reserve-bar")!.hidden = true;
    document.getElementById("reserve-bar-docked")!.hidden = true;
    document.getElementById("chapter-rail")!.hidden = true;
    return;
  }

  if (path === "/") {
    const docked = document.getElementById("reserve-bar-docked")!;
    site = buildSite(docked);
    main.append(site.root);
    buildRail();
    renderHeader();
    updateRail();
    window.addEventListener("scroll", updateRail, { passive: true });
    window.addEventListener("resize", () => {
      buildRail();
      renderHeader();
      updateRail();
    });
    document.getElementById("menu-btn")!.addEventListener("click", (event) => {
      openMenuDialog(event.currentTarget as HTMLElement);
    });
    site.lab.refresh();
  } else {
    document.getElementById("reserve-bar")!.hidden = true;
    document.getElementById("reserve-bar-docked")!.hidden = true;
    document.getElementById("chapter-rail")!.hidden = true;
    if (path === "/account") {
      buildAccount(main as HTMLElement);
    } else if (path === "/desk") {
      buildDesk(main as HTMLElement);
    } else if (path === "/desk/content") {
      buildContentDesk(main as HTMLElement);
    } else if (path === "/checkin") {
      buildCheckin(main as HTMLElement);
    }
  }

  // The poll: every surface reflects any change within two seconds.
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(async () => {
    await Promise.all([refreshBenches(), refreshMe(), refreshContent()]);
    if (site) {
      site.lab.refresh();
      site.refreshContent();
      renderHeader();
      updateRail();
    }
  }, 2000);

  subscribe(() => {
    if (site) {
      site.lab.refresh();
      site.refreshContent();
      renderHeader();
    }
  });
}

boot();
