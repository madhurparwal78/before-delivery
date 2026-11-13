/** Dialog and sheet helpers: focus trap, Escape, focus return, roving tab stops. */

export type DialogHandle = {
  close(): void;
};

const openStack: { dialog: HTMLDialogElement; opener: HTMLElement | null }[] = [];

/**
 * Open a dialog, trap Tab inside it, close on Escape (unless pinned) and
 * return focus to its opener.
 */
export function openDialog(
  build: (body: HTMLElement) => void,
  opts: { opener?: HTMLElement | null; pinned?: boolean; sheet?: boolean; onClose?: () => void; label?: string } = {}
): HTMLDialogElement {
  const dlg = document.createElement("dialog");
  dlg.className = opts.sheet ? "bottom-sheet" : "";
  if (opts.sheet) dlg.dataset.sheet = "true";
  if (opts.label) dlg.setAttribute("aria-label", opts.label);
  const bodyEl = document.createElement("div");
  bodyEl.className = "dialog-body";
  dlg.appendChild(bodyEl);
  build(bodyEl);
  document.body.appendChild(dlg);
  const entry = { dialog: dlg, opener: opts.opener ?? document.activeElement as HTMLElement | null };
  openStack.push(entry);

  dlg.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      const focusables = dialogFocusables(dlg);
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
  dlg.addEventListener("cancel", (e) => {
    if (opts.pinned) { e.preventDefault(); return; }
    closeDialog(dlg);
  });
  dlg.addEventListener("close", () => {
    const idx = openStack.findIndex((x) => x.dialog === dlg);
    if (idx >= 0) openStack.splice(idx, 1);
    opts.onClose?.();
    dlg.remove();
    entry.opener?.focus();
  });
  if (opts.sheet) {
    animateId(dlg, "sheet-open", [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], { duration: 240, easing: "ease-out", fill: "forwards" });
  }
  dlg.showModal();
  const focusables = dialogFocusables(dlg);
  (focusables[0] ?? dlg).focus();
  return dlg;
}

export function closeDialog(dlg: HTMLDialogElement): void {
  if (!dlg.open) return;
  dlg.close();
}

export function dialogFocusables(root: HTMLElement): HTMLElement[] {
  const sel = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";
  return [...root.querySelectorAll<HTMLElement>(sel)].filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null || el === document.activeElement);
}

/** Announce a message politely. */
export function status(name: string, text: string): HTMLElement {
  let el = document.querySelector<HTMLElement>(`[data-status="${name}"]`);
  if (!el) {
    el = document.createElement("div");
    el.className = "status-line";
    el.setAttribute("role", "status");
    el.dataset.status = name;
    el.setAttribute("aria-live", "polite");
    document.querySelector("main")?.appendChild(el) ?? document.body.appendChild(el);
  }
  el.textContent = text;
  return el;
}

/** Toast that disappears after the published lifetime. */
const toastsEl = (): HTMLElement => {
  let el = document.querySelector<HTMLElement>(".toasts");
  if (!el) {
    el = document.createElement("div");
    el.className = "toasts";
    document.body.appendChild(el);
  }
  return el;
};

let toastMs = 5000;

export function setToastMs(ms: number): void {
  toastMs = ms;
}

export function toast(text: string): void {
  const host = toastsEl();
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = text;
  host.appendChild(el);
  setTimeout(() => el.remove(), toastMs);
}

/** A full-width black outage band with off-white text. */
export function outageBand(text: string): void {
  const host = toastsEl();
  const el = document.createElement("div");
  el.className = "outage";
  el.setAttribute("role", "alert");
  el.textContent = text;
  document.body.prepend(el);
  el.addEventListener("click", () => el.remove(), { once: true });
  host.dataset.outage = text;
}

/** The reduced-motion setting, decided once per page load. */
export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Run a named animation through the Web Animations API, or jump to the end. */
export function animateId(el: Element, id: string, keyframes: Keyframe[], options: KeyframeAnimationOptions): void {
  if (reducedMotion()) {
    const last = keyframes[keyframes.length - 1];
    if (last) Object.assign((el as HTMLElement).style, last as Record<string, string>);
    return;
  }
  el.animate(keyframes, { ...options, id });
}
