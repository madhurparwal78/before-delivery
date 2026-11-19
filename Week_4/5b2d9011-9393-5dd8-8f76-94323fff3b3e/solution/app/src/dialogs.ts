import { byId, h } from "./dom";
import { isReduced } from "./state";

interface DialogOptions {
  name: string;
  className?: string;
  content: (Node | null)[];
  opener?: HTMLElement | null;
  scrim?: boolean;
  drawer?: boolean;
  /** Escape closes by default; the notice panel treats Escape as Enter. */
  onEscape?: () => void;
  onClose?: () => void;
  initialFocus?: () => HTMLElement | null;
}

export interface DialogHandle {
  el: HTMLElement;
  close(): void;
}

interface OpenDialog {
  handle: DialogHandle;
  layer: HTMLElement;
  opener: HTMLElement | null;
  options: DialogOptions;
  closed: boolean;
}

const stack: OpenDialog[] = [];
const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';
const CLOSE_MS = 100;

function focusables(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("disabled") && !el.closest("[hidden],[inert]") && el.getAttribute("type") !== "hidden" && el.getClientRects().length > 0,
  );
}

function top(): OpenDialog | undefined {
  return stack.filter((d) => !d.closed).at(-1);
}

export function dialogOpen(): boolean {
  return top() !== undefined;
}

function refresh(): void {
  const live = stack.filter((d) => !d.closed);
  live.forEach((d, i) => {
    const active = i === live.length - 1;
    d.layer.toggleAttribute("inert", !active);
    d.layer.classList.toggle("is-under", !active);
  });
  byId("world").toggleAttribute("inert", live.length > 0);
  byId("scrim").classList.toggle("on", live.some((d) => d.options.scrim));
}

export function openDialog(options: DialogOptions): DialogHandle {
  const opener = options.opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const nodes = options.content.filter((n): n is Node => n !== null);
  const last = nodes.at(-1);
  const footer = last instanceof HTMLElement && last.classList.contains("row-end") ? last : null;
  const body = h("div", { class: "panel-body" }, ...(footer ? nodes.slice(0, -1) : nodes));
  const el = h("div", {
    role: "dialog", "aria-modal": "true", "aria-label": options.name, tabindex: "-1",
    class: `panel ${options.drawer ? "drawer" : ""} ${options.className ?? ""}`.trim(),
  }, body, footer);
  const layer = h("div", { class: `layer ${options.drawer ? "layer-drawer" : ""}` }, el);
  byId("layers").append(layer);
  const entry: OpenDialog = { layer, opener, options, closed: false, handle: { el, close: () => close(entry) } };
  stack.push(entry);
  refresh();
  const first = options.initialFocus?.() ?? focusables(el)[0] ?? el;
  first.focus();
  return entry.handle;
}

function close(entry: OpenDialog): void {
  if (entry.closed) return;
  entry.closed = true;
  const wasTop = stack.filter((d) => !d.closed).length === 0 || stack.indexOf(entry) === stack.length - 1;
  entry.layer.setAttribute("aria-hidden", "true");
  entry.layer.setAttribute("inert", "");
  entry.layer.classList.add("closing");
  const finish = (): void => {
    entry.layer.remove();
    const at = stack.indexOf(entry);
    if (at >= 0) stack.splice(at, 1);
  };
  if (isReduced()) finish();
  else window.setTimeout(finish, CLOSE_MS);
  refresh();
  entry.options.onClose?.();
  if (wasTop) returnFocus(entry);
}

function returnFocus(entry: OpenDialog): void {
  const below = top();
  const target = entry.opener && entry.opener.isConnected && !entry.opener.closest("[inert]") ? entry.opener : null;
  if (target) target.focus();
  else if (below) (focusables(below.handle.el)[0] ?? below.handle.el).focus();
}

document.addEventListener("keydown", (event) => {
  const current = top();
  if (!current) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (current.options.onEscape) current.options.onEscape();
    else current.handle.close();
    return;
  }
  if (event.key !== "Tab") return;
  const items = focusables(current.handle.el);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  const inside = active !== null && current.handle.el.contains(active);
  const first = items[0];
  const last = items[items.length - 1];
  if (!inside || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
    event.preventDefault();
    (event.shiftKey && inside ? last : first).focus();
  }
}, true);

document.addEventListener("focusin", (event) => {
  const current = top();
  if (current && event.target instanceof Node && !current.handle.el.contains(event.target)) {
    (focusables(current.handle.el)[0] ?? current.handle.el).focus();
  }
});
