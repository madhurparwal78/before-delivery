// Shared client components: seat lanes with the Hatch Seam motion, drawer, dialog, status regions, polling.
import { el, prefersReducedMotion, formatHMM } from "./lib";
import { SeatStatus } from "../shared/domain";

export interface SeatLike {
  seat: number;
  status: SeatStatus;
  interpreter_initials?: string | null;
}

/** A seat lane group: hatched + `open` when open; solid + initials when held or served. */
export function seatLane(seat: SeatLike, opts: { seam?: "none" | "forward" | "reverse" } = {}): HTMLDivElement {
  const open = seat.status === "open";
  const label = open ? "open" : (seat.interpreter_initials ?? "");
  const lane = el("div", {
    role: "group",
    "aria-label": `Seat ${seat.seat}`,
    class: `lane ${open ? "hatched" : "held"}`,
  });
  if (!open) {
    const fill = el("div", { class: "fill" });
    if (opts.seam === "forward" && !prefersReducedMotion()) fill.classList.add("seam");
    if (opts.seam === "reverse" && !prefersReducedMotion()) fill.classList.add("seam-reverse");
    lane.append(fill);
  }
  lane.append(el("span", { class: "label", text: label }));
  return lane;
}

export function seatLanes(seats: SeatLike[], seams: Record<number, "forward" | "reverse"> = {}): HTMLDivElement {
  const wrap = el("div", { class: "lanes" });
  for (const seat of seats) {
    wrap.append(seatLane(seat, { seam: seats.length > 0 ? (seams[seat.seat] ?? "none") : "none" }));
  }
  return wrap;
}

export function coveredCountText(covered: number, seats: number): string {
  return `${covered} of ${seats} covered`;
}

// ── Status region (polite live region with a name) ───────────────────────────

export function statusRegion(name: string, initialText = ""): { region: HTMLDivElement; set: (text: string) => void; el: HTMLDivElement } {
  const region = el("div", {
    role: "status",
    "aria-label": name,
    class: "status-line",
    text: initialText,
  });
  return { region, set: (text: string) => { region.textContent = text; }, el: region };
}

// ── Polling loop ──────────────────────────────────────────────────────────────

/** Poll while the screen's container stays connected to the document. */
export function pollWhileConnected(container: HTMLElement, fn: () => void | Promise<void>, intervalMs = 2500): void {
  const tick = async (): Promise<void> => {
    if (!container.isConnected) return;
    try {
      await fn();
    } catch {
      // The screen's own error copy handles outage text.
    }
    if (container.isConnected) setTimeout(tick, intervalMs);
  };
  setTimeout(tick, intervalMs);
}

// ── Drawer ────────────────────────────────────────────────────────────────────

export interface DrawerHandle {
  container: HTMLDivElement;
  close: () => void;
  open: (content: HTMLElement, opener: HTMLElement | null, heading: string) => void;
}

export function createDrawer(): DrawerHandle {
  const container = el("div", { class: "drawer", role: "dialog", "aria-modal": "false" });
  let currentOpener: HTMLElement | null = null;
  let openerLabel: string | null = null;
  let dialogEl: HTMLElement | null = null;

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const trapKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeDrawer();
      return;
    }
    if (e.key === "Tab" && dialogEl) {
      const focusables = Array.from(dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const closeDrawer = (): void => {
    if (!dialogEl) return;
    const node = container;
    const finish = (): void => {
      node.remove();
      document.removeEventListener("keydown", trapKey);
      dialogEl = null;
      // A re-render may have replaced the opener; find it again by its label.
      const target =
        currentOpener?.isConnected
          ? currentOpener
          : openerLabel !== null
            ? document.querySelector<HTMLElement>(`[aria-label="${openerLabel.replace(/"/g, '\\"')}"]`)
            : null;
      target?.focus();
      currentOpener = null;
      openerLabel = null;
    };
    if (prefersReducedMotion()) {
      finish();
    } else {
      node.classList.remove("anim-in");
      node.classList.add("anim-out");
      node.addEventListener("animationend", finish, { once: true });
      setTimeout(finish, 400); // safety net if animations are suppressed
    }
  };

  const open = (content: HTMLElement, opener: HTMLElement | null, heading: string): void => {
    currentOpener = opener;
    openerLabel = opener?.getAttribute("aria-label") ?? null;
    container.replaceChildren();
    const headingEl = el("h2", { id: "drawer-heading", text: heading, tabindex: "-1" });
    const closeBtn = el("button", { class: "btn btn-quiet", onclick: () => closeDrawer(), text: "Close" });
    container.append(headingEl, closeBtn, content);
    container.setAttribute("aria-labelledby", "drawer-heading");
    container.classList.remove("anim-out");
    container.classList.add("anim-in");
    if (!container.isConnected) document.body.append(container);
    dialogEl = container;
    document.addEventListener("keydown", trapKey);
    headingEl.focus();
  };

  return { container, close: closeDrawer, open };
}

// ── Dialog ─────────────────────────────────────────────────────────────────────

export interface DialogHandle {
  underlay: HTMLDivElement;
  close: () => void;
}

export function openDialog(labelledBy: string, content: HTMLElement, onClose: () => void): DialogHandle {
  const underlay = el("div", { class: "dialog-underlay anim-in", onclick: (e: Event) => { if (e.target === underlay) close(); } });
  const dialog = el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": labelledBy });
  dialog.append(content);
  underlay.append(dialog);
  document.body.append(underlay);

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const keydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener("keydown", keydown);

  const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
  (focusables[0] ?? dialog).focus();

  function close(): void {
    document.removeEventListener("keydown", keydown);
    underlay.remove();
    onClose();
  }

  return { underlay, close };
}

// ── Field helper ───────────────────────────────────────────────────────────────

export interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "date" | "time" | "number" | "password" | "search" | "file" | "email" | "tel";
  value?: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
}

export function formField(spec: FieldSpec): { row: HTMLDivElement; input: HTMLInputElement | HTMLSelectElement; error: HTMLDivElement } {
  const id = `f-${spec.name}-${Math.random().toString(36).slice(2, 8)}`;
  const errorId = `${id}-error`;
  const input = spec.options
    ? el("select", { id, name: spec.name })
    : el("input", {
        id,
        name: spec.name,
        type: spec.type ?? "text",
        ...(spec.value !== undefined ? { value: spec.value } : {}),
        ...(spec.min !== undefined ? { min: String(spec.min) } : {}),
        ...(spec.max !== undefined ? { max: String(spec.max) } : {}),
        ...(spec.step !== undefined ? { step: String(spec.step) } : {}),
        ...(spec.placeholder ? { placeholder: spec.placeholder } : {}),
        ...(spec.type === "number" ? { "aria-describedby": errorId } : {}),
      });
  if (spec.options) {
    for (const opt of spec.options) {
      input.append(el("option", { value: opt.value, text: opt.label }));
    }
    input.setAttribute("aria-describedby", errorId);
  }
  const error = el("div", { class: "field-error", id: errorId });
  const row = el("div", { class: "field" });
  row.append(el("label", { for: id, text: spec.label }), input, error);
  return { row, input: input as HTMLInputElement, error };
}

/** Uncovered-time numeral in h:mm form. */
export function uncoveredNumeral(minutes: number): string {
  return formatHMM(minutes);
}

/** Animate a numeral counting between values (skipped under reduced motion). */
export function countNumeral(node: HTMLElement, from: number, to: number, format: (n: number) => string): void {
  if (prefersReducedMotion() || from === to) {
    node.textContent = format(to);
    return;
  }
  const duration = 330;
  const start = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / duration);
    const value = Math.round(from + (to - from) * t);
    node.textContent = format(value);
    if (t < 1) requestAnimationFrame(step);
    else node.textContent = format(to);
  };
  requestAnimationFrame(step);
}
