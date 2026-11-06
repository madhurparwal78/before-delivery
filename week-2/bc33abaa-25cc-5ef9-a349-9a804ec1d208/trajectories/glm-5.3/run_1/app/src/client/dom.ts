export type Attrs = Record<string, unknown> & { className?: string; text?: string; children?: Node[] };

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "className") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (key === "dataset") {
      for (const [dk, dv] of Object.entries(value as Record<string, string>)) node.dataset[dk] = dv;
    } else if (key === "style" && typeof value === "object") {
      Object.assign(node.style, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (key === "value") {
      (node as HTMLInputElement).value = String(value);
    } else if (key === "checked" || key === "disabled" || key === "selected") {
      (node as HTMLInputElement & { disabled?: boolean; selected?: boolean })[key] = value === true;
    } else if (key === "aria" || key === "role") {
      if (key === "role") node.setAttribute("role", String(value));
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function aria(node: HTMLElement, attrs: Record<string, string>): HTMLElement {
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(`aria-${k}`, v);
  return node;
}

export function label(node: HTMLElement, text: string): HTMLElement {
  node.setAttribute("aria-label", text);
  return node;
}

export function setStatus(el: HTMLElement | null, text: string, isError = false): void {
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", isError);
}

export interface BusyHandle {
  start(): void;
  end(): void;
}

export function busy(btn: HTMLButtonElement): BusyHandle {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const original = btn.textContent ?? "";
  return {
    start() {
      btn.disabled = true;
      if (reduced) {
        btn.textContent = "Working…";
        btn.classList.add("busy");
      } else {
        btn.textContent = original;
        btn.classList.add("busy");
      }
    },
    end() {
      btn.disabled = false;
      btn.classList.remove("busy");
      btn.textContent = original;
    },
  };
}

export function showFieldError(input: HTMLElement, message: string | undefined): void {
  const existing = input.parentElement?.querySelector(".error");
  if (existing) existing.remove();
  if (!message) return;
  const err = el("div", { className: "error", text: message });
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", "err-" + (input.id || ""));
  err.id = "err-" + (input.id || "");
  input.parentElement?.append(err);
}

export function openDialog(
  content: HTMLElement,
  opts: { name: string; onOpen?: (dialog: HTMLDialogElement) => void; onClose?: () => void } = { name: "" },
): HTMLDialogElement {
  const dialog = el("dialog", { className: "sheet", role: "dialog" }) as HTMLDialogElement;
  aria(dialog, { label: opts.name, modal: "true" });
  dialog.append(content);
  document.body.append(dialog);
  const opener = document.activeElement as HTMLElement | null;
  dialog.addEventListener("close", () => {
    dialog.remove();
    opts.onClose?.();
    if (opener && document.contains(opener)) opener.focus();
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      dialog.close();
    }
    if (e.key === "Tab") {
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]")).filter((n) => !(n as HTMLInputElement).disabled);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  dialog.showModal();
  opts.onOpen?.(dialog);
  return dialog;
}

export function navigate(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
