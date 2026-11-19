// The Reference picker: a filter combobox and a listbox of the target table's visible rows,
// read afresh at every opening.
import type { Column, TableRead } from "./api.js";
import { request, tablePath } from "./api.js";
import { COPY, rowDisplay } from "./copy.js";
import { h, icon, overlay, place } from "./dom.js";
import type { Workspace } from "./workspace.js";

interface Choice {
  value: string | null;
  label: string;
}

let pickers = 0;

export class Picker {
  readonly columnId: string;
  private readonly input: HTMLInputElement;
  private readonly listbox: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly message: HTMLElement;
  private choices: Choice[] = [];
  private shown: Choice[] = [];
  private highlight = 0;
  private readonly loading: Promise<void>;
  private closed = false;
  private readonly id = ++pickers;

  constructor(
    private readonly ws: Workspace,
    readonly rowId: string,
    private readonly column: Column,
    private readonly host: HTMLElement,
    filter: string,
    private readonly on: { choose: (value: string | null, label: string, direction: "down" | "right" | null) => void; cancel: () => void },
    error?: string,
  ) {
    this.columnId = column.id;
    const listId = `picker-list-${this.id}`;
    this.input = h("input", {
      type: "text", role: "combobox", "aria-label": column.name, "aria-expanded": "true", "aria-controls": listId,
      "aria-autocomplete": "list", class: "cell-editor picker-input", spellcheck: "false", autocomplete: "off",
    }) as HTMLInputElement;
    this.input.value = filter;
    this.listbox = h("ul", { role: "listbox", id: listId, "aria-label": `${column.name} choices`, class: "listbox" });
    this.message = h("p", { class: "picker-message" });
    this.panel = h("div", { class: "picker-panel" }, this.listbox, this.message);
    if (error) {
      this.input.setAttribute("aria-invalid", "true");
      this.message.replaceChildren(icon("alert"), error);
    }
    host.replaceChildren(this.input);
    overlay().append(this.panel);
    this.input.addEventListener("input", () => {
      this.highlight = -1;
      this.renderList();
    });
    this.input.addEventListener("keydown", (e) => this.key(e));
    this.input.addEventListener("blur", () => {
      queueMicrotask(() => {
        if (!this.closed && document.activeElement !== this.input && !this.panel.contains(document.activeElement)) {
          this.close(false);
          this.on.cancel();
        }
      });
    });
    this.input.focus();
    this.input.setSelectionRange(filter.length, filter.length);
    this.renderList();
    this.loading = this.load();
  }

  private async load(): Promise<void> {
    const answer = await request<TableRead>("GET", tablePath(this.ws.docId, this.column.target_table_id!));
    if (!answer.ok || this.closed) return;
    const first = [...answer.data.table.columns].sort((a, b) => a.position - b.position)[0];
    this.choices = answer.data.table.rows.map((r) => ({ value: r.id, label: rowDisplay(first ? (r.cells[first.id]?.display ?? "") : "") }));
    this.highlight = -1;
    this.renderList();
  }

  private renderList(): void {
    const filter = this.input.value.toLowerCase();
    const current = this.ws.cellOf(this.rowId, this.column.id);
    const currentValue = current?.kind === "reference" ? current.value : null;
    this.shown = [
      ...(filter === "" ? [{ value: null, label: "Blank" }] : []),
      ...this.choices.filter((c) => c.label.toLowerCase().includes(filter)),
    ];
    if (this.highlight < 0 || this.highlight >= this.shown.length) {
      const index = this.shown.findIndex((c) => c.value !== null && c.value === currentValue);
      this.highlight = index >= 0 ? index : 0;
    }
    this.listbox.replaceChildren(
      ...this.shown.map((c, i) => {
        const option = h("li", {
          role: "option", id: `picker-${this.id}-option-${i}`, class: "option", "aria-selected": i === this.highlight ? "true" : "false",
        }, c.label);
        option.addEventListener("mousedown", (e) => {
          e.preventDefault();
          this.highlight = i;
          this.pick(null);
        });
        return option;
      }),
    );
    const noMatch = this.shown.length === 0 && this.choices.length + (filter === "" ? 1 : 0) > 0;
    const messageText = this.message.querySelector("svg") ? null : noMatch ? COPY.noMatch : "";
    if (messageText !== null) this.message.textContent = messageText;
    if (this.shown.length) this.input.setAttribute("aria-activedescendant", `picker-${this.id}-option-${this.highlight}`);
    else this.input.removeAttribute("aria-activedescendant");
    this.position();
  }

  private position(): void {
    const statusTop = this.ws.statusBar.getBoundingClientRect().top;
    place(this.panel, this.host.getBoundingClientRect(), statusTop);
    this.listbox.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
  }

  private key(e: KeyboardEvent): void {
    e.stopPropagation();
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (this.highlight < this.shown.length - 1) this.highlight++;
        this.renderList();
        return;
      case "ArrowUp":
        e.preventDefault();
        if (this.highlight > 0) this.highlight--;
        this.renderList();
        return;
      case "Enter":
        e.preventDefault();
        void this.loading.then(() => this.pick("down"));
        return;
      case "Tab":
        e.preventDefault();
        void this.loading.then(() => this.pick("right"));
        return;
      case "Escape":
        e.preventDefault();
        this.close(false);
        this.on.cancel();
        return;
      default:
        return;
    }
  }

  private pick(direction: "down" | "right" | null): void {
    if (this.closed) return;
    const choice = this.shown[this.highlight];
    if (!choice) return;
    this.close(false);
    this.on.choose(choice.value, choice.value === null ? "" : choice.label, direction);
  }

  close(_focus: boolean): void {
    if (this.closed) return;
    this.closed = true;
    this.panel.remove();
  }
}
