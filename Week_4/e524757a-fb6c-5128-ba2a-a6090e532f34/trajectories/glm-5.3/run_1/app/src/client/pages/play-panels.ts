// The map and album panel, and the safari strip.

import { el, qs, qsa, announce, api, ApiCallError, setFigure, framesText, pagesText, coarsePointer } from "../ui/core";
import { islandName } from "../../shared/copy";
import { GRID, islandById, isLand } from "../../shared/world";
import { Game, AlbumsAnswer } from "./play-state";
import { walkTo } from "./play-sim";

let mapCursor: [number, number] = [3, 12];

export function openPanel(which: "map" | "album", opener?: HTMLElement): void {
  const modal = qs<HTMLElement>("#panel-modal");
  if (!modal) return;
  modal.classList.add("open");
  modal.dataset.openerId = opener?.id ?? "world-view";
  const wide = window.matchMedia("(min-width: 1200px)").matches;
  const sheet = qs<HTMLElement>("#map-album-sheet");
  if (sheet) {
    if (wide) sheet.setAttribute("role", "complementary");
    else sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-label", which === "map" ? "Map" : "Album");
  }
  if (which === "map") {
    qs<HTMLElement>("#island-map")?.focus();
  } else {
    const selected = qs<HTMLElement>("#album-tabs [aria-selected='true']");
    (selected ?? qs<HTMLElement>("#album-tabs"))?.focus();
  }
}

/** Escape or a close button returns focus to the opener; the panel closes at every width. */
export function closePanel(): void {
  const modal = qs<HTMLElement>("#panel-modal");
  if (!modal) return;
  const openerId = modal.dataset.openerId;
  modal.classList.remove("open");
  const opener = openerId ? document.getElementById(openerId) : null;
  (opener ?? qs("#world-view"))?.focus();
}

// ---------- map ----------

export function wireMap(game: Game, mapApp: HTMLElement): void {
  const draw = () => {
    mapApp.innerHTML = "";
    const size = mapApp.clientWidth || 384;
    const tileSize = Math.floor(size / GRID);
    mapApp.setAttribute("data-tile-size", String(tileSize));
    mapApp.style.position = "relative";
    mapApp.style.width = `${tileSize * GRID}px`;
    mapApp.style.height = `${tileSize * GRID}px`;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const cell = el("div", { class: "cell", "data-tile": `${x},${y}`, "aria-hidden": "true" });
        cell.style.left = `${x * tileSize}px`;
        cell.style.top = `${y * tileSize}px`;
        cell.style.width = `${tileSize}px`;
        cell.style.height = `${tileSize}px`;
        cell.style.background = terrainColor(game.island, x, y);
        mapApp.append(cell);
      }
    }
    for (const c of game.creatures.filter(c => c.island === game.island)) {
      const dot = el("div", { class: "me", title: c.name, "aria-hidden": "true" });
      dot.style.left = `${c.x * tileSize + tileSize / 4}px`;
      dot.style.top = `${c.y * tileSize + tileSize / 4}px`;
      dot.style.width = `${tileSize / 2}px`;
      dot.style.height = `${tileSize / 2}px`;
      mapApp.append(dot);
    }
    const cursor = el("div", { class: "cursor", id: "map-cursor", "aria-hidden": "true" });
    cursor.style.left = `${mapCursor[0] * tileSize}px`;
    cursor.style.top = `${mapCursor[1] * tileSize}px`;
    cursor.style.width = `${tileSize}px`;
    cursor.style.height = `${tileSize}px`;
    mapApp.append(cursor);
    mapApp.setAttribute("data-cursor", `${mapCursor[0]},${mapCursor[1]}`);
  };
  draw();

  mapApp.addEventListener("keydown", ev => {
    const [cx, cy] = mapCursor;
    switch (ev.key) {
      case "ArrowUp": mapCursor = [cx, Math.max(0, cy - 1)]; break;
      case "ArrowDown": mapCursor = [cx, Math.min(GRID - 1, cy + 1)]; break;
      case "ArrowLeft": mapCursor = [Math.max(0, cx - 1), cy]; break;
      case "ArrowRight": mapCursor = [Math.min(GRID - 1, cx + 1), cy]; break;
      case "Enter": ev.preventDefault(); walkTo(game, mapCursor); return;
      case "s": case "S": ev.preventDefault(); void markSighting(game); return;
      case "Escape": ev.preventDefault(); closePanel(); return;
      default: return;
    }
    ev.preventDefault();
    draw();
  });

  mapApp.addEventListener("click", ev => {
    const rect = mapApp.getBoundingClientRect();
    const ts = Number(mapApp.getAttribute("data-tile-size") || "16");
    const x = Math.floor((ev.clientX - rect.left) / ts);
    const y = Math.floor((ev.clientY - rect.top) / ts);
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
    mapCursor = [x, y];
    draw();
    walkTo(game, mapCursor);
  });
}

function terrainColor(island: number, x: number, y: number): string {
  if (y === 0 || x === 0 || y === GRID - 1 || x === GRID - 1) return "#2d6c8f";
  const spec = islandById(island)!;
  const p = spec.pond;
  if (x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) return "#2d6c8f";
  if (spec.rocks.some(([rx, ry]) => rx === x && ry === y)) return "#8d8a84";
  if (spec.lighthouseTile && spec.lighthouseTile[0] === x && spec.lighthouseTile[1] === y) return "#f2efe8";
  return "#69a05a";
}

async function markSighting(game: Game): Promise<void> {
  const code = safariCode;
  if (!code) return;
  try {
    const res = await api<{ sighting: { island: number; x: number; y: number; by: string } }>(
      "POST", `/api/safaris/${code}/sightings`, { island: game.island, tile: mapCursor });
    const line = `Sighting at ${res.sighting.x}, ${res.sighting.y} by ${res.sighting.by}`;
    const list = qs("#sightings-list");
    if (list) list.append(el("li", {}, line));
    announce("Safari status", line);
  } catch (err) {
    if (err instanceof ApiCallError) announce("Safari status", err.message);
  }
}

// ---------- safari ----------

let safariCode: string | null = null;

export async function startSafari(_game: Game): Promise<void> {
  try {
    const res = await api<{ safari: { code: string; status: string; host: string } }>("POST", "/api/safaris", {});
    safariCode = res.safari.code;
    announce("Safari status", "Safari started.");
    renderSafariStrip(res.safari.code, true);
  } catch (err) {
    if (err instanceof ApiCallError) announce("Safari status", err.message);
  }
}

export function renderSafariStrip(code: string, isHost: boolean): void {
  safariCode = code;
  const strip = qs<HTMLElement>("#safari-strip");
  if (!strip) return;
  strip.hidden = false;
  strip.innerHTML = "";
  strip.append(el("p", {}, isHost ? `Safari code ${code}` : `On safari ${code}`));
  strip.append(el("ul", { role: "list", "aria-label": "Sightings", id: "sightings-list" }));
  strip.append(el("ol", { role: "log", "aria-label": "Safari feed", id: "safari-feed" }));
  const leave = el("button", { id: "leave-safari", text: isHost ? "End safari" : "Leave safari" });
  leave.addEventListener("click", async () => {
    try {
      if (isHost) {
        await api("POST", `/api/safaris/${code}/end`, {});
        announce("Safari status", "Safari ended.");
      } else {
        await api("POST", `/api/safaris/${code}/leave`, {});
      }
      safariCode = null;
      strip.hidden = true;
    } catch (err) {
      if (err instanceof ApiCallError) announce("Safari status", err.message);
    }
  });
  strip.append(leave);
}

export async function joinByCode(_game: Game, input: HTMLInputElement, dialog: HTMLDialogElement): Promise<void> {
  const code = input.value.trim().toUpperCase();
  if (!code) return;
  try {
    const res = await api<{ safari: { code: string; host: string; status: string } }>("POST", `/api/safaris/${code}/join`, {});
    announce("Safari status", `You joined ${res.safari.host}'s safari.`);
    renderSafariStrip(res.safari.code, false);
    dialog.close();
    qs("#join-safari")?.focus();
  } catch (err) {
    if (err instanceof ApiCallError) {
      announce("Safari status", err.message);
      input.focus();
    }
  }
}

// ---------- album ----------

export async function refreshAlbums(game: Game): Promise<void> {
  const albums = await api<AlbumsAnswer>("GET", "/api/me/albums");
  const tabs = qs("#album-tabs");
  if (!tabs) return;
  tabs.innerHTML = "";
  for (const album of albums.albums) {
    const tab = el("button", {
      role: "tab",
      "aria-selected": String(album.island === game.island),
      "data-island": String(album.island),
      text: album.island_name,
      tabindex: album.island === game.island ? "0" : "-1"
    });
    tab.addEventListener("click", () => { selectTab(album.island); showAlbum(album.island, albums); });
    tab.addEventListener("keydown", ev => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      ev.preventDefault();
      const ids = albums.albums.map(a => a.island);
      const i = ids.indexOf(album.island);
      const next = ev.key === "ArrowRight" ? (i + 1) % ids.length : (i - 1 + ids.length) % ids.length;
      selectTab(ids[next]);
      showAlbum(ids[next], albums);
      qs<HTMLElement>(`#album-tabs [data-island='${ids[next]}']`)?.focus();
    });
    tabs.append(tab);
  }
  const current = albums.albums.find(a => a.island === game.island) ?? albums.albums[0];
  selectTab(current.island);
  showAlbum(current.island, albums);
}

function selectTab(island: number): void {
  for (const t of qsa("#album-tabs [role='tab']")) {
    const selected = t.getAttribute("data-island") === String(island);
    t.setAttribute("aria-selected", String(selected));
    t.setAttribute("tabindex", selected ? "0" : "-1");
  }
}

function showAlbum(island: number, albums: AlbumsAnswer): void {
  const album = albums.albums.find(a => a.island === island)!;
  const pages = qs<HTMLElement>("#album-pages");
  if (!pages) return;
  pages.innerHTML = "";
  for (const page of album.pages) {
    const li = el("li", { class: "album-page" + (page.filled ? " filled" : "") });
    if (page.filled && page.photo_id) {
      li.append(el("img", { src: `/api/photos/${page.photo_id}/image`, alt: `${page.creature_name} photo` }));
      li.append(el("h4", {}, page.creature_name));
      li.append(el("p", {}, `${page.total} points`));
      const send = el("button", { text: `Send ${page.creature_name} photo as a postcard` });
      send.addEventListener("click", () => void import("./play-photo.js").then(m => m.openPostcardDialog(page.photo_id!)));
      li.append(send);
    } else {
      li.append(el("div", { class: "empty-state" }, el("p", {}, "Not photographed yet.")));
      li.append(el("h4", {}, page.creature_name));
    }
    pages.append(li);
  }
  const fig = qs<HTMLElement>("[data-figure='album-pages']");
  if (fig) setFigure(fig, album.pages_filled, pagesText);
  const refill = qs<HTMLButtonElement>("#refill-film");
  if (refill) refill.disabled = island !== 1;
}

export async function refillFilm(game: Game): Promise<void> {
  try {
    const res = await api<{ film: number }>("POST", "/api/me/refill", {});
    const node = qs("[data-figure='film']");
    if (node) setFigure(node, res.film, framesText);
    announce("World status", "Film refilled to 36 frames.");
  } catch (err) {
    if (err instanceof ApiCallError) announce("World status", err.message);
  }
  void game;
}

export function touchVisible(): boolean {
  const phone = window.matchMedia("(max-width: 767.98px)").matches;
  return phone || coarsePointer();
}

export function isWalkable(game: Game, tile: [number, number]): boolean {
  return isLand(game.island, tile[0], tile[1]);
}

export function islandNameOf(game: Game): string {
  return islandName(game.island);
}
