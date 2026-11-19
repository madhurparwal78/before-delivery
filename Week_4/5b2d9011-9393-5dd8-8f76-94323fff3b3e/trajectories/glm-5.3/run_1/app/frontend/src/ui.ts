// Small DOM helpers. The whole UI is imperative DOM construction over the
// fixed stage.
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | null | undefined> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = String(v);
    else if (k === "text") node.textContent = String(v);
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function setAttr(node: Element, name: string, value: string | null): void {
  if (value === null) node.removeAttribute(name);
  else node.setAttribute(name, value);
}

export function statusRole(label: string, text: string): HTMLElement {
  return el("div", { role: "status", "aria-label": label, text });
}

/** A dialog helper that traps Tab and Shift+Tab and closes on Escape. */
export interface DialogHandle {
  close: () => void;
  node: HTMLElement;
}

export function openDialog(opts: {
  label: string;
  build: (root: HTMLElement) => void;
  opener?: HTMLElement | null;
  onEscape?: () => boolean; // return true to keep the dialog open
  onClose?: () => void;
}): DialogHandle {
  const scrim = el("div", { class: "scrim" });
  const panel = el("div", {
    class: "panel panel-enter",
    role: "dialog",
    "aria-label": opts.label,
  });
  scrim.append(panel);
  document.body.append(scrim);

  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  opts.build(panel);

  const focusables = (): HTMLElement[] =>
    Array.from(panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter((n) => !n.hasAttribute("disabled") && n.offsetParent !== null);

  const first = (): HTMLElement | null => focusables()[0] ?? null;
  const last = (): HTMLElement | null => focusables()[focusables().length - 1] ?? null;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    panel.classList.remove("panel-enter");
    panel.classList.add("panel-exit");
    document.removeEventListener("keydown", onKey, true);
    setTimeout(() => {
      scrim.remove();
      const target = opts.opener ?? opener;
      if (target && target.isConnected) target.focus();
      opts.onClose?.();
    }, 120);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (opts.onEscape?.() !== true) close();
      return;
    }
    if (e.key === "Tab") {
      const f = first();
      const l = last();
      if (!f || !l) return;
      if (e.shiftKey && document.activeElement === f) {
        e.preventDefault();
        l.focus();
      } else if (!e.shiftKey && document.activeElement === l) {
        e.preventDefault();
        f.focus();
      }
    }
  };
  document.addEventListener("keydown", onKey, true);

  const initial = first();
  if (initial) initial.focus();

  return { close, node: panel };
}
