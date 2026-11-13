import { el, overlaysEl, state } from "./app.js";
import type { Match } from "../shared/types.js";
import { slotName } from "../shared/types.js";

export interface SheetSpec {
  title: string;
  fields: HTMLElement[];
  actions: HTMLElement[];
  onClose: () => void;
  labelledBy?: string;
}

let openSheets: { dialog: HTMLDialogElement; onClose: () => void; opener: HTMLElement | null }[] = [];
let suppressEscape = false;

/** Modal dialog: Tab wraps inside, Escape or Cancel closes with nothing sent. */
export function openSheet(spec: SheetSpec, opener: HTMLElement | null): HTMLDialogElement {
  const overlays = overlaysEl();
  const dialog = el("dialog", { class: "sheet" }) as HTMLDialogElement;
  if (spec.labelledBy) dialog.setAttribute("aria-labelledby", spec.labelledBy);
  const titleEl = el("h2", { class: "sheet-title", id: spec.labelledBy ?? "sheet-title" }, [spec.title]);
  const status = el("div", { class: "small muted", attrs: { role: "status", id: "dialog-status", "aria-label": "Dialog status" } }, [""]);
  const cancel = el("button", { class: "btn btn--secondary", on: { click: () => closeTopSheet() } }, ["Cancel"]);
  const body = el("div", { class: "sheet-body" }, [
    titleEl,
    ...spec.fields,
    status,
    el("div", { class: "sheet-actions" }, [...spec.actions, cancel]),
  ]);
  dialog.appendChild(body);
  overlays.appendChild(dialog);
  dialog.showModal();
  openSheets.push({ dialog, onClose: spec.onClose, opener });

  // Tab and Shift+Tab wrap inside the dialog
  dialog.addEventListener("keydown", (ev) => {
    if (ev.key !== "Tab") return;
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter((n) => !n.hasAttribute("disabled") && n.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const current = document.activeElement as HTMLElement;
    if (!ev.shiftKey && current === last) {
      ev.preventDefault();
      first.focus();
    } else if (ev.shiftKey && (current === first || current === dialog)) {
      ev.preventDefault();
      last.focus();
    }
  });
  dialog.addEventListener("cancel", (ev) => {
    if (suppressEscape) {
      suppressEscape = false;
      return;
    }
    ev.preventDefault();
    closeTopSheet();
  });
  const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("button, input, select, textarea"));
  (focusables.find((f) => f.tagName === "INPUT" && f.getAttribute("type") !== "hidden") ?? focusables[0])?.focus();
  return dialog;
}

export function closeTopSheet(): void {
  const top = openSheets.pop();
  if (!top) return;
  top.dialog.close();
  top.dialog.remove();
  top.onClose();
  // focus returns to the control that opened it
  if (top.opener && top.opener.isConnected) top.opener.focus();
}

export function closeSheetFor(dialog: HTMLDialogElement): void {
  const idx = openSheets.findIndex((s) => s.dialog === dialog);
  if (idx === -1) return;
  const entries = openSheets.slice(idx);
  openSheets = openSheets.slice(0, idx);
  for (const entry of entries.reverse()) {
    entry.dialog.close();
    entry.dialog.remove();
  }
}

/** Close every sheet, returning focus to the given card. */
export function closeSheetsToCard(card: HTMLElement | null): void {
  const entries = openSheets;
  openSheets = [];
  for (const entry of entries.reverse()) {
    entry.dialog.close();
    entry.dialog.remove();
  }
  // the card node may have been re-rendered by the live update; re-query by id
  const matchId = card?.dataset.matchId;
  const target = matchId
    ? (document.querySelector<HTMLElement>(`[data-match-id="${matchId}"]`) ?? card)
    : card;
  target?.setAttribute("tabindex", "0");
  target?.focus();
}

export function sheetStatus(text: string): void {
  const node = document.getElementById("dialog-status");
  if (node) node.textContent = text;
}

export function busy(on: boolean): void {
  for (const s of openSheets) {
    s.dialog.querySelectorAll("button").forEach((b) => {
      if (b.textContent === "Cancel") return;
      (b as HTMLButtonElement).disabled = on;
    });
  }
  sheetStatus(on ? "Saving..." : "");
}

/** Two spinbuttons for a score, upper side first. */
export function scoreFields(m: Match, upperGames?: number, lowerGames?: number): { host: HTMLElement; upper: HTMLInputElement; lower: HTMLInputElement } {
  const upperName = slotName(m.upper);
  const lowerName = slotName(m.lower);
  const upper = el("input", {
    class: "seed-input",
    type: "number",
    attrs: { min: "0", max: "99", step: "1", value: String(upperGames ?? 0) },
    ariaLabel: `${upperName} games`,
  }) as HTMLInputElement;
  const lower = el("input", {
    class: "seed-input",
    type: "number",
    attrs: { min: "0", max: "99", step: "1", value: String(lowerGames ?? 0) },
    ariaLabel: `${lowerName} games`,
  }) as HTMLInputElement;
  const host = el("div", { class: "stack" }, [
    el("div", { class: "field" }, [el("label", {}, [`${upperName} games`]), upper]),
    el("div", { class: "field" }, [el("label", {}, [`${lowerName} games`]), lower]),
  ]);
  return { host, upper, lower };
}

export function scoreValues(upper: HTMLInputElement, lower: HTMLInputElement): { upper_games: number; lower_games: number } | null {
  const u = Number(upper.value);
  const l = Number(lower.value);
  if (!Number.isInteger(u) || u < 0 || u > 99) return null;
  if (!Number.isInteger(l) || l < 0 || l > 99) return null;
  return { upper_games: u, lower_games: l };
}

export function fieldError(text: string): HTMLElement {
  return el("p", { class: "field-error", attrs: { role: "alert" } }, [text]);
}

/** Auto-confirm countdown text, display only, computed from the server's timestamps. */
export function countdownText(autoConfirmAt: string): string {
  const base = state.config?.server_time ? new Date(state.config.server_time).getTime() : Date.now();
  const target = new Date(autoConfirmAt).getTime();
  const remaining = Math.max(0, Math.round((target - base) / 1000));
  if (remaining <= 0) return "Confirming...";
  return `Auto-confirms in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
}

export function clearSheetErrors(dialog: HTMLDialogElement | null): void {
  if (!dialog) return;
  dialog.querySelectorAll(".field-error").forEach((n) => n.remove());
}
