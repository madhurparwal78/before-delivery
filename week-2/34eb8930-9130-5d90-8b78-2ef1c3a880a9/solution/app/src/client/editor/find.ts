import { h, plural, setText } from "../dom.js";
import { announce, debounce, openDialog } from "../ui.js";
import type { Editor } from "./editor.js";
import { findMatches } from "../../shared/model.js";

/** Find and replace dialog (Interactions; DP-49): count, stepping, replace by mode, focus trapped. */
export class FindDialog {
  private dialog = h("dialog", { class: "dialog find-dialog", "aria-labelledby": "find-title" });
  private find = h("input", { id: "find-text", type: "text", autocomplete: "off", spellcheck: "false" });
  private replace = h("input", { id: "find-replace", type: "text", autocomplete: "off", spellcheck: "false" });
  private matchCase = h("input", { id: "find-case", type: "checkbox" });
  private count = h("p", { class: "find-count" }, "No matches");
  private prev = h("button", { type: "button", class: "btn quiet" }, "Previous match");
  private next = h("button", { type: "button", class: "btn quiet" }, "Next match");
  private one = h("button", { type: "button", class: "btn" }, "Replace");
  private all = h("button", { type: "button", class: "btn" }, "Replace all");
  private close = h("button", { type: "button", class: "btn quiet" }, "Close");
  private hits: number[] = [];
  private current = -1;
  private handle: (() => void) | null = null;
  private announcer = debounce(1000 / 3, () => announce(this.countText(false)));

  constructor(private editor: Editor) {
    this.dialog.append(
      h("h2", { id: "find-title", class: "dialog-title" }, "Find and replace"),
      h("div", { class: "field" }, h("label", { for: "find-text" }, "Find"), this.find),
      h("div", { class: "field" }, h("label", { for: "find-replace" }, "Replace with"), this.replace),
      h("div", { class: "check-row" }, this.matchCase, h("label", { for: "find-case" }, "Match case")),
      this.count,
      h("div", { class: "dialog-actions wrap" }, this.prev, this.next, this.one, this.all, this.close));
    this.find.addEventListener("input", () => { this.search(); this.announcer.poke(); });
    this.matchCase.addEventListener("change", () => { this.search(); this.announcer.poke(); });
    this.find.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      this.step(e.shiftKey ? -1 : 1);
    });
    this.prev.addEventListener("click", () => this.step(-1));
    this.next.addEventListener("click", () => this.step(1));
    this.one.addEventListener("click", () => this.replaceCurrent());
    this.all.addEventListener("click", () => void this.replaceEvery());
    this.close.addEventListener("click", () => this.handle?.());
  }

  get open(): boolean { return this.dialog.open; }

  show(opener: HTMLElement | null): void {
    const canReplace = this.editor.canReplace();
    for (const b of [this.one, this.all]) b.disabled = !canReplace;
    this.replace.disabled = !canReplace;
    this.handle = openDialog(this.dialog, {
      opener, focus: this.find,
      onClose: () => { this.announcer.cancel(); this.editor.showHits([], 0, -1); },
      restore: opener ? undefined : () => this.editor.focusPage(),
    });
    this.find.select();
    this.search();
  }

  /** Re-run the search after the text changed. */
  refresh(): void { if (this.dialog.open) this.search(true); }

  setReplaceAllowed(allowed: boolean): void {
    for (const b of [this.one, this.all]) b.disabled = !allowed;
    this.replace.disabled = !allowed;
  }

  private search(keep = false): void {
    const at = this.hits[this.current];
    this.hits = findMatches(this.editor.findText(), this.find.value, this.matchCase.checked);
    this.current = keep && at !== undefined ? Math.max(0, this.hits.findIndex((p) => p >= at)) : (this.hits.length ? 0 : -1);
    if (this.current >= this.hits.length) this.current = this.hits.length ? 0 : -1;
    this.stepped = false;
    this.paint();
  }

  private stepped = false;

  private countText(stepping: boolean): string {
    if (!this.hits.length) return "No matches";
    if (stepping) return `Match ${this.current + 1} of ${this.hits.length}`;
    return plural(this.hits.length, "match", "matches");
  }

  private paint(): void {
    setText(this.count, this.countText(this.stepped));
    this.editor.showHits(this.hits, this.find.value.length, this.current);
  }

  private step(dir: number): void {
    if (!this.hits.length) return;
    this.current = this.stepped ? (this.current + dir + this.hits.length) % this.hits.length : (dir > 0 ? 0 : this.hits.length - 1);
    this.stepped = true;
    this.paint();
    this.editor.revealOffset(this.hits[this.current]);
  }

  private replaceCurrent(): void {
    const at = this.hits[this.current];
    if (at === undefined || !this.editor.canReplace()) return;
    this.editor.replaceAt(at, this.find.value.length, this.replace.value);
  }

  private async replaceEvery(): Promise<void> {
    if (!this.find.value || !this.editor.canReplace()) return;
    this.all.disabled = true;
    const count = await this.editor.replaceAll(this.find.value, this.replace.value, this.matchCase.checked);
    this.all.disabled = !this.editor.canReplace();
    if (count === null) return;
    announce(this.editor.isSuggesting() ? `Suggested ${plural(count, "replacement", "replacements")}` : `Replaced ${plural(count, "match", "matches")}`);
    this.search();
  }

  destroy(): void {
    this.handle?.();
    this.dialog.remove();
  }
}
