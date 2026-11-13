// Trash: one row per trashed reference with its countdown and Restore button.
// The countdown ticks from the server's last seconds_left using elapsed time.

import type { ScreenContext } from "./main.js";
import { api, type TrashBody } from "./api.js";
import { el, text, buildTile, deckStatus, type TileParts } from "./dom.js";
import { COPY, countdownText } from "./copy.js";

export class TrashScreen {
  private tile: TileParts;
  private list!: HTMLElement;
  private remaining = new Map<string, { at: number; seconds: number }>();

  constructor(private ctx: ScreenContext) {
    this.tile = buildTile("Current reference");
    this.tile.showEmpty(COPY.openingDeck);
    ctx.field.append(this.tile.figure);
    ctx.main.append(text("h1", "Trash"));
    this.list = el("ul", { class: "row-list" });
    this.list.setAttribute("aria-label", "Trashed references");
    ctx.main.append(this.list);
    void this.fetch();
    window.setInterval(() => void this.fetch(), 60_000);
    window.addEventListener("focus", () => void this.fetch());
    window.setInterval(() => this.tick(), 1000);
  }

  private async fetch(): Promise<void> {
    try {
      const body: TrashBody = await api.trashList();
      this.remaining.clear();
      for (const item of body.items) {
        this.remaining.set(item.id, { at: Date.now(), seconds: item.seconds_left });
      }
      this.render(body);
    } catch { /* the next fetch retries */ }
  }

  private render(body: TrashBody): void {
    this.list.textContent = "";
    if (body.items.length === 0) {
      this.list.append(text("li", COPY.trashEmpty, { class: "row" }));
      this.tile.showEmpty(COPY.trashEmpty);
      return;
    }
    for (const item of body.items) {
      const li = el("li", { class: "row two-col" });
      const main = el("div");
      const name = text("p", item.title);
      const maker = text("p", item.maker ?? "", { class: "maker-line" });
      const countdownLine = text("p", "", { class: "size-line" });
      countdownLine.id = `countdown-${item.id}`;
      main.append(name, maker, countdownLine);
      const restore = el("button", { type: "button" });
      restore.setAttribute("aria-label", `Restore ${item.title}`);
      restore.textContent = "Restore";
      restore.addEventListener("click", async () => {
        try {
          await api.restore(item.id);
          deckStatus.set(COPY.restored(item.title));
          const remaining = this.remaining.size - 1;
          await this.fetch();
          // Focus moves to the next row's Restore button, or to the Trash
          // heading when the list becomes empty.
          if (remaining <= 0) {
            const heading = this.ctx.main.querySelector("h1") as HTMLElement | null;
            heading?.setAttribute("tabindex", "-1");
            heading?.focus();
          } else {
            this.list.querySelector<HTMLButtonElement>("button")?.focus();
          }
        } catch (err) {
          if ((err as { code?: string }).code === "restore_window_closed") {
            deckStatus.set(COPY.restoreWindowClosed);
          } else {
            deckStatus.set(COPY.genericFailure);
          }
          await this.fetch();
        }
      });
      li.append(main, restore);
      this.list.append(li);
      this.paintCountdown(item.id);
    }
  }

  private paintCountdown(id: string): void {
    const entry = this.remaining.get(id);
    const el = document.getElementById(`countdown-${id}`);
    if (!entry || !el) return;
    const elapsed = Math.floor((Date.now() - entry.at) / 1000);
    el.textContent = `Restorable for ${countdownText(entry.seconds - elapsed)}`;
  }

  private tick(): void {
    for (const id of this.remaining.keys()) this.paintCountdown(id);
  }
}
