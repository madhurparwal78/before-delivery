// Capture: the photo, the facts form, the whole photo view in the tile and the
// eyedropper. The pending copy shows the moment Save to deck is pressed.

import type { ScreenContext } from "./main.js";
import { api, ApiError } from "./api.js";
import { COLOUR_FAMILIES, type Unit } from "../shared/domain.js";
import { el, text, buildTile, deckStatus, openDialog, type TileParts, prefersReducedMotion } from "./dom.js";
import { COPY } from "./copy.js";

interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "textarea";
}

const TEXT_FIELDS: FieldSpec[] = [
  { name: "title", label: "Name" },
  { name: "maker", label: "Maker" },
  { name: "year", label: "Year" },
  { name: "width", label: "Width" },
  { name: "height", label: "Height" },
  { name: "depth", label: "Depth" },
  { name: "materials", label: "Materials" },
  { name: "finish", label: "Finish" },
  { name: "source_url", label: "Source link" },
  { name: "source_note", label: "Where you found it" },
  { name: "notes", label: "Notes", type: "textarea" },
];

export class CaptureScreen {
  private tile: TileParts;
  private inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  private fileInput!: HTMLInputElement;
  private saveButton!: HTMLButtonElement;
  private pickSwatchButton!: HTMLButtonElement;
  private unit: Unit = "mm";
  private swatchPoint: { x: number; y: number } | null = null;
  private idempotencyKey = newKeyId();
  private photoData: { url: string; file: File } | null = null;

  constructor(private ctx: ScreenContext) {
    this.tile = buildTile("Current reference");
    this.tile.showEmpty(COPY.openingDeck, true);
    ctx.field.append(this.tile.figure);
    ctx.main.append(text("h1", "Capture an object"));

    // Photograph first, in the published form order.
    const photoLabel = el("label", { for: "photo" });
    photoLabel.textContent = "Photograph";
    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.id = "photo";
    this.fileInput.accept = "image/jpeg,image/png";
    this.fileInput.setAttribute("capture", "environment");
    this.fileInput.setAttribute("aria-label", "Photograph");
    this.fileInput.addEventListener("change", () => this.onPhotoChosen());
    const photoError = text("p", "", { class: "field-error", id: "photo-error" });
    ctx.main.append(photoLabel, this.fileInput, photoError);

    this.pickSwatchButton = el("button", { type: "button" }) as HTMLButtonElement;
    this.pickSwatchButton.textContent = "Pick swatch";
    this.pickSwatchButton.addEventListener("click", () => this.openEyedropper());
    ctx.main.append(this.pickSwatchButton);

    for (const spec of TEXT_FIELDS) {
      const label = el("label", { for: spec.name });
      label.textContent = spec.label;
      const input = spec.type === "textarea"
        ? document.createElement("textarea")
        : document.createElement("input");
      input.id = spec.name;
      input.setAttribute("aria-label", spec.label);
      const error = text("p", "", { class: "field-error", id: `${spec.name}-error` });
      ctx.main.append(label, input, error);
      this.inputs.set(spec.name, input);
      if (spec.name === "width" || spec.name === "height" || spec.name === "depth") {
        input.addEventListener("input", () => this.relabelSizes());
      }
    }

    // Size unit, then colour family.
    ctx.main.append(this.buildUnitGroup());
    const familyLabel = el("label", { for: "colour-family" });
    familyLabel.textContent = "Colour family";
    const familySelect = document.createElement("select");
    familySelect.id = "colour-family";
    familySelect.setAttribute("aria-label", "Colour family");
    for (const family of COLOUR_FAMILIES) {
      const option = el("option", { value: family });
      option.textContent = family;
      familySelect.append(option);
    }
    this.inputs.set("colour_family", familySelect as unknown as HTMLInputElement);
    ctx.main.append(familyLabel, familySelect);

    this.saveButton = el("button", { type: "button", class: "primary" }) as HTMLButtonElement;
    this.saveButton.textContent = "Save to deck";
    this.saveButton.addEventListener("click", () => void this.save());
    ctx.main.append(this.saveButton);
    this.relabelSizes();
  }

  private buildUnitGroup(): HTMLElement {
    const group = el("fieldset");
    const legend = el("legend");
    legend.textContent = "Size unit";
    group.append(legend);
    const radios: HTMLInputElement[] = [];
    for (const unit of ["mm", "in"] as const) {
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "unit";
      radio.value = unit;
      radio.id = `unit-${unit}`;
      radio.setAttribute("aria-label", unit);
      if (unit === this.unit) radio.checked = true;
      radio.addEventListener("change", () => {
        if (radio.checked) this.unit = unit;
        // The toggle changes how the size fields are read; it does not convert.
      });
      group.append(radio);
      radios.push(radio);
    }
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "Size unit");
    return group;
  }

  private relabelSizes(): void {
    for (const name of ["width", "height", "depth"]) {
      const input = this.inputs.get(name) as HTMLInputElement;
      input.setAttribute("aria-label", `${name.charAt(0).toUpperCase()}${name.slice(1)}`);
    }
  }

  private onPhotoChosen(): void {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    this.photoData = { url: URL.createObjectURL(file), file };
    this.swatchPoint = null;
    this.tile.show({ swatch: "var(--surface)", photoUrl: this.photoData.url, name: "", sizeLine: "" }, true);
  }

  private openEyedropper(): void {
    if (!this.photoData) return;
    const group = el("div", { role: "group", "aria-label": "Eyedropper" });
    const crosshair = el("div", { class: "crosshair", tabindex: "0" });
    crosshair.setAttribute("aria-label", "Crosshair");
    const use = el("button", { type: "button" });
    use.textContent = "Use this colour";
    const cancel = el("button", { type: "button" });
    cancel.textContent = "Cancel eyedropper";

    let x = 0.5, y = 0.5;
    const paint = () => {
      crosshair.style.left = `${x * 100}%`;
      crosshair.style.top = `${y * 100}%`;
    };
    paint();
    crosshair.style.position = "absolute";
    crosshair.style.width = "24px";
    crosshair.style.height = "24px";
    crosshair.style.marginLeft = "-12px";
    crosshair.style.marginTop = "-12px";
    crosshair.style.border = "2px solid white";
    crosshair.style.borderRadius = "50%";
    crosshair.style.pointerEvents = "none";
    crosshair.style.background = "rgba(255,45,120,0.35)";

    const tileBox = this.tile.tile.getBoundingClientRect();
    const photoBox = this.tile.photo.getBoundingClientRect();
    const leftInPhoto = (e: PointerEvent) => {
      const px = Math.min(Math.max(e.clientX - photoBox.left, 0), photoBox.width);
      const py = Math.min(Math.max(e.clientY - photoBox.top, 0), photoBox.height);
      x = px / photoBox.width;
      y = py / photoBox.height;
      paint();
    };

    crosshair.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 0.1 : 0.01;
      if (e.key === "ArrowLeft") x = Math.max(0, x - step);
      else if (e.key === "ArrowRight") x = Math.min(1, x + step);
      else if (e.key === "ArrowUp") y = Math.max(0, y - step);
      else if (e.key === "ArrowDown") y = Math.min(1, y + step);
      else if (e.key === "Enter") { this.swatchPoint = { x, y }; handle.close(); return; }
      else return;
      e.preventDefault();
      paint();
    });

    const onPointer = (e: PointerEvent) => {
      // A point outside the shown photo does nothing.
      if (e.clientX < photoBox.left || e.clientX > photoBox.right
        || e.clientY < photoBox.top || e.clientY > photoBox.bottom) return;
      leftInPhoto(e);
    };
    this.tile.tile.addEventListener("pointerdown", onPointer);
    void tileBox;

    const build = (root: HTMLElement, close: () => void) => {
      use.addEventListener("click", () => { this.swatchPoint = { x, y }; close(); });
      cancel.addEventListener("click", () => close());
      root.append(group);
      group.append(crosshair, use, cancel);
      crosshair.style.position = "absolute";
      void root.offsetWidth;
      crosshair.focus();
    };
    const handle = openDialog(build, this.pickSwatchButton);
    // The dialog hosts the crosshair visually over the tile.
    document.querySelector(".dialog")?.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") return;
    });
    this.tile.tile.append(crosshair);
    crosshair.style.position = "absolute";
    crosshair.style.zIndex = "5";
    crosshair.focus();
  }

  private async save(): Promise<void> {
    if (this.saveButton.getAttribute("aria-disabled") === "true") return;
    // The pending copy shows the moment Save to deck is pressed, before any answer.
    deckStatus.set(COPY.savingOriginal);
    this.saveButton.setAttribute("aria-disabled", "true");

    const form = new FormData();
    form.append("photo", this.photoData?.file ?? "");
    for (const [name, input] of this.inputs) {
      if (name === "colour_family") {
        form.append(name, (input as unknown as HTMLSelectElement).value);
      } else {
        form.append(name, input.value);
      }
    }
    form.append("unit", this.unit);
    if (this.swatchPoint) {
      form.append("swatch_x", String(this.swatchPoint.x));
      form.append("swatch_y", String(this.swatchPoint.y));
    }

    try {
      await api.capture(form, this.idempotencyKey);
      deckStatus.set(COPY.savedToDeck);
      this.clearForm();
      this.idempotencyKey = newKeyId();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 422 && err.fields) {
          deckStatus.set(COPY.capture422);
          this.markInvalid(err.fields);
        } else if (err.code === "idempotency_in_flight") {
          deckStatus.set(COPY.idempotencyInFlight);
          this.saveButton.focus();
        } else if (err.status === 503) {
          deckStatus.set(COPY.capture503);
          this.saveButton.focus();
        } else {
          deckStatus.set(err.message || COPY.genericFailure);
        }
        if (err.status !== 422) this.saveButton.focus();
      } else {
        deckStatus.set(COPY.genericFailure);
        this.saveButton.focus();
      }
    } finally {
      this.saveButton.removeAttribute("aria-disabled");
    }
  }

  private clearForm(): void {
    for (const [, input] of this.inputs) {
      if (input instanceof HTMLSelectElement) input.selectedIndex = 0;
      else input.value = "";
    }
    this.fileInput.value = "";
    this.photoData = null;
    this.swatchPoint = null;
    this.tile.showEmpty(COPY.openingDeck, true);
  }

  // Each field the answer names is marked invalid and linked to its error text;
  // focus moves to the first of them in the published form order.
  private markInvalid(fields: Record<string, string>): void {
    const order = ["photo", "swatch", "title", "maker", "year", "unit", "width", "height", "depth",
      "materials", "finish", "colour_family", "source_url", "source_note", "notes"];
    let firstKey: string | null = null;
    for (const key of order) {
      const message = fields[key] ?? fields[`${key}_x`] ?? fields[`${key}_y`];
      const isSwatch = key === "swatch" && (fields.swatch_x || fields.swatch_y);
      if (!message && !isSwatch) continue;
      const control = key === "photo" ? this.fileInput : this.inputs.get(key);
      if (key === "swatch" || key === "unit") continue;
      if (control) {
        control.setAttribute("aria-invalid", "true");
        control.setAttribute("aria-describedby", `${key}-error`);
        const errorEl = document.getElementById(`${key}-error`);
        if (errorEl) errorEl.textContent = isSwatch ? (fields.swatch_x ?? fields.swatch_y ?? "") : message;
        if (!firstKey) firstKey = key;
      } else if (key === "photo") {
        const errorEl = document.getElementById("photo-error");
        if (errorEl) errorEl.textContent = message;
        if (!firstKey) firstKey = "photo";
      }
    }
    const first = firstKey === "photo" ? this.fileInput : this.inputs.get(firstKey ?? "");
    first?.focus();
  }
}

let keyCounter = 0;
function newKeyId(): string {
  keyCounter += 1;
  return `capture-${Date.now()}-${keyCounter}-${Math.random().toString(36).slice(2, 10)}`;
}
