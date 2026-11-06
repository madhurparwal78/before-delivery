// DOM helpers, the dialog manager and the page-level status and alert regions.

export type Unsubscribe = () => void;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | number | undefined> = {},
  ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });

export function displayDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  return fmt.format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export const providerToday = (): string => {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
};

export const closeLine = (closeDate: string): string => `${displayDate(closeDate)} at 11:59 PM CT`;

// --- page-level status and alert regions -------------------------------------

let statusRegion: HTMLElement | null = null;
let alertRegion: HTMLElement | null = null;

export function ensureFeedbackRegions(parent: HTMLElement): void {
  statusRegion = el("div", { role: "status", "aria-live": "polite", "aria-label": "Activity status", class: "sr-only" });
  alertRegion = el("div", { role: "alert", class: "alert-region", hidden: true });
  parent.append(statusRegion, alertRegion);
}

export function announce(message: string): void {
  if (!statusRegion) return;
  statusRegion.textContent = "";
  window.setTimeout(() => {
    if (statusRegion) statusRegion.textContent = message;
  }, 30);
}

export function announceAlert(message: string): void {
  if (!alertRegion) return;
  alertRegion.hidden = false;
  alertRegion.textContent = message;
  announce("");
}

export function clearAlert(): void {
  if (alertRegion) {
    alertRegion.hidden = true;
    alertRegion.textContent = "";
  }
}

// --- dialogs ------------------------------------------------------------------

type DialogHandle = {
  close: () => void;
};

const openDialogs: DialogHandle[] = [];

export function openDialog(params: {
  title: string;
  onOpen?: (container: HTMLElement) => void;
  onClose?: () => void;
  content: (container: HTMLElement, close: () => void) => void;
}): void {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const previous = openDialogs.map((d) => d);
  const overlay = el("div", { class: "dialog-backdrop" });
  const dialog = el("div", { role: "dialog", "aria-modal": "true", "aria-label": params.title, class: "dialog" });
  overlay.append(dialog);
  document.body.append(overlay);
  document.body.classList.add("dialog-open");

  const close = (): void => {
    const index = openDialogs.indexOf(handle);
    if (index === -1) return;
    openDialogs.splice(index, 1);
    overlay.remove();
    if (openDialogs.length === 0) document.body.classList.remove("dialog-open");
    params.onClose?.();
    const target = opener ?? document.body;
    (target as HTMLElement).focus?.();
    if (opener) opener.focus();
  };
  const handle: DialogHandle = { close };
  openDialogs.push(handle);
  previous.forEach(() => undefined);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
      (n) => !n.hasAttribute("disabled") && n.offsetParent !== null,
    );
    if (focusables.length === 0) return;
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener("keydown", onKeyDown);
  params.content(dialog, close);

  const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (n) => !n.hasAttribute("disabled") && n.offsetParent !== null,
  );
  const focusTarget = focusables[0] ?? dialog;
  dialog.tabIndex = -1;
  focusTarget.focus();
  params.onOpen?.(dialog);
}

export const focusableSelector =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// --- form field errors ---------------------------------------------------------

export function fieldError(input: HTMLElement, message: string): HTMLElement {
  const id = `err-${Math.random().toString(36).slice(2, 9)}`;
  const error = el("p", { class: "field-error", id, role: undefined }, message);
  input.setAttribute("aria-describedby", id);
  input.setAttribute("aria-invalid", "true");
  return error;
}

export function clearFieldErrors(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>(".field-error").forEach((node) => {
    const described = node.id;
    container.querySelectorAll(`[aria-describedby="${described}"]`).forEach((input) => {
      input.removeAttribute("aria-describedby");
      input.removeAttribute("aria-invalid");
    });
    node.remove();
  });
}

export function applyErrors(
  container: HTMLElement,
  errors: Record<string, string>,
  fields: Record<string, HTMLElement>,
): void {
  clearFieldErrors(container);
  for (const [key, message] of Object.entries(errors)) {
    const input = fields[key];
    if (input) {
      const error = fieldError(input, message);
      input.parentElement?.append(error);
    }
  }
}

export const prefersReducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
