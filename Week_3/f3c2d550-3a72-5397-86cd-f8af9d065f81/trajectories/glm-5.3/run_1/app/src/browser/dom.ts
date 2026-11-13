// DOM helpers, statuses, dialogs and the tile swap (Fader Pull).

import { api, ApiError, type ServicesStatus } from "./api.js";
import { COPY } from "./copy.js";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export function text(tag: "p" | "span" | "div" | "h1" | "h2" | "h3" | "li", value: string, attrs: Record<string, string> = {}): HTMLElement {
  const node = el(tag, attrs);
  node.textContent = value;
  return node;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// --- Global statuses -------------------------------------------------------

export interface DeckStatus {
  set: (message: string) => void;
  clear: () => void;
}

let deckStatusEl: HTMLElement | null = null;
let serviceNoticesEl: HTMLElement | null = null;
let announcerEl: HTMLElement | null = null;

export function bindGlobalStatuses(root: Element): void {
  deckStatusEl = el("p", { role: "status", "aria-label": "Deck status" });
  deckStatusEl.id = "deck-status";
  serviceNoticesEl = el("p", { role: "status", "aria-label": "Service notices" });
  serviceNoticesEl.id = "service-notices";
  announcerEl = el("p", { role: "status", "aria-label": "Reel announcer" });
  announcerEl.className = "sr-only";
  root.append(deckStatusEl, serviceNoticesEl, announcerEl);
}

export const deckStatus: DeckStatus = {
  set: (message: string) => { if (deckStatusEl) deckStatusEl.textContent = message; },
  clear: () => { if (deckStatusEl) deckStatusEl.textContent = ""; },
};

export function announce(message: string): void {
  if (announcerEl) announcerEl.textContent = message;
}

export function clearAnnouncer(): void {
  if (announcerEl) announcerEl.textContent = "";
}

export function renderServiceNotices(services: ServicesStatus): void {
  if (!serviceNoticesEl) return;
  const banners: string[] = [];
  if (services.search === "down") banners.push(COPY.searchOffline);
  if (services.storage === "down") banners.push(COPY.storageOffline);
  if (services.printing === "down") banners.push(COPY.printingOffline);
  serviceNoticesEl.textContent = banners.join(" ");
}

export function startStatusPolling(onStatus: (services: ServicesStatus) => void): void {
  const tick = async () => {
    try {
      const s = await api.status();
      onStatus(s.services);
    } catch { /* the next tick retries */ }
  };
  void tick();
  window.setInterval(tick, 5000);
}

export async function reportFailure(err: unknown): Promise<void> {
  const message = err instanceof ApiError && err.message ? err.message : COPY.genericFailure;
  deckStatus.set(message);
}

// --- Dialogs (slide up into place, Tab kept inside, Escape closes) ----------

interface DialogHandle {
  close: () => void;
}

export function openDialog(
  build: (root: HTMLElement, close: () => void) => void,
  opener: HTMLElement,
): DialogHandle {
  const backdrop = el("div", { class: "dialog-backdrop" });
  const dialog = el("div", { role: "dialog", "aria-modal": "true" });
  dialog.classList.add("dialog-open");
  backdrop.append(dialog);
  document.body.append(backdrop);

  const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(
    "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
  )).filter((n) => !n.hasAttribute("disabled"));

  const close = () => {
    if (prefersReducedMotion()) {
      backdrop.remove();
    } else {
      dialog.classList.remove("dialog-open");
      dialog.classList.add("dialog-close");
      window.setTimeout(() => backdrop.remove(), 120);
    }
    document.removeEventListener("keydown", onKey, true);
    opener.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "Tab") {
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener("keydown", onKey, true);

  build(dialog, close);
  const first = focusables()[0];
  if (first) first.focus();
  return { close };
}

// --- Tile and the Fader Pull ------------------------------------------------

export interface TileContent {
  swatch: string;
  photoUrl: string | null;
  name: string;
  sizeLine: string;
}

export interface TileParts {
  figure: HTMLElement;
  tile: HTMLElement;
  photo: HTMLImageElement;
  shutter: HTMLElement;
  captionName: HTMLElement;
  captionSize: HTMLElement;
  showEmpty: (copy: string, wholePhoto?: boolean) => void;
  show: (content: TileContent, wholePhoto?: boolean) => void;
}

export function buildTile(label: string, name?: string): TileParts {
  const figure = el("figure", { role: "figure", "aria-label": "Current reference" });
  figure.setAttribute("role", "figure");
  const tile = el("div", { class: "tile" });
  const photo = document.createElement("img");
  photo.className = "photo";
  photo.alt = name ?? "";
  const shutter = el("div", { class: "shutter" });
  tile.append(photo, shutter);
  const caption = el("figcaption", { class: "tile-caption" });
  const captionName = el("p", { class: "name" });
  const captionSize = el("p", { class: "size-line" });
  caption.append(captionName, captionSize);
  figure.append(tile, caption);
  return {
    figure, tile, photo, shutter, captionName, captionSize,
    showEmpty: (copy, wholePhoto = false) => {
      tile.style.background = "var(--surface)";
      tile.classList.toggle("whole", wholePhoto);
      photo.removeAttribute("src");
      photo.style.display = "none";
      const outline = el("div", { class: "tile-outline" });
      outline.innerHTML = KETTLE_OUTLINE;
      const line = text("p", copy, { class: "tile-empty-copy" });
      tile.append(outline, line);
      captionName.textContent = "";
      captionSize.textContent = "";
    },
    show: (content, wholePhoto = false) => {
      tile.querySelectorAll(".tile-outline, .tile-empty-copy").forEach((n) => n.remove());
      tile.classList.toggle("whole", wholePhoto);
      tile.style.background = content.swatch;
      photo.style.display = "";
      photo.src = content.photoUrl ?? "";
      photo.alt = content.name;
      captionName.textContent = content.name;
      captionSize.textContent = content.sizeLine;
    },
  };
}

const KETTLE_OUTLINE = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <path d="M28 40 q0 -16 18 -16 q18 0 18 16 l0 26 q0 10 -10 10 l-16 0 q-10 0 -10 -10 z"/>
  <path d="M64 44 q12 -2 12 10 q0 12 -12 10"/>
  <path d="M34 76 l0 8 M62 76 l0 8"/>
</svg>`;

// The Fader Pull: value/address/scroll first, shutter closing with the crossfade,
// then the shutter opening on the new photo with the tile slide.
export interface SwapHandle { cancel: () => void }

export function faderPullSwap(
  parts: TileParts,
  from: TileContent | null,
  to: TileContent,
  direction: 1 | -1,
): void {
  if (prefersReducedMotion()) {
    parts.show(to);
    return;
  }
  // 0-180ms: shutter closes over the tile while the fill crossfades.
  parts.shutter.style.transition = "transform 180ms cubic-bezier(0.2, 0, 0.2, 1)";
  parts.shutter.style.transformOrigin = "top";
  parts.shutter.style.transform = "scaleY(1)";
  window.setTimeout(() => {
    // 180ms point: the shutter fully covers the tile; new content painted here.
    parts.show(to);
    parts.photo.classList.remove("photo-enter-right", "photo-enter-left");
    void parts.photo.offsetWidth;
    parts.photo.classList.add(direction === 1 ? "photo-enter-right" : "photo-enter-left");
    // 180-360ms: shutter opens upwards.
    parts.shutter.style.transformOrigin = "bottom";
    parts.shutter.style.transform = "scaleY(0)";
    window.setTimeout(() => {
      parts.shutter.style.transform = "";
      parts.shutter.style.transition = "";
      parts.shutter.style.transformOrigin = "top";
    }, 180);
  }, 180);
}

// Instantly jump the running swap to its end state (rapid input).
export function finishSwapAtOnce(parts: TileParts, to: TileContent): void {
  parts.shutter.style.transition = "";
  parts.shutter.style.transform = "";
  parts.photo.classList.remove("photo-enter-right", "photo-enter-left");
  parts.show(to);
}
