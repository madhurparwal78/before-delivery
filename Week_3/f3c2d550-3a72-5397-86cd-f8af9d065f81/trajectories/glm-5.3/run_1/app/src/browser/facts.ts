// Reference facts: the facts list, the size unit toggle, Edit facts with version,
// the eyedropper, View original (O), Add to reel and Move to trash.

import type { ScreenContext } from "./main.js";
import { api, ApiError, type Reference } from "./api.js";
import { COLOUR_FAMILIES, type Unit } from "../shared/domain.js";
import { el, text, buildTile, deckStatus, openDialog, type TileParts, prefersReducedMotion } from "./dom.js";
import { COPY } from "./copy.js";

const FACT_KEYS = [
  ["maker", "Maker"], ["year", "Year"], ["size", "Size"], ["materials", "Materials"],
  ["finish", "Finish"], ["colour_family", "Colour family"], ["swatch", "Swatch"],
  ["source_url", "Source"], ["source_note", "Where found"], ["notes", "Notes"], ["captured", "Captured"],
] as const;

export class FactsScreen {
  private tile: TileParts;
  private reference: Reference | null = null;
  private unit: Unit = "mm";
  private section!: HTMLElement;
  private actions!: HTMLElement;

  constructor(private ctx: ScreenContext, private id: string) {
    this.tile = buildTile("Current reference");
    this.tile.showEmpty(COPY.openingDeck);
    ctx.field.append(this.tile.figure);
    this.tile.showEmpty(COPY.openingDeck);
    void this.load();
    document.addEventListener("keydown", this.onKey);
  }

  private async load(): Promise<void> {
    try {
      const [ref, settings] = await Promise.all([api.reference(this.id), api.settings()]);
      this.reference = ref;
      this.unit = settings.unit;
      this.ctx.main.textContent = "";
      const h1 = text("h1", ref.title);
      this.ctx.main.append(h1);
      this.buildSection(ref);
      this.tile.show({ swatch: ref.swatch, photoUrl: ref.photo.display_url, name: ref.title, sizeLine: ref.size_text[this.unit] });
    } catch {
      this.ctx.main.textContent = "";
      this.ctx.main.append(text("h1", COPY.unknownReference));
      this.tile.showEmpty(COPY.unknownReference);
    }
  }

  private buildSection(ref: Reference): void {
    this.section = el("section", { class: "facts-section" });
    const h2 = text("h2", "Facts");
    const list = el("dl");
    for (const [key, label] of FACT_KEYS) {
      const dt = el("dt");
      dt.textContent = label;
      const dd = el("dd");
      dd.textContent = this.factValue(ref, key);
      dd.id = `fact-${key}`;
      list.append(dt, dd);
    }
    this.section.append(h2, list);
    this.actions = el("div", { class: "facts-actions" });
    this.buildUnitToggle();
    this.buildButtons(ref);
    this.section.append(this.actions);
    this.ctx.main.append(this.section);
  }

  private factValue(ref: Reference, key: string): string {
    switch (key) {
      case "maker": return ref.maker ?? "";
      case "year": return ref.year === null ? "" : String(ref.year);
      case "size": return ref.size_text[this.unit];
      case "materials": return ref.materials.join(", ");
      case "finish": return ref.finish ?? "";
      case "colour_family": return ref.colour_family;
      case "swatch": return ref.swatch;
      case "source_url": return ref.source_url ?? "";
      case "source_note": return ref.source_note ?? "";
      case "notes": return ref.notes ?? "";
      case "captured": return ref.captured_at;
      default: return "";
    }
  }

  private buildUnitToggle(): void {
    const group = el("fieldset");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "Size unit");
    const legend = el("legend");
    legend.textContent = "Size unit";
    group.append(legend);
    for (const unit of ["mm", "in"] as const) {
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "facts-unit";
      radio.value = unit;
      radio.setAttribute("aria-label", unit);
      radio.checked = unit === this.unit;
      radio.addEventListener("change", async () => {
        if (!radio.checked) return;
        this.unit = unit;
        this.updateSizeLine();
        try {
          const settings = await api.saveUnit(unit);
          this.unit = settings.unit;
          deckStatus.set(COPY.unitNow(unit === "mm" ? "millimetres" : "inches"));
        } catch { deckStatus.set(COPY.genericFailure); }
      });
      group.append(radio);
    }
    this.actions.append(group);
  }

  private updateSizeLine(): void {
    if (!this.reference) return;
    const dd = document.getElementById("fact-size");
    if (dd) dd.textContent = this.reference.size_text[this.unit];
    this.tile.captionSize.textContent = this.reference.size_text[this.unit];
  }

  private buildButtons(ref: Reference): void {
    const viewOriginal = el("button", { type: "button" });
    viewOriginal.textContent = "View original (O)";
    viewOriginal.addEventListener("click", () => this.openOriginal());

    const edit = el("button", { type: "button" });
    edit.textContent = "Edit facts";
    edit.id = "edit-facts";
    edit.addEventListener("click", () => this.startEdit());

    const pickSwatch = el("button", { type: "button" });
    pickSwatch.textContent = "Pick swatch";
    pickSwatch.id = "pick-swatch";
    pickSwatch.addEventListener("click", () => this.openEyedropper(pickSwatch));

    const resetSwatch = el("button", { type: "button" });
    resetSwatch.textContent = "Reset swatch";
    resetSwatch.id = "reset-swatch";
    resetSwatch.style.display = ref.swatch_source === "eyedropper" ? "" : "none";
    resetSwatch.addEventListener("click", () => void this.resetSwatch());

    const addToReel = el("button", { type: "button" });
    addToReel.textContent = "Add to reel";
    addToReel.addEventListener("click", () => this.openAddToReel(addToReel));

    const moveToTrash = el("button", { type: "button" });
    moveToTrash.textContent = "Move to trash";
    moveToTrash.addEventListener("click", () => this.openTrashDialog(moveToTrash));

    this.actions.append(viewOriginal, edit, pickSwatch, resetSwatch, addToReel, moveToTrash);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== "o" && e.key !== "O") return;
    const target = e.target as HTMLElement;
    if (target?.matches?.("input, textarea, select")) return;
    if (document.querySelector('[role="dialog"]')) return;
    e.preventDefault();
    this.openOriginal();
  };

  private openOriginal(): void {
    if (!this.reference) return;
    const img = document.createElement("img");
    img.src = this.reference.photo.original_url;
    img.alt = this.reference.title;
    const close = el("button", { type: "button" });
    close.textContent = "Close";
    openDialog((root, done) => {
      root.setAttribute("aria-label", "Original photograph");
      root.append(img, close);
      close.addEventListener("click", done);
    }, document.getElementById("edit-facts") ?? this.ctx.main.lastElementChild as HTMLElement);
  }

  private startEdit(): void {
    if (!this.reference) return;
    const ref = this.reference;
    // The actions div is a child of the section; move it out before clearing.
    this.actions.remove();
    this.section.textContent = "";
    this.section.append(text("h2", "Edit facts"), this.actions);
    const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
    const specs: Array<[string, string]> = [
      ["title", "Name"], ["maker", "Maker"], ["year", "Year"], ["width", "Width"],
      ["height", "Height"], ["depth", "Depth"], ["materials", "Materials"],
      ["finish", "Finish"], ["source_url", "Source link"], ["source_note", "Where you found it"],
      ["notes", "Notes"],
    ];
    for (const [name, label] of specs) {
      const labelEl = el("label", { for: `edit-${name}` });
      labelEl.textContent = label;
      const input = name === "notes" ? document.createElement("textarea") : document.createElement("input");
      input.id = `edit-${name}`;
      input.setAttribute("aria-label", label);
      input.value = this.editInitial(name);
      const error = text("p", "", { class: "field-error", id: `edit-${name}-error` });
      this.section.append(labelEl, input, error);
      inputs.set(name, input);
    }
    const unitGroup = el("fieldset");
    unitGroup.setAttribute("role", "radiogroup");
    unitGroup.setAttribute("aria-label", "Size unit");
    const legend = el("legend");
    legend.textContent = "Size unit";
    unitGroup.append(legend);
    for (const unit of ["mm", "in"] as Unit[]) {
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "edit-unit";
      radio.value = unit;
      radio.setAttribute("aria-label", unit);
      radio.checked = unit === this.unit;
      unitGroup.append(radio);
    }
    this.section.append(unitGroup);

    const familyLabel = el("label", { for: "edit-colour_family" });
    familyLabel.textContent = "Colour family";
    const familySelect = document.createElement("select");
    familySelect.id = "edit-colour_family";
    familySelect.setAttribute("aria-label", "Colour family");
    for (const family of COLOUR_FAMILIES) {
      const option = el("option", { value: family });
      option.textContent = family;
      if (family === ref.colour_family) option.selected = true;
      familySelect.append(option);
    }
    this.section.append(familyLabel, familySelect);

    const save = el("button", { type: "button", class: "primary" });
    save.textContent = "Save facts";
    save.addEventListener("click", () => void this.saveEdit(inputs, familySelect));
    const cancel = el("button", { type: "button" });
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => void this.load());
    this.actions.textContent = "";
    this.actions.append(save, cancel);
    inputs.get("title")?.focus();
  }

  private editInitial(name: string): string {
    const ref = this.reference!;
    switch (name) {
      case "title": return ref.title;
      case "maker": return ref.maker ?? "";
      case "year": return ref.year === null ? "" : String(ref.year);
      case "width": return this.sizeInput(ref.size_tenths_mm.width);
      case "height": return this.sizeInput(ref.size_tenths_mm.height);
      case "depth": return this.sizeInput(ref.size_tenths_mm.depth);
      case "materials": return ref.materials.join(", ");
      case "finish": return ref.finish ?? "";
      case "source_url": return ref.source_url ?? "";
      case "source_note": return ref.source_note ?? "";
      case "notes": return ref.notes ?? "";
      default: return "";
    }
  }

  private sizeInput(tenths: number): string {
    return this.unit === "mm" ? (tenths / 10).toFixed(1) : (tenths / 254).toFixed(1);
  }

  private async saveEdit(inputs: Map<string, HTMLInputElement | HTMLTextAreaElement>, family: HTMLSelectElement): Promise<void> {
    if (!this.reference) return;
    deckStatus.set(COPY.savingFacts);
    const unit = (this.section.querySelector('input[name="edit-unit"]:checked') as HTMLInputElement | null)?.value as Unit;
    const body: Record<string, unknown> = {
      version: this.reference.version,
      unit,
      width: inputs.get("width")!.value,
      height: inputs.get("height")!.value,
      depth: inputs.get("depth")!.value,
      title: inputs.get("title")!.value,
      maker: inputs.get("maker")!.value,
      year: inputs.get("year")!.value,
      materials: inputs.get("materials")!.value,
      finish: inputs.get("finish")!.value,
      colour_family: family.value,
      source_url: inputs.get("source_url")!.value,
      source_note: inputs.get("source_note")!.value,
      notes: inputs.get("notes")!.value,
    };
    try {
      const updated = await api.patchReference(this.reference.id, body);
      deckStatus.set(COPY.factsSaved);
      this.reference = updated;
      await this.load();
    } catch (err) {
      if (err instanceof ApiError && err.code === "reference_version_conflict") {
        deckStatus.set(COPY.factsConflict);
        await this.load();
        document.getElementById("edit-facts")?.focus();
      } else if (err instanceof ApiError && err.status === 422 && err.fields) {
        deckStatus.set(COPY.capture422);
        for (const [key, message] of Object.entries(err.fields)) {
          const input = inputs.get(key);
          if (input) {
            input.setAttribute("aria-invalid", "true");
            input.setAttribute("aria-describedby", `edit-${key}-error`);
            document.getElementById(`edit-${key}-error`)!.textContent = message;
          }
        }
        const first = Object.keys(err.fields)[0];
        inputs.get(first)?.focus();
      } else {
        deckStatus.set(COPY.genericFailure);
      }
    }
  }

  private async resetSwatch(): Promise<void> {
    if (!this.reference) return;
    deckStatus.set(COPY.measuringSwatch);
    try {
      const updated = await api.resetSwatch(this.reference.id);
      deckStatus.set(COPY.swatchReset);
      this.reference = updated;
      this.refreshTile();
      document.getElementById("reset-swatch")!.style.display = "none";
    } catch {
      deckStatus.set(COPY.capture503);
    }
  }

  private refreshTile(): void {
    if (!this.reference) return;
    this.tile.show({ swatch: this.reference.swatch, photoUrl: this.reference.photo.display_url,
      name: this.reference.title, sizeLine: this.reference.size_text[this.unit] });
  }

  private openEyedropper(opener: HTMLElement): void {
    if (!this.reference) return;
    // The tile switches to the whole photo view while eyedropper mode is open.
    this.tile.show({ swatch: this.reference.swatch, photoUrl: this.reference.photo.original_url,
      name: this.reference.title, sizeLine: this.reference.size_text[this.unit] }, true);
    let x = 0.5, y = 0.5;
    const handle = openDialog((root, close) => {
      const group = el("div", { role: "group", "aria-label": "Eyedropper" });
      const crosshair = el("div", { tabindex: "0" });
      crosshair.setAttribute("aria-label", "Crosshair");
      crosshair.style.position = "absolute";
      crosshair.style.width = "24px";
      crosshair.style.height = "24px";
      crosshair.style.border = "2px solid white";
      crosshair.style.borderRadius = "50%";
      crosshair.style.background = "rgba(255,45,120,0.35)";
      crosshair.style.pointerEvents = "none";
      const use = el("button", { type: "button" });
      use.textContent = "Use this colour";
      use.addEventListener("click", async () => {
        if (!this.reference) return;
        deckStatus.set(COPY.measuringSwatch);
        try {
          const updated = await api.swatch(this.reference.id, x, y);
          deckStatus.set(COPY.swatchSet);
          this.reference = updated;
          document.getElementById("reset-swatch")!.style.display = "";
          this.refreshTile();
        } catch {
          deckStatus.set(COPY.capture503);
        }
        close();
      });
      const cancel = el("button", { type: "button" });
      cancel.textContent = "Cancel eyedropper";
      cancel.addEventListener("click", () => { close(); });
      group.append(crosshair, use, cancel);
      root.append(group);

      const photoBox = this.tile.photo.getBoundingClientRect();
      const tileBox = this.tile.tile.getBoundingClientRect();
      crosshair.style.position = "fixed";
      const paint = () => {
        const px = photoBox.left + x * photoBox.width;
        const py = photoBox.top + y * photoBox.height;
        crosshair.style.left = `${px - tileBox.left}px`;
        crosshair.style.top = `${py - tileBox.top}px`;
      };
      paint();
      this.tile.tile.append(crosshair);

      crosshair.addEventListener("keydown", (e) => {
        const step = e.shiftKey ? 0.1 : 0.01;
        if (e.key === "ArrowLeft") x = Math.max(0, x - step);
        else if (e.key === "ArrowRight") x = Math.min(1, x + step);
        else if (e.key === "ArrowUp") y = Math.max(0, y - step);
        else if (e.key === "ArrowDown") y = Math.min(1, y + step);
        else if (e.key === "Enter") { use.click(); return; }
        else return;
        e.preventDefault();
        paint();
      });
      const onPointer = (e: PointerEvent) => {
        if (e.clientX < photoBox.left || e.clientX > photoBox.right
          || e.clientY < photoBox.top || e.clientY > photoBox.bottom) return;
        x = Math.min(Math.max((e.clientX - photoBox.left) / photoBox.width, 0), 1);
        y = Math.min(Math.max((e.clientY - photoBox.top) / photoBox.height, 0), 1);
        paint();
      };
      this.tile.tile.addEventListener("pointerdown", onPointer);
      crosshair.focus();
      const restore = () => {
        crosshair.remove();
        this.tile.tile.removeEventListener("pointerdown", onPointer);
        this.refreshTile();
        opener.focus();
      };
      // Restore the cropped tile when the mode closes.
      const originalClose = close;
      void originalClose;
      use.addEventListener("click", () => window.setTimeout(restore, 0), { once: true });
      cancel.addEventListener("click", () => window.setTimeout(restore, 0), { once: true });
      document.addEventListener("keydown", function onEsc(e: KeyboardEvent) {
        if (e.key === "Escape") { window.setTimeout(restore, 0); document.removeEventListener("keydown", onEsc, true); }
      }, true);
    }, opener);
    void handle;
  }

  private async openAddToReel(opener: HTMLElement): Promise<void> {
    if (!this.reference) return;
    const reels = await api.reels();
    openDialog((root, close) => {
      root.setAttribute("aria-label", "Add to reel");
      const group = el("fieldset");
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-label", "Reel");
      const legend = el("legend");
      legend.textContent = "Reel";
      group.append(legend);
      for (const reel of reels.reels) {
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "reel";
        radio.value = reel.id;
        radio.setAttribute("aria-label", reel.name);
        group.append(radio);
      }
      const add = el("button", { type: "button", class: "primary" });
      add.textContent = "Add";
      add.addEventListener("click", async () => {
        const chosen = root.querySelector<HTMLInputElement>("input[name='reel']:checked");
        if (!chosen || !this.reference) return;
        const reel = reels.reels.find((r) => r.id === chosen.value)!;
        try {
          await api.appendStop(chosen.value, this.reference.id);
          deckStatus.set(COPY.addedToReel(reel.name));
          close();
        } catch (err) {
          if (err instanceof ApiError && err.code === "already_in_reel") {
            deckStatus.set(COPY.alreadyInReel(this.reference.title, reel.name));
          } else if (err instanceof ApiError && err.code === "reel_full") {
            deckStatus.set(COPY.reelFull);
          } else {
            deckStatus.set(COPY.genericFailure);
          }
        }
      });
      root.append(group, add);
    }, opener);
  }

  private openTrashDialog(opener: HTMLElement): void {
    if (!this.reference) return;
    const title = this.reference.title;
    openDialog((root, close) => {
      root.setAttribute("aria-label", "Move to trash?");
      const line = text("p", `${title} will be purged 30 days after it is trashed unless you restore it.`);
      const trash = el("button", { type: "button", class: "primary" });
      trash.textContent = "Move to trash";
      const keep = el("button", { type: "button" });
      keep.textContent = "Keep it";
      keep.addEventListener("click", close);
      trash.addEventListener("click", async () => {
        try {
          await api.trash(this.reference!.id);
          deckStatus.set(COPY.movedToTrash(title));
          close();
          this.ctx.navigate("/library");
        } catch {
          deckStatus.set(COPY.genericFailure);
        }
      });
      root.append(line, keep, trash);
      keep.focus();
    }, opener);
  }
}
