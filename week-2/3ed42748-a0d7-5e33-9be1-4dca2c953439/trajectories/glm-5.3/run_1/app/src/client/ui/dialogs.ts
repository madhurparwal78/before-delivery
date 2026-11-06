// Dialogs: letters, outfitter, stamp history, claim save, mail, revoke, photo mode and
// the moderation drawer, with the keyboard and focus rules.

import { h, icon } from "../dom.js";
import type { DepotMission } from "./cards.js";

/** A paper dialog with a perforated edge; Escape closes it and focus returns to its opener. */
export class Dialog {
  readonly el: HTMLElement;
  private opener: HTMLElement | null = null;
  private onClose: (() => void) | null = null;

  constructor(parent: HTMLElement, label: string, cls: string, firstControl?: HTMLElement | null) {
    this.el = h("div", { role: "dialog", "aria-label": label, class: `paper-dialog ${cls}`, "aria-modal": "true", tabindex: "-1" });
    parent.append(this.el);
    this.el.addEventListener("pm-close", () => this.close());
    this.el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.close();
      } else if (e.key === "Tab") {
        const focusables = this.focusables();
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
    });
    if (firstControl) {
      queueMicrotask(() => firstControl.focus());
    }
  }

  focusables(): HTMLElement[] {
    const nodes = Array.from(this.el.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]:not([tabindex='-1'])"));
    return nodes.filter((e) => !e.hasAttribute("disabled") && e.getAttribute("aria-disabled") !== "true");
  }

  open(opener: HTMLElement, first: HTMLElement | null): void {
    this.opener = opener;
    this.el.classList.add("is-open");
    this.el.removeAttribute("aria-hidden");
    (first ?? this.focusables()[0] ?? this.el)?.focus();
  }

  close(): void {
    this.el.classList.remove("is-open");
    this.el.setAttribute("aria-hidden", "true");
    if (this.onClose) this.onClose();
    if (this.opener) this.opener.focus();
  }

  onClosed(fn: () => void): void {
    this.onClose = fn;
  }

  get isOpen(): boolean {
    return this.el.classList.contains("is-open");
  }
}

// ---------------------------------------------------------------------------
// The resident letter: unfolds from the resident's door on screen.

export type LetterHandle = {
  dialog: Dialog;
  showOffer(letter: { residentName: string; home: string; mission: DepotMission }, doorScreen: { x: number; y: number }, onTake: (btn: HTMLElement) => void, onNotNow: () => void): void;
  showThanks(letter: { residentName: string; home: string; lines: string[] }, doorScreen: { x: number; y: number }, onFold: () => void): void;
  setFold(fold: "unfolding" | "open" | "folding", progress: number): void;
  closeNow(): void;
  isOpen(): boolean;
  tick(now: number, reduced: boolean): void;
}

const UNFOLD_MS = 400; // 0.3–0.5 s
const FOLD_MS = 250; // 0.2–0.3 s

export function createLetter(parent: HTMLElement): LetterHandle {
  const el = h("div", { role: "dialog", class: "paper-dialog letter-dialog", "aria-modal": "true", "data-fold": "open", "data-fold-progress": "1.00", "data-unfold-from": "0,0", "aria-hidden": "true" });
  parent.append(el);
  let mode: "offer" | "thanks" | "closed" = "closed";
  let foldStartedAt = 0;
  let foldingTo: "closed" | null = null;
  let onFolded: (() => void) | null = null;
  let opener: HTMLElement | null = null;

  function applyFold(now: number, reduced: boolean): void {
    if (mode === "closed") return;
    if (foldingTo === "closed") {
      const t = reduced ? 1 : Math.min(1, (now - foldStartedAt) / FOLD_MS);
      el.setAttribute("data-fold", "folding");
      el.setAttribute("data-fold-progress", (1 - t).toFixed(2));
      el.style.opacity = String(1 - t);
      const [fx, fy] = (el.getAttribute("data-unfold-from") ?? "0,0").split(",").map(Number);
      const cx = window.innerWidth / 2;
      const cy = 90;
      el.style.transform = `translate(${(fx - cx) * t}px, ${(fy - cy) * t}px) scale(${1 - 0.3 * t})`;
      if (t >= 1) {
        mode = "closed";
        foldingTo = null;
        el.classList.remove("is-open");
        el.style.opacity = "";
        el.style.transform = "";
        if (onFolded) onFolded();
        onFolded = null;
      }
      return;
    }
    if (reduced) {
      el.setAttribute("data-fold", "open");
      el.setAttribute("data-fold-progress", "1.00");
      el.style.opacity = "1";
      el.style.transform = "";
      return;
    }
    const t = Math.min(1, (now - foldStartedAt) / UNFOLD_MS);
    if (t >= 1) {
      el.setAttribute("data-fold", "open");
      el.setAttribute("data-fold-progress", "1.00");
      el.style.opacity = "1";
      el.style.transform = "";
    } else {
      el.setAttribute("data-fold", "unfolding");
      el.setAttribute("data-fold-progress", t.toFixed(2));
      el.style.opacity = String(t);
      const [fx, fy] = (el.getAttribute("data-unfold-from") ?? "0,0").split(",").map(Number);
      const cx = window.innerWidth / 2;
      const cy = 90;
      el.style.transform = `translate(${(fx - cx) * (1 - t)}px, ${(fy - cy) * (1 - t)}px) scale(${0.7 + 0.3 * t})`;
    }
  }

  el.addEventListener("pm-close", () => {
    if (mode !== "closed") fold(() => { if (opener) (opener as HTMLElement).focus(); });
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mode !== "closed") {
      e.stopPropagation();
      fold(() => { if (opener) (opener as HTMLElement).focus(); });
    }
  });

  function fold(after: () => void): void {
    if (mode === "closed") return;
    foldingTo = "closed";
    foldStartedAt = performance.now();
    onFolded = after;
  }

  return {
    dialog: { el } as unknown as Dialog,
    showOffer(letter, doorScreen, onTake, onNotNow) {
      mode = "offer";
      foldingTo = null;
      el.setAttribute("aria-label", `Letter from ${letter.residentName}`);
      el.replaceChildren(
        h("h2", { class: "letter-heading" }, `Letter from ${letter.residentName}`),
        h("p", { class: "letter-home" }, letter.home),
        ...letter.mission.dialogue.offer.map((line) => h("p", { class: "letter-line" }, line)),
        h("p", { class: "letter-reward" }, `+${letter.mission.reward_stamps} stamps`),
        h("div", { class: "letter-buttons" },
          (() => {
            const btn = h("button", { class: "btn btn-primary" }, "Take the parcel");
            btn.addEventListener("click", () => onTake(btn));
            return btn;
          })(),
          (() => {
            const btn = h("button", { class: "btn" }, "Not now");
            btn.addEventListener("click", onNotNow);
            return btn;
          })(),
        ),
      );
      el.setAttribute("data-unfold-from", `${clampInt(doorScreen.x)},${clampInt(doorScreen.y)}`);
      el.classList.add("is-open");
      el.removeAttribute("aria-hidden");
      foldStartedAt = performance.now();
    },
    showThanks(letter, doorScreen, onFold) {
      mode = "thanks";
      foldingTo = null;
      el.setAttribute("aria-label", `Letter from ${letter.residentName}`);
      el.replaceChildren(
        h("h2", { class: "letter-heading" }, `Letter from ${letter.residentName}`),
        h("p", { class: "letter-home" }, letter.home),
        ...letter.lines.map((line) => h("p", { class: "letter-line" }, line)),
        h("div", { class: "letter-buttons" },
          (() => {
            const btn = h("button", { class: "btn btn-primary" }, "Fold letter");
            btn.addEventListener("click", onFold);
            return btn;
          })(),
        ),
      );
      el.setAttribute("data-unfold-from", `${clampInt(doorScreen.x)},${clampInt(doorScreen.y)}`);
      el.classList.add("is-open");
      el.removeAttribute("aria-hidden");
      foldStartedAt = performance.now();
    },
    setFold(fold, progress) {
      el.setAttribute("data-fold", fold);
      el.setAttribute("data-fold-progress", progress.toFixed(2));
    },
    closeNow() {
      mode = "closed";
      foldingTo = null;
      el.classList.remove("is-open");
      el.setAttribute("aria-hidden", "true");
      el.style.opacity = "";
      el.style.transform = "";
      el.setAttribute("data-fold", "open");
      el.setAttribute("data-fold-progress", "1.00");
    },
    isOpen: () => mode !== "closed",
    tick(now, reduced) {
      applyFold(now, reduced);
    },
  };
}

function clampInt(n: number): number {
  const w = window.innerWidth;
  return Math.round(Math.max(0, Math.min(n, w)) || 0);
}

// ---------------------------------------------------------------------------
// Outfitter

export type OutfitterSatchel = { satchel_id: string; name: string; price: number; colour: string; owned: boolean; worn: boolean };

export function openOutfitter(parent: HTMLElement, opener: HTMLElement, satchels: OutfitterSatchel[], handlers: {
  onBuy: (s: OutfitterSatchel, btn: HTMLElement) => void;
  onWear: (s: OutfitterSatchel) => void;
  onClosed: () => void;
}): Dialog {
  const rows = satchels.map((s) => {
    const row = h("div", { class: "outfitter-row", "data-satchel": s.satchel_id });
    row.append(h("span", { class: "outfitter-name" }, s.name), h("span", { class: "outfitter-price" }, `${s.price} stamps`));
    if (s.worn) {
      row.append(h("span", { class: "outfitter-worn" }, "Wearing"));
    } else if (s.owned) {
      const btn = h("button", { class: "btn btn-small", "aria-label": `Wear ${s.name}` }, "Wear");
      btn.addEventListener("click", () => handlers.onWear(s));
      row.append(btn);
    } else {
      const btn = h("button", { class: "btn btn-small", "aria-label": `Buy ${s.name}` }, "Buy");
      btn.addEventListener("click", () => handlers.onBuy(s, btn));
      row.append(btn);
    }
    return row;
  });
  const dialog = new Dialog(parent, "Outfitter", "outfitter-dialog");
  dialog.el.replaceChildren(h("h2", { class: "dialog-heading" }, "Outfitter"), ...rows);
  dialog.onClosed(handlers.onClosed);
  dialog.open(opener, null);
  return dialog;
}

// ---------------------------------------------------------------------------
// Stamp history

export type Movement = {
  movement_id: string;
  kind: "delivery" | "purchase";
  created_at: string;
  entries: Array<{ account: string; amount: number; ref: string }>;
};

export function openStampHistory(parent: HTMLElement, opener: HTMLElement, handlers: {
  loadMore: (cursor: string | null, list: HTMLElement, showOlder: HTMLElement, balanceEl: HTMLElement) => Promise<void>;
  onClosed: () => void;
}): Dialog {
  const dialog = new Dialog(parent, "Stamp history", "history-dialog");
  const balanceEl = h("p", { class: "history-balance" });
  const list = h("ul", { role: "list", "aria-label": "Movements", class: "history-list" });
  const showOlder = h("button", { class: "btn btn-small" }, "Show older");
  dialog.el.replaceChildren(h("h2", { class: "dialog-heading" }, "Stamp history"), balanceEl, list, showOlder);
  dialog.onClosed(handlers.onClosed);
  dialog.open(opener, null);
  void handlers.loadMore(null, list, showOlder, balanceEl);
  return dialog;
}

// ---------------------------------------------------------------------------
// Claim this save

export function openClaimSave(parent: HTMLElement, opener: HTMLElement, onSend: (email: string, errEl: HTMLElement) => void, onClosed: () => void): Dialog {
  const dialog = new Dialog(parent, "Claim this save", "claim-dialog");
  const errEl = h("p", { class: "field-error", role: "alert" });
  const input = h("input", { type: "email", class: "field", "aria-label": "Email", placeholder: "name@example.com" }) as HTMLInputElement;
  const send = h("button", { class: "btn btn-primary" }, "Send postbox key");
  send.addEventListener("click", () => onSend(input.value, errEl));
  dialog.el.replaceChildren(
    h("h2", { class: "dialog-heading" }, "Claim this save"),
    h("p", { class: "dialog-copy" }, "Enter your email and we'll send a postbox key."),
    input,
    errEl,
    send,
  );
  dialog.onClosed(onClosed);
  dialog.open(opener, input);
  return dialog;
}

// ---------------------------------------------------------------------------
// Postcard mail and revoke

export function openMailDialog(parent: HTMLElement, opener: HTMLElement, onSend: (email: string, errEl: HTMLElement) => void, onClosed: () => void): Dialog {
  const dialog = new Dialog(parent, "Mail a postcard", "mail-dialog");
  const errEl = h("p", { class: "field-error", role: "alert" });
  const input = h("input", { type: "email", class: "field", "aria-label": "Friend's email", placeholder: "friend@example.com" }) as HTMLInputElement;
  const send = h("button", { class: "btn btn-primary" }, "Send postcard");
  send.addEventListener("click", () => onSend(input.value, errEl));
  dialog.el.replaceChildren(h("h2", { class: "dialog-heading" }, "Mail a postcard"), input, errEl, send);
  dialog.onClosed(onClosed);
  dialog.open(opener, input);
  return dialog;
}

export function openRevokeConfirm(parent: HTMLElement, opener: HTMLElement, onRevoke: () => void, onClosed: () => void): Dialog {
  const dialog = new Dialog(parent, "Revoke postcard", "revoke-dialog");
  const cancel = h("button", { class: "btn" }, "Keep it");
  const confirm = h("button", { class: "btn btn-primary" }, "Revoke");
  confirm.addEventListener("click", onRevoke);
  dialog.el.replaceChildren(
    h("p", { class: "confirm-copy" }, "Revoke this postcard? Its link will stop working."),
    h("div", { class: "confirm-buttons" }, cancel, confirm),
  );
  dialog.onClosed(onClosed);
  cancel.addEventListener("click", () => dialog.close());
  dialog.open(opener, cancel);
  return dialog;
}

// ---------------------------------------------------------------------------
// Photo mode: a thin paper frame; the centre stays see-through.

export type PhotoHandle = {
  el: HTMLElement;
  darkroomStatus: HTMLElement;
  takeBtn: HTMLButtonElement;
  open(opener: HTMLElement, first: HTMLElement | null): void;
  close(): void;
  isOpen(): boolean;
};

export function createPhotoMode(parent: HTMLElement, onTake: () => void, onLeave: () => void): PhotoHandle {
  const el = h("div", { role: "dialog", "aria-label": "Photo mode", class: "photo-mode" });
  const status = h("div", { role: "status", "aria-label": "Darkroom", class: "darkroom-status" }, "Darkroom open");
  const take = h("button", { class: "btn btn-primary" }, "Take postcard") as HTMLButtonElement;
  take.addEventListener("click", onTake);
  const leave = h("button", { class: "btn" }, "Leave photo mode");
  leave.addEventListener("click", onLeave);
  el.append(
    h("div", { class: "photo-strip photo-strip-top" }, status),
    h("div", { class: "photo-strip photo-strip-bottom" }, take, leave),
  );
  parent.append(el);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onLeave();
    }
  });
  return {
    el,
    darkroomStatus: status,
    takeBtn: take,
    open(opener, first) {
      el.classList.add("is-open");
      (first ?? take).focus();
      void opener;
    },
    close() {
      el.classList.remove("is-open");
    },
    isOpen: () => el.classList.contains("is-open"),
  };
}

// ---------------------------------------------------------------------------
// The moderation drawer

export type StaffCourier = {
  moderation_ref: string;
  display_name: string;
  satchel_colour: string;
  position: { lat: number; lon: number; heading_deg: number };
  emote: string | null;
  muted: boolean;
  name_locked: boolean;
};

export type AuditEntry = {
  entry_id: string;
  action: "mute" | "unmute" | "rename";
  actor_role: string;
  actor_display_name: string;
  moderation_ref: string;
  target_name_before: string;
  target_name_after: string;
  at: string;
};

export type ModerationHandle = {
  el: HTMLElement;
  open(opener: HTMLElement): void;
  close(): void;
  isOpen(): boolean;
  render(couriers: StaffCourier[], audit: AuditEntry[]): void;
};

/** Rows ordered by display name in code-point order, then by moderation reference. */
export function sortStaffRows(rows: StaffCourier[]): StaffCourier[] {
  return [...rows].sort((a, b) => {
    const byName = a.display_name < b.display_name ? -1 : a.display_name > b.display_name ? 1 : 0;
    if (byName !== 0) return byName;
    return a.moderation_ref < b.moderation_ref ? -1 : a.moderation_ref > b.moderation_ref ? 1 : 0;
  });
}

export function createModerationDrawer(parent: HTMLElement, handlers: {
  onMute: (ref: string, name: string) => void;
  onUnmute: (ref: string, name: string) => void;
  onRename: (ref: string, name: string) => void;
  onClosed: () => void;
}): ModerationHandle {
  const el = h("div", { role: "dialog", "aria-label": "Moderation drawer", class: "moderation-drawer" });
  const body = h("div", { class: "drawer-body" });
  const auditList = h("ul", { role: "list", "aria-label": "Audit", class: "audit-list", tabindex: "-1" });
  const closeBtn = h("button", { class: "btn drawer-close" }, "Close moderation");
  el.append(body, auditList, closeBtn);
  parent.append(el);
  let focusedRef: string | null = null;
  let focusedKind: "toggle" | "rename" = "toggle";
  let opener: HTMLElement | null = null;

  closeBtn.addEventListener("click", () => close());
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
    if (e.key === "Tab") {
      const focusables = Array.from(el.querySelectorAll<HTMLElement>("button:not([tabindex='-1'])")).filter(
        (b) => b.offsetParent !== null && !b.classList.contains("audit-list"),
      );
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
  });

  function close(): void {
    el.classList.remove("is-open");
    handlers.onClosed();
    if (opener) opener.focus();
  }

  return {
    el,
    open(op) {
      opener = op;
      el.classList.add("is-open");
      const first = el.querySelector<HTMLElement>(".drawer-row button");
      (first ?? closeBtn).focus();
    },
    close,
    isOpen: () => el.classList.contains("is-open"),
    render(couriers, audit) {
      // Remember which courier and button kind had focus, then restore it after the reload.
      const active = document.activeElement as HTMLElement | null;
      if (active && el.contains(active)) {
        const row = active.closest("[data-ref]") as HTMLElement | null;
        if (row) {
          focusedRef = row.getAttribute("data-ref");
          focusedKind = active.classList.contains("btn-rename") ? "rename" : "toggle";
        }
      }
      body.replaceChildren();
      const sorted = sortStaffRows(couriers);
      const rowIndex = sorted.findIndex((c) => c.moderation_ref === focusedRef);
      for (const courier of sorted) {
        const row = h("li", { class: "drawer-row", "data-ref": courier.moderation_ref, "data-name": courier.display_name });
        row.append(h("span", { class: "drawer-name" }, courier.display_name));
        if (courier.muted) {
          const btn = h("button", { class: "btn btn-small btn-toggle", "aria-label": `Unmute ${courier.display_name}` }, "Unmute");
          btn.addEventListener("click", () => handlers.onUnmute(courier.moderation_ref, courier.display_name));
          row.append(btn);
        } else {
          const btn = h("button", { class: "btn btn-small btn-toggle", "aria-label": `Mute ${courier.display_name}` }, "Mute");
          btn.addEventListener("click", () => handlers.onMute(courier.moderation_ref, courier.display_name));
          row.append(btn);
        }
        const rename = h("button", { class: "btn btn-small btn-rename", "aria-label": `Rename ${courier.display_name}` }, "Rename");
        rename.addEventListener("click", () => handlers.onRename(courier.moderation_ref, courier.display_name));
        row.append(rename);
        body.append(row);
      }
      auditList.replaceChildren(
        ...audit.map((entry) => {
          const text =
            entry.action === "rename"
              ? `${entry.actor_display_name} renamed ${entry.target_name_before} to ${entry.target_name_after}`
              : `${entry.actor_display_name} ${entry.action === "mute" ? "muted" : "unmuted"} ${entry.target_name_after}`;
          return h("li", { class: "audit-entry" }, text);
        }),
      );
      if (body.children.length === 0) body.append(h("p", { class: "drawer-empty" }, "No couriers on Bramble right now."));
      // Restore focus: the same courier if its row still exists, else the neighbour, else Close.
      const restore = () => {
        if (focusedRef !== null) {
          const row = body.querySelector<HTMLElement>(`[data-ref="${cssEscape(focusedRef)}"]`);
          if (row) {
            const wanted = focusedKind === "rename" ? row.querySelector<HTMLElement>(".btn-rename") : row.querySelector<HTMLElement>(".btn-toggle");
            if (wanted && document.activeElement === document.body) wanted.focus();
            return;
          }
        }
        const rows = Array.from(body.querySelectorAll<HTMLElement>(".drawer-row"));
        const target = rows[Math.min(rowIndex < 0 ? rows.length - 1 : rowIndex, Math.max(0, rows.length - 1))];
        const wanted = target?.querySelector<HTMLElement>(focusedKind === "rename" ? ".btn-rename" : ".btn-toggle");
        (wanted ?? closeBtn).focus();
      };
      queueMicrotask(restore);
    },
  };
}

function cssEscape(value: string): string {
  return (window as unknown as { CSS?: { escape?: (s: string) => string } }).CSS?.escape?.(value) ?? value.replace(/"/g, '\\"');
}

/** The Rename courier confirm: focus lands on Cancel, Tab moves between Cancel and Rename only. */
export function openRenameConfirm(parent: HTMLElement, opener: HTMLElement, name: string, onRename: (newNameShown: HTMLElement) => void, onClosed: () => void): Dialog {
  const dialog = new Dialog(parent, "Rename courier", "rename-dialog");
  const cancel = h("button", { class: "btn" }, "Cancel");
  const confirm = h("button", { class: "btn btn-primary" }, "Rename");
  confirm.addEventListener("click", () => onRename(dialog.el));
  cancel.addEventListener("click", () => dialog.close());
  dialog.el.replaceChildren(
    h("p", { class: "confirm-copy" }, `Give ${name} a fresh courier name?`),
    h("div", { class: "confirm-buttons" }, cancel, confirm),
  );
  dialog.onClosed(onClosed);
  dialog.open(opener, cancel);
  return dialog;
}

export function letterDialogIcon(): SVGSVGElement {
  return icon("mail", 20);
}
