// The contact sheet at /sheet and its full-viewport story viewer. The search, open essay and frame live in
// the address: typing replaces the entry, opening a tile adds one entry, stepping replaces `frame`.
import { attempt, get } from "./api.js";
import { trapTab } from "./dialog.js";
import { h, reducedMotion, replace, say } from "./dom.js";
import { Ledger } from "./ledger.js";
import type { AppContext } from "./main.js";
import type { Essay, FeedEssay } from "./types.js";

const SESSION = Math.random().toString(36).slice(2);
const UNAVAILABLE = "That essay isn't available.";

export const sheetStamp = (essay: { state: string; lift_display: string }): string =>
  essay.state === "embargoed" ? `EMBARGOED · lifts ${essay.lift_display}` : `LIVE · since ${essay.lift_display}`;

interface Address {
  q: string;
  essay: string | null;
  frame: string | null;
}

function readAddress(): Address {
  const params = new URLSearchParams(location.search);
  return { q: params.get("q") ?? "", essay: params.get("essay"), frame: params.get("frame") };
}

function addressFor(q: string, essay: string | null, frame: number | null): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (essay) params.set("essay", essay);
  if (essay && frame !== null) params.set("frame", String(frame));
  const query = params.toString();
  return `/sheet${query ? `?${query}` : ""}`;
}

/** Rounds a numeric frame and clamps it to 1..total; anything else is frame 1. */
function clampFrame(raw: string | null, total: number): number {
  const n = raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(1, Math.round(n)), Math.max(1, total));
}

export function mountSheet(root: HTMLElement, app: AppContext): () => void {
  const search = h("input", { type: "search", id: "sheet-search", class: "search-input", "aria-label": "Search essays",
    placeholder: "Title, caption or photographer", autocomplete: "off" });
  const status = h("p", { role: "status", "aria-label": "Sheet status", class: "sheet-status" });
  const grid = h("div", { class: "contact-grid" });
  const region = h("section", { class: "contact-sheet", "aria-label": "Contact sheet" }, grid);
  replace(root, h("div", { class: "sheet-page" },
    h("div", { class: "sheet-head" },
      h("h1", { class: "page-title" }, "Contact sheet"),
      h("p", { class: "page-lede" }, "Embargoed and live essays from co-op members, latest lift first.")),
    h("div", { class: "search-row" }, h("label", { class: "visually-hidden", for: "sheet-search" }, "Search essays"), search),
    status, region));

  let results: FeedEssay[] = [];
  let feedToken = 0;
  let viewer: Viewer | null = null;
  let disposed = false;

  async function loadFeed(): Promise<void> {
    const token = ++feedToken;
    const q = search.value;
    const answer = await attempt(() => get<{ essays: FeedEssay[] }>(`/api/feed${q.trim() ? `?q=${encodeURIComponent(q)}` : ""}`));
    if (token !== feedToken || disposed) return;
    if (!answer?.ok || !answer.data) return;
    results = answer.data.essays;
    renderTiles();
    if (!results.length && q.trim()) say(status, `No essays match “${q}”.`);
    else if (status.textContent !== UNAVAILABLE) say(status, "");
  }

  function renderTiles(): void {
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset.essay;
    replace(grid, ...results.map((essay) => {
      const tile = h("button", { type: "button", class: "tile", "aria-label": `Open ${essay.title}`, "data-essay": essay.id },
        h("span", { class: "tile-frame" },
          essay.cover_url ? h("img", { src: essay.cover_url, alt: "", loading: "lazy", width: 600, height: 600 }) : null,
          h("span", { class: `stamp tile-stamp${essay.state === "embargoed" ? " stamp-embargo" : ""}` }, sheetStamp(essay))),
        h("span", { class: "tile-text" },
          h("span", { class: "tile-title" }, essay.title),
          h("span", { class: "tile-credit" }, essay.credit_line)));
      tile.addEventListener("click", () => openFromTile(essay.id));
      return tile;
    }));
    if (focusedId) grid.querySelector<HTMLElement>(`[data-essay="${CSS.escape(focusedId)}"]`)?.focus();
  }

  function tileFor(id: string): HTMLElement | null {
    return grid.querySelector<HTMLElement>(`[data-essay="${CSS.escape(id)}"]`);
  }

  function openFromTile(id: string): void {
    history.pushState({ viewer: SESSION }, "", addressFor(search.value, id, 1));
    void openViewer(id, "1");
  }

  /** Opens the viewer for an essay; an unavailable essay or out-of-range frame corrects the address in place. */
  async function openViewer(id: string, rawFrame: string | null): Promise<void> {
    const answer = await attempt(() => get<Essay>(`/api/essays/${encodeURIComponent(id)}`));
    if (disposed) return;
    const essay = answer?.ok ? answer.data : null;
    if (!essay || essay.state === "taken_down") {
      history.replaceState(null, "", addressFor(search.value, null, null));
      say(status, UNAVAILABLE);
      return;
    }
    const frame = clampFrame(rawFrame, essay.frames.length);
    if (rawFrame !== String(frame)) history.replaceState(history.state, "", addressFor(search.value, id, frame));
    viewer?.destroy(false);
    viewer = new Viewer(essay, frame, app, {
      step: (n) => history.replaceState(history.state, "", addressFor(search.value, essay.id, n)),
      close: () => requestClose(),
    });
  }

  function requestClose(): void {
    if (history.state?.viewer === SESSION) {
      history.back();
      return;
    }
    history.replaceState(null, "", addressFor(search.value, null, null));
    closeViewer();
  }

  function closeViewer(): void {
    if (!viewer) return;
    const id = viewer.essay.id;
    viewer.destroy(true);
    viewer = null;
    const tile = tileFor(id);
    (tile ?? search).focus();
  }

  const onPop = (): void => {
    const address = readAddress();
    if (search.value !== address.q) {
      search.value = address.q;
      void loadFeed();
    }
    if (!address.essay) closeViewer();
    else if (!viewer || viewer.essay.id !== address.essay) void openViewer(address.essay, address.frame);
    else viewer.show(clampFrame(address.frame, viewer.essay.frames.length));
  };
  window.addEventListener("popstate", onPop);

  search.addEventListener("input", () => {
    history.replaceState(history.state, "", addressFor(search.value, null, null));
    void loadFeed();
  });

  const initial = readAddress();
  search.value = initial.q;
  void loadFeed();
  if (initial.essay) void openViewer(initial.essay, initial.frame);
  const refresh = window.setInterval(() => void loadFeed(), 30_000);

  return () => {
    disposed = true;
    window.clearInterval(refresh);
    window.removeEventListener("popstate", onPop);
    viewer?.destroy(false);
  };
}

interface ViewerHooks {
  step: (frame: number) => void;
  close: () => void;
}

class Viewer {
  readonly element: HTMLElement;
  private frame: number;
  private readonly layers: [HTMLImageElement, HTMLImageElement];
  private front = 0;
  private readonly segments: HTMLElement[];
  private readonly caption: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly ledger: Ledger;
  private readonly onKey: (event: KeyboardEvent) => void;

  constructor(readonly essay: Essay, frame: number, app: AppContext, private readonly hooks: ViewerHooks) {
    this.frame = frame;
    this.segments = essay.frames.map(() => h("span", { class: "segment" }, h("span", { class: "segment-fill" })));
    const progress = h("div", { class: "story-progress", role: "group", "aria-label": "Story progress" }, ...this.segments);
    this.layers = [h("img", { class: "frame-layer is-front", alt: "" }), h("img", { class: "frame-layer", alt: "" })];
    const well = h("div", { class: "frame-well" }, ...this.layers);
    this.caption = h("p", { class: "frame-caption" });
    this.counter = h("p", { class: "frame-counter mono" });
    this.prev = h("button", { type: "button", class: "button button-ghost frame-button" }, "Previous frame");
    this.next = h("button", { type: "button", class: "button button-ghost frame-button" }, "Next frame");
    this.closeButton = h("button", { type: "button", class: "button button-ghost close-story" }, "Close story");
    this.prev.addEventListener("click", () => this.step(-1));
    this.next.addEventListener("click", () => this.step(1));
    this.closeButton.addEventListener("click", () => this.hooks.close());
    let swiped = false;
    well.addEventListener("click", (event) => {
      if (swiped) {
        swiped = false;
        return;
      }
      const rect = well.getBoundingClientRect();
      this.step(event.clientX - rect.left < rect.width / 2 ? -1 : 1);
    });
    let touchX: number | null = null;
    well.addEventListener("touchstart", (event) => {
      touchX = event.touches.length === 1 ? event.touches[0]?.clientX ?? null : null;
    }, { passive: true });
    well.addEventListener("touchmove", (event) => {
      const now = event.touches[0]?.clientX;
      if (touchX === null || now === undefined) return;
      if (Math.abs(now - touchX) > well.getBoundingClientRect().width / 4) {
        swiped = true;
        this.step(now < touchX ? 1 : -1);
        touchX = null;
      }
    }, { passive: true });
    this.ledger = new Ledger(essay, app, () => this.frame);
    const stage = h("div", { class: "story-stage" },
      progress,
      h("div", { class: "stage-top" }, this.closeButton),
      well,
      h("div", { class: "frame-bar" },
        h("div", { class: "frame-text" }, this.caption, this.counter),
        h("div", { class: "frame-buttons" }, this.prev, this.next)));
    this.element = h("div", { class: "viewer", role: "dialog", "aria-modal": "true", "aria-labelledby": "viewer-title" },
      stage, this.ledger.element);
    this.onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (event.key === "ArrowRight" && !typing) {
        event.preventDefault();
        this.step(1);
      } else if (event.key === "ArrowLeft" && !typing) {
        event.preventDefault();
        this.step(-1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (!this.ledger.escape()) this.hooks.close();
      } else trapTab(this.element, event);
    };
    document.addEventListener("keydown", this.onKey);
    const shell = document.getElementById("app") as HTMLElement;
    shell.inert = true;
    document.documentElement.classList.add("viewer-open");
    document.body.append(this.element);
    if (!reducedMotion()) {
      this.element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
    }
    this.show(frame, true);
    this.initialFocus();
  }

  private initialFocus(): void {
    const target = !this.next.disabled ? this.next : !this.prev.disabled ? this.prev : this.closeButton;
    target.focus();
  }

  private step(delta: number): void {
    const target = this.frame + delta;
    if (target < 1 || target > this.essay.frames.length) return;
    this.show(target);
    this.hooks.step(target);
  }

  show(frame: number, first = false): void {
    const changed = frame !== this.frame || first;
    this.frame = frame;
    const data = this.essay.frames[frame - 1];
    const total = this.essay.frames.length;
    if (changed && data?.preview_url) {
      const back = this.layers[1 - this.front] as HTMLImageElement;
      const front = this.layers[this.front] as HTMLImageElement;
      if (first) {
        front.src = data.preview_url;
      } else {
        back.src = data.preview_url;
        back.classList.add("is-front");
        front.classList.remove("is-front");
        this.front = 1 - this.front;
      }
    }
    this.segments.forEach((segment, i) => segment.classList.toggle("is-filled", i < frame));
    this.caption.textContent = data?.caption || this.essay.caption;
    this.counter.textContent = `Frame ${frame} of ${total}`;
    this.prev.disabled = frame <= 1;
    this.next.disabled = frame >= total;
    if (document.activeElement === document.body || (document.activeElement as HTMLButtonElement | null)?.disabled) {
      this.initialFocus();
    }
    this.ledger.frameChanged();
  }

  destroy(animate: boolean): void {
    document.removeEventListener("keydown", this.onKey);
    this.ledger.dispose();
    const shell = document.getElementById("app") as HTMLElement;
    shell.inert = false;
    document.documentElement.classList.remove("viewer-open");
    this.element.inert = true;
    this.element.removeAttribute("role");
    if (animate && !reducedMotion()) {
      const fade = this.element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: "ease-in" });
      fade.onfinish = () => this.element.remove();
    } else this.element.remove();
  }
}
