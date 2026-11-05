/** DOM helpers shared by every screen. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | null | undefined> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (value === true) node.setAttribute(key, "");
    else if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === "string") node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}



/** A polite live region, mounted visibly by the screen that owns it. */
export function liveRegion(label: string): HTMLElement {
  const region = document.getElementById(`live-${label}`);
  if (region) return region;
  const node = el("div", { class: "status-line", role: "status", id: `live-${label}`, "aria-label": label });
  document.body.appendChild(node);
  return node;
}

/** Mounts a visible status line for the named live region. */
export function mountStatus(parent: HTMLElement, label: string): HTMLElement {
  const existing = document.getElementById(`live-${label}`);
  if (existing) return existing;
  const node = el("div", { class: "status-line", role: "status", id: `live-${label}`, "aria-label": label });
  parent.appendChild(node);
  return node;
}

export function announce(label: string, message: string): void {
  liveRegion(label).textContent = "";
  window.setTimeout(() => {
    liveRegion(label).textContent = message;
  }, 30);
}

export interface DialogHandle {
  dialog: HTMLDialogElement;
  close(): void;
}

/**
 * Opens a dialog with a focus trap: Tab and Shift+Tab wrap inside, Escape
 * closes, and focus returns to the element that opened it.
 */
export function openDialog(opts: {
  label: string;
  build: (dialog: HTMLDialogElement) => HTMLElement;
  onClose?: () => void;
  opener?: HTMLElement | null;
  initialFocus?: string;
}): DialogHandle {
  const opener = opts.opener ?? document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = el("dialog", { "aria-label": opts.label }) as HTMLDialogElement;
  const content = opts.build(dialog);
  dialog.appendChild(content);
  document.getElementById("overlays")!.appendChild(dialog);

  const focusables = () =>
    Array.from(dialog.querySelectorAll<HTMLElement>("button, [href], input, select, textarea")).filter(
      (n) => !n.hasAttribute("disabled") && n.getAttribute("aria-hidden") !== "true"
    );

  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (!items.includes(active as HTMLElement)) {
      event.preventDefault();
      first.focus();
    }
  });

  dialog.addEventListener("close", () => {
    dialog.remove();
    if (opts.opener) {
      opts.opener.focus();
    } else if (opener instanceof HTMLElement) {
      opener.focus();
    }
    opts.onClose?.();
  });

  const target = opts.initialFocus
    ? dialog.querySelector<HTMLElement>(opts.initialFocus)
    : focusables()[0] ?? dialog;
  dialog.showModal();
  target?.focus();

  return {
    dialog,
    close() {
      if (dialog.open) dialog.close();
      else dialog.remove();
    },
  };
}

export function field(label: string, input: HTMLElement, hint?: string, error?: string): HTMLElement {
  const wrap = el("label", { class: "form-field" });
  const span = el("span", {}, label);
  wrap.append(span, input);
  if (hint) wrap.append(el("span", { class: "hint" }, hint));
  if (error) wrap.append(el("span", { class: "field-error" }, error));
  return wrap;
}

export function formFieldError(message: string): HTMLElement {
  return el("span", { class: "field-error" }, message);
}
