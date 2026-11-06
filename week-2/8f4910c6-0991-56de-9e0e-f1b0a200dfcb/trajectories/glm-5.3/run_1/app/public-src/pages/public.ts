import { api, el, link, button, announce, type Page, register, liveRegion, queryParams } from "../pages.js";
import { ApiFail } from "../lib.js";
import { readTray, writeTray } from "../stores.js";
import { formatReach, formatHeight, formatGirth } from "../../shared/format.js";
import { BOARD_TITLES } from "../../shared/domain.js";

const isPhone = (): boolean => window.matchMedia("(max-width: 480px)").matches;

interface Card {
  slug: string;
  displayName: string;
  office: string;
  board: string;
  measurements: { heightCm: number | null; chestCm: number | null; waistCm: number | null; hipsCm: number | null };
  reach: { instagram: number; tiktok: number; youtube: number; total: number };
  coverPhotoUrl: string | null;
}

function boardHref(board: string, params: Record<string, string>): string {
  const all: Record<string, string> = { office: "all", q: "", sort: "name", unit: "cm", page: "1", ...params };
  const search = new URLSearchParams();
  for (const key of Object.keys(all)) search.set(key, all[key]);
  return `/boards/${board}?${search.toString()}`;
}

/** Board index with the mouse-following cover preview. */
const boardIndex: Page = {
  path: "/boards",
  title: () => "Boards",
  render: async (main) => {
    const data = (await api("/api/public/boards")) as { boards: Array<{ board: string; title: string; count: number; coverPhotoUrl: string | null }> };
    const heading = el("h1", undefined, "Boards");
    main.appendChild(heading);
    const rows = el("div", "board-rows");
    const preview = document.createElement("img");
    preview.className = "board-preview";
    preview.alt = "";
    let currentBoard: string | null = null;
    for (const b of data.boards) {
      const row = link(boardHref(b.board, {}), "", "board-row");
      const title = el("span", "board-title", b.title);
      const label = el("span", "eyebrow", `${b.count} talent`);
      const count = el("span", "count", String(b.count));
      row.append(title, label, count);
      row.setAttribute("data-nav", "");
      row.addEventListener("mousemove", (event) => {
        if ((event as PointerEvent).pointerType && (event as PointerEvent).pointerType !== "mouse") return;
        if (!b.coverPhotoUrl) return;
        if (currentBoard !== b.board) {
          preview.src = b.coverPhotoUrl;
          currentBoard = b.board;
        }
        preview.style.opacity = "1";
        preview.style.left = `${event.clientX + 24}px`;
        preview.style.top = `${event.clientY + 24}px`;
      });
      row.addEventListener("mouseleave", () => {
        preview.style.opacity = "0";
        currentBoard = null;
      });
      row.addEventListener("click", (event) => {
        if ((event as PointerEvent).pointerType === "touch" || (event as PointerEvent).pointerType === "pen") return;
      });
      rows.appendChild(row);
    }
    main.append(rows, preview);
  },
};

register(boardIndex);

/** Board listing with search, office, sort, unit and page all in the address. */
const boardListing: Page = {
  path: "/boards/:board",
  title: () => "Board",
  render: async (main, params) => {
    const board = location.pathname.split("/")[2] || "women";
    const data = (await api(`/api/public/talent?board=${board}&office=${params.get("office") || "all"}&q=${encodeURIComponent(params.get("q") || "")}&sort=${params.get("sort") || "name"}&page=${params.get("page") || "1"}`)) as { page: number; total: number; totalPages: number; talent: Card[] };
    main.textContent = "";
    const heading = el("h1", undefined, BOARD_TITLES[board as keyof typeof BOARD_TITLES] || "Board");
    main.appendChild(heading);
    const controls = el("div", "control-row");

    const searchField = el("div", "field");
    const searchLabel = el("label", undefined, "Search talent");
    const search = document.createElement("input");
    search.type = "search";
    search.setAttribute("role", "searchbox");
    search.id = "search-talent";
    searchLabel.setAttribute("for", "search-talent");
    search.value = params.get("q") || "";
    search.setAttribute("aria-label", "Search talent");
    search.addEventListener("input", () => {
      queueChange({ q: search.value });
    });
    searchField.append(searchLabel, search);

    const officeGroup = el("div");
    officeGroup.setAttribute("role", "radiogroup");
    officeGroup.setAttribute("aria-label", "Office");
    const radios: Array<[string, string]> = [["all", "All offices"], ["toronto", "Toronto"], ["vancouver", "Vancouver"]];
    for (const [value, label] of radios) {
      const id = `office-${value}`;
      const r = document.createElement("input");
      r.type = "radio";
      r.name = "office";
      r.id = id;
      r.value = value;
      r.checked = (params.get("office") || "all") === value;
      r.addEventListener("change", () => queueChange({ office: value }));
      const l = el("label", undefined, label);
      l.setAttribute("for", id);
      officeGroup.append(r, l);
    }

    const sortField = el("div", "field");
    const sortLabel = el("label", undefined, "Sort by");
    sortLabel.setAttribute("for", "sort-by");
    const sortSelect = document.createElement("select");
    sortSelect.id = "sort-by";
    sortSelect.setAttribute("aria-label", "Sort by");
    for (const [value, label] of [["name", "Name"], ["height", "Height"], ["reach", "Reach"]] as Array<[string, string]>) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      sortSelect.appendChild(o);
    }
    sortSelect.value = params.get("sort") || "name";
    sortSelect.addEventListener("change", () => queueChange({ sort: sortSelect.value }));
    sortField.append(sortLabel, sortSelect);

    const unitGroup = el("div");
    unitGroup.setAttribute("role", "radiogroup");
    unitGroup.setAttribute("aria-label", "Units");
    for (const [value, label] of [["cm", "cm"], ["ft_in", "ft and in"]] as Array<[string, string]>) {
      const id = `unit-${value}`;
      const r = document.createElement("input");
      r.type = "radio";
      r.name = "unit";
      r.id = id;
      r.value = value;
      r.checked = (params.get("unit") || "cm") === value;
      r.addEventListener("change", () => queueChange({ unit: value }));
      const l = el("label", undefined, label);
      l.setAttribute("for", id);
      unitGroup.append(r, l);
    }

    controls.append(searchField, officeGroup, sortField, unitGroup);
    if (isPhone()) {
      controls.textContent = "";
      const filters = button("Filters", () => openFiltersSheet(data.total), undefined, { "aria-haspopup": "dialog" });
      const count = el("span", undefined, `${data.total} talent`);
      controls.append(filters, count);
    }
    main.appendChild(controls);

    const grid = el("div", "grid-cards");
    for (const card of data.talent) {
      grid.appendChild(talentCard(card, params.get("unit") || "cm"));
    }
    main.appendChild(grid);

    const pages = el("nav", "pages");
    pages.setAttribute("aria-label", "Pages");
    const prev = link(boardHref(board, { page: String(Math.max(1, data.page - 1)), ...currentParams(params) }), "Previous page");
    if (data.page <= 1) prev.setAttribute("aria-disabled", "true");
    const next = link(boardHref(board, { page: String(Math.min(data.totalPages, data.page + 1)), ...currentParams(params) }), "Next page");
    if (data.page >= data.totalPages) next.setAttribute("aria-disabled", "true");
    const current = el("span", undefined, `Page ${data.page} of ${data.totalPages}`);
    pages.append(prev, current, next);
    main.appendChild(pages);
  },
};

function currentParams(params: URLSearchParams): Record<string, string> {
  return {
    office: params.get("office") || "all",
    q: params.get("q") || "",
    sort: params.get("sort") || "name",
    unit: params.get("unit") || "cm",
  };
}

let changeTimer: number | undefined;
function queueChange(changes: Record<string, string>): void {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(changes)) url.searchParams.set(key, value);
  if (!("page" in changes)) url.searchParams.set("page", "1");
  for (const key of ["office", "q", "sort", "unit", "page"]) {
    if (!url.searchParams.get(key)) url.searchParams.set(key, key === "office" ? "all" : key === "unit" ? "cm" : key === "page" ? "1" : "");
  }
  window.clearTimeout(changeTimer);
  changeTimer = window.setTimeout(() => {
    history.pushState(null, "", url.pathname + "?" + url.searchParams.toString());
    void rerenderCurrent();
  }, 250);
}

async function rerenderCurrent(): Promise<void> {
  const { go } = await import("../app.js");
  await go(location.pathname + location.search);
}

function openFiltersSheet(resultCount: number): void {
  const sheet = el("div", "sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Filters");
  const title = el("h2", undefined, "Filters");
  sheet.appendChild(title);
  const form = el("form");
  const search = document.createElement("input");
  search.type = "search";
  search.setAttribute("aria-label", "Search talent");
  search.value = queryParams().get("q") || "";
  const office = document.createElement("select");
  office.setAttribute("aria-label", "Office");
  for (const [value, label] of [["all", "All offices"], ["toronto", "Toronto"], ["vancouver", "Vancouver"]] as Array<[string, string]>) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    office.appendChild(o);
  }
  office.value = queryParams().get("office") || "all";
  const sort = document.createElement("select");
  sort.setAttribute("aria-label", "Sort by");
  for (const [value, label] of [["name", "Name"], ["height", "Height"], ["reach", "Reach"]] as Array<[string, string]>) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    sort.appendChild(o);
  }
  sort.value = queryParams().get("sort") || "name";
  const unit = document.createElement("select");
  unit.setAttribute("aria-label", "Units");
  for (const [value, label] of [["cm", "cm"], ["ft_in", "ft and in"]] as Array<[string, string]>) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    unit.appendChild(o);
  }
  unit.value = queryParams().get("unit") || "cm";
  form.append(search, office, sort, unit);
  const bar = el("div", "sticky-bar");
  const show = button(`Show ${resultCount} talent`, async () => {
    sheet.remove();
    await rerenderWith({ q: search.value, office: office.value, sort: sort.value, unit: unit.value, page: "1" });
  }, "primary");
  bar.appendChild(show);
  sheet.append(form, bar);
  document.body.appendChild(sheet);
  show.focus();
}

async function rerenderWith(changes: Record<string, string>): Promise<void> {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(changes)) url.searchParams.set(key, value);
  history.pushState(null, "", url.pathname + "?" + url.searchParams.toString());
  await rerenderCurrent();
}

function heightText(cm: number | null, unit: string): string {
  if (cm === null) return "";
  if (unit === "ft_in") {
    const totalIn = Math.round(cm / 2.54);
    return `${Math.floor(totalIn / 12)} ft ${totalIn % 12} in`;
  }
  return `${cm} cm`;
}

function talentCard(card: Card, unit: string): HTMLElement {
  const article = el("article", "talent-card");
  article.setAttribute("aria-label", card.displayName);
  const portrait = document.createElement("img");
  portrait.className = "portrait";
  portrait.alt = `Portrait of ${card.displayName}`;
  portrait.src = card.coverPhotoUrl || "/placeholder.svg";
  article.appendChild(portrait);
  const body = el("div", "card-body");
  const name = link(`/talent/${card.slug}?unit=${unit}`, card.displayName, "card-name");
  body.appendChild(name);
  const facts = el("div", "card-facts");
  facts.append(
    el("span", undefined, card.office === "toronto" ? "Toronto" : "Vancouver"),
    el("span", undefined, heightText(card.measurements.heightCm, unit)),
    el("span", undefined, formatReach(card.reach.total)),
  );
  body.appendChild(facts);
  const tray = readTray();
  const inTray = tray.some((t) => t.slug === card.slug);
  const add = button(inTray ? "Remove from tray" : "Add to tray", () => toggleTray(card, add, portrait));
  body.appendChild(add);
  article.appendChild(body);
  return article;
}

const trayStatus = liveRegion("tray", "Tray announcements");
document.body.appendChild(trayStatus);

function toggleTray(card: Card, btn: HTMLButtonElement, portrait: HTMLImageElement): void {
  const tray = readTray();
  const existing = tray.findIndex((t) => t.slug === card.slug);
  if (existing >= 0) {
    tray.splice(existing, 1);
    writeTray(tray);
    btn.textContent = "Add to tray";
    announce(trayStatus, `Removed ${card.displayName}. ${tray.length} in tray.`);
  } else {
    if (tray.length >= 12) {
      announce(trayStatus, "Your tray holds up to 12 talent.");
      return;
    }
    tray.push({ slug: card.slug, displayName: card.displayName, office: card.office });
    writeTray(tray);
    btn.textContent = "Remove from tray";
    announce(trayStatus, `Added ${card.displayName} to your tray. ${tray.length} in tray.`);
    flyPortrait(portrait);
  }
  refreshTrayCount();
}

function flyPortrait(portrait: HTMLImageElement): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const copy = portrait.cloneNode() as HTMLImageElement;
  copy.className = "fly-portrait";
  const start = portrait.getBoundingClientRect();
  copy.style.left = `${start.left}px`;
  copy.style.top = `${start.top}px`;
  copy.style.width = `${start.width}px`;
  copy.style.height = `${start.height}px`;
  document.body.appendChild(copy);
  const trayLink = document.querySelector('a[href="/tray"]');
  if (trayLink) {
    const end = trayLink.getBoundingClientRect();
    copy.style.transform = `translate(${end.left - start.left}px, ${end.top - start.top}px) scale(${end.width / start.width})`;
    copy.style.opacity = "0";
  }
  window.setTimeout(() => copy.remove(), 320);
}

function refreshTrayCount(): void {
  const count = readTray().length;
  const trayLink = navLink("/tray");
  if (trayLink) trayLink.textContent = `Tray ${count}`;
}

function navLink(href: string): HTMLAnchorElement | null {
  return document.querySelector(`#site-nav a[href="${href}"]`);
}

/** Public profile. */
const profile: Page = {
  path: "/talent/:slug",
  title: () => "Talent",
  render: async (main, params) => {
    const slug = location.pathname.split("/")[2];
    const unit = params.get("unit") || "cm";
    try {
      const card = (await api(`/api/public/talent/${slug}`)) as Card & { portfolio: Array<{ photoId: string; url: string; width: number; height: number }> };
      const heading = el("h1", undefined, card.displayName);
      main.appendChild(heading);
      const facts = el("p", "card-facts");
      facts.append(
        el("span", undefined, card.office === "toronto" ? "Toronto" : "Vancouver"),
        el("span", undefined, formatHeight(card.measurements.heightCm) || ""),
        el("span", undefined, formatGirth(card.measurements.chestCm) ? `Chest ${formatGirth(card.measurements.chestCm)}` : ""),
        el("span", undefined, formatGirth(card.measurements.waistCm) ? `Waist ${formatGirth(card.measurements.waistCm)}` : ""),
        el("span", undefined, formatGirth(card.measurements.hipsCm) ? `Hips ${formatGirth(card.measurements.hipsCm)}` : ""),
      );
      main.appendChild(facts);
      const reachLine = el("p");
      reachLine.append(
        `Instagram ${formatReach(card.reach.instagram)} · TikTok ${formatReach(card.reach.tiktok)} · YouTube ${formatReach(card.reach.youtube)} · Total ${formatReach(card.reach.total)}`,
      );
      main.appendChild(reachLine);
      const inTray = readTray().some((t) => t.slug === card.slug);
      const add = button(inTray ? "Remove from tray" : "Add to tray", () => toggleTray(card, add, main.querySelector("img") as HTMLImageElement));
      main.appendChild(add);
      const grid = el("div", "grid-cards");
      for (const photo of card.portfolio) {
        const figure = el("figure", "talent-card");
        const img = document.createElement("img");
        img.src = photo.url;
        img.alt = `Portfolio photo of ${card.displayName}`;
        img.className = "portrait";
        figure.appendChild(img);
        grid.appendChild(figure);
      }
      main.appendChild(grid);
      void unit;
    } catch (err) {
      if (err instanceof ApiFail && err.status === 410) {
        const box = el("section");
        box.append(el("h1", undefined, "No longer represented"), el("p", undefined, "This talent is no longer represented by Vesper & Rowe Talent."));
        main.appendChild(box);
        return;
      }
      throw err;
    }
  },
};

register(boardListing);
register(profile);
export function registerPublicPages(): void {
  // pages register themselves at module load
}

