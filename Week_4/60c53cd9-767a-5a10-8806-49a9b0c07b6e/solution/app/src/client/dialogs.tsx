/** Modal layers: focus trap, Escape, focus return, and everything behind an open modal made inert. */
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Layer {
  readonly element: HTMLElement;
  readonly panel: HTMLElement;
}

const layers: Layer[] = [];

const ANY_FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';

/** Pointer events that must not reach anything outside the topmost modal. */
const BLOCKED_EVENTS = [
  "click",
  "dblclick",
  "auxclick",
  "contextmenu",
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
  "pointermove",
  "pointerover",
  "pointerout",
  "pointerenter",
  "pointerleave",
  "touchstart",
  "touchend",
] as const;

const savedTabIndex = new WeakMap<HTMLElement, string | null>();

const hideFromFocus = (element: HTMLElement, hidden: boolean): void => {
  for (const node of element.querySelectorAll<HTMLElement>(ANY_FOCUSABLE)) {
    if (hidden) {
      if (!savedTabIndex.has(node)) savedTabIndex.set(node, node.getAttribute("tabindex"));
      node.setAttribute("tabindex", "-1");
    } else if (savedTabIndex.has(node)) {
      const original = savedTabIndex.get(node);
      if (original === null || original === undefined) node.removeAttribute("tabindex");
      else node.setAttribute("tabindex", original);
      savedTabIndex.delete(node);
    }
  }
};

const insideTopLayer = (event: Event): boolean => {
  const top = layers[layers.length - 1];
  return top !== undefined && event.target instanceof Node && (top.panel.contains(event.target) || top.element.contains(event.target));
};

const guard = (event: Event): void => {
  if (layers.length === 0 || insideTopLayer(event)) return;
  event.stopPropagation();
  if (event.cancelable) event.preventDefault();
};

let guarding = false;

/**
 * Everything behind the topmost modal is inert: the page content and every lower layer carry the `inert` attribute, so
 * assistive technology cannot reach them and they cannot take focus or the pointer. The header stays hit-testable (a
 * click on it must show it is blocked, not vanish from under the pointer), so it is held back with `tabindex=-1` and a
 * capture-phase pointer guard instead.
 */
const syncInert = (): void => {
  const open = layers.length > 0;
  const root = document.getElementById("root");
  const header = root?.querySelector<HTMLElement>(":scope > header");
  for (const child of root?.children ?? []) (child as HTMLElement).inert = open && child !== header;
  if (header) hideFromFocus(header, open);
  layers.forEach((layer, index) => {
    layer.element.inert = index !== layers.length - 1;
  });
  if (open && !guarding) {
    for (const name of BLOCKED_EVENTS) document.addEventListener(name, guard, true);
    guarding = true;
  } else if (!open && guarding) {
    for (const name of BLOCKED_EVENTS) document.removeEventListener(name, guard, true);
    guarding = false;
  }
};

const focusables = (panel: HTMLElement): HTMLElement[] =>
  [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden",
  );

const isTopLayer = (panel: HTMLElement | null): boolean => panel !== null && layers[layers.length - 1]?.panel === panel;

interface ModalProps {
  readonly label: string;
  readonly role?: "dialog" | "alertdialog";
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
  /** Element to focus on open; the first focusable control when omitted. */
  readonly initialFocus?: (panel: HTMLElement) => HTMLElement | null;
  /** Where focus goes on close; the element focused at open when omitted. */
  readonly restoreFocus?: () => HTMLElement | null;
  readonly onPanel?: (panel: HTMLElement | null) => void;
  /** A flat field behind the dialog, for dialogs centred over the page. */
  readonly scrim?: boolean;
}

export const Modal = ({
  label,
  role = "dialog",
  onClose,
  children,
  className = "",
  initialFocus,
  restoreFocus,
  onPanel,
  scrim = false,
}: ModalProps): ReactNode => {
  const layerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const restoreRef = useRef(restoreFocus);
  restoreRef.current = restoreFocus;
  const panelCallback = useRef(onPanel);
  panelCallback.current = onPanel;

  useLayoutEffect(() => {
    const element = layerRef.current as HTMLDivElement;
    const panel = panelRef.current as HTMLDivElement;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer: Layer = { element, panel };
    layers.push(layer);
    syncInert();
    panelCallback.current?.(panel);
    const target = initialFocus?.(panel) ?? focusables(panel)[0] ?? panel;
    target.focus({ preventScroll: true });
    return () => {
      layers.splice(layers.indexOf(layer), 1);
      syncInert();
      panelCallback.current?.(null);
      const back = restoreRef.current?.() ?? opener;
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
    // The modal's focus and layer registration belong to its mount, not to later renders.
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented && isTopLayer(panelRef.current)) {
        event.preventDefault();
        closeRef.current();
      }
    };
    const onFocusIn = (event: FocusEvent): void => {
      const panel = panelRef.current;
      if (panel && isTopLayer(panel) && event.target instanceof Node && !panel.contains(event.target)) {
        (focusables(panel)[0] ?? panel).focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  const trap = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Tab") return;
    const panel = panelRef.current as HTMLDivElement;
    const items = focusables(panel);
    if (items.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const host = document.getElementById("overlays") as HTMLElement;
  return createPortal(
    <div className={scrim ? "layer layer-scrim" : "layer"} ref={layerRef}>
      <div ref={panelRef} role={role} aria-modal="true" aria-label={label} tabIndex={-1} className={`modal ${className}`} onKeyDown={trap}>
        {children}
      </div>
    </div>,
    host,
  );
};
