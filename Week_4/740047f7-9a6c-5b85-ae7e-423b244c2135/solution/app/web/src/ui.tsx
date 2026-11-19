// Router, dialog stack, icons and small hooks shared by every page.
import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type AnchorHTMLAttributes, type ReactNode, type SVGProps,
} from "react";
import { createPortal } from "react-dom";
import type { Defect } from "./api";

// ---------------------------------------------------------------- router
export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event("pensight:navigate"));
}

const subscribeLocation = (fn: () => void) => {
  window.addEventListener("popstate", fn);
  window.addEventListener("pensight:navigate", fn);
  return () => {
    window.removeEventListener("popstate", fn);
    window.removeEventListener("pensight:navigate", fn);
  };
};
const locationKey = () => location.pathname + location.search + location.hash;

export function useLocationKey(): string {
  return useSyncExternalStore(subscribeLocation, locationKey);
}

export function Link({ to, onNavigate, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; onNavigate?: () => void }) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(event) => {
        rest.onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

// ---------------------------------------------------------------- hooks
function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (fn: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", fn);
      return () => list.removeEventListener("change", fn);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

export const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");

type Layout = "phone" | "tablet" | "laptop";
export function useLayout(): Layout {
  const phone = useMedia("(max-width: 599px)");
  const tablet = useMedia("(max-width: 1099px)");
  return phone ? "phone" : tablet ? "tablet" : "laptop";
}

/** Runs `fn` every `ms` with the latest closure; the timer survives re-renders. */
export function useInterval(fn: () => void, ms: number, enabled = true): void {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => latest.current(), ms);
    return () => window.clearInterval(id);
  }, [ms, enabled]);
}

// ---------------------------------------------------------------- icons: 24px box, 1.5px stroke, round caps, no fill
type IconProps = SVGProps<SVGSVGElement>;
const Icon = ({ children, ...rest }: IconProps & { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
    {children}
  </svg>
);
export const MenuIcon = (p: IconProps) => <Icon {...p}><path d="M4 9h16M4 15h16" /></Icon>;
export const SearchIcon = (p: IconProps) => <Icon {...p}><circle cx="11" cy="11" r="6" /><path d="m20 20-4.2-4.2" /></Icon>;
export const PlusIcon = (p: IconProps) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
const AlertIcon = (p: IconProps) => <Icon {...p}><path d="M12 4 3 20h18L12 4Z" /><path d="M12 10v4M12 17.2v.1" /></Icon>;
export const ArrowIcon = (p: IconProps) => <Icon {...p}><path d="M7 17 17 7M9 7h8v8" /></Icon>;
const WordmarkGlyph = (p: IconProps) => (
  <Icon {...p}><path d="M3 8h18M3 8l6 12M9 8l6 12M15 8l6 12M21 8l-6 12M15 8 9 20M9 8 3 20" /></Icon>
);

export function Wordmark({ large }: { large?: boolean }) {
  return (
    <span className={large ? "wordmark wordmark-large" : "wordmark"}>
      <WordmarkGlyph width={large ? 40 : 20} height={large ? 40 : 20} />
      <span>Pensight</span>
    </span>
  );
}

export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <span className="error-line">
      <AlertIcon width={16} height={16} />
      <span>{children}</span>
    </span>
  );
}

// ---------------------------------------------------------------- dialogs
const stack: string[] = [];
const layers = new Map<string, HTMLElement>();
const stackListeners = new Set<() => void>();
const emitStack = () => stackListeners.forEach((fn) => fn());
const subscribeStack = (fn: () => void) => {
  stackListeners.add(fn);
  return () => stackListeners.delete(fn);
};
let stackSnapshot = "";
const readStack = () => stackSnapshot;
const refreshStack = () => {
  stackSnapshot = stack.join("|");
  layers.forEach((layer, id) => { layer.inert = id !== stack[stack.length - 1]; });
  emitStack();
};

export const dialogsOpen = () => stack.length > 0;

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  initialFocus?: string;
  className?: string;
  restoreFocus?: boolean | { current: boolean };
}

const DialogContext = createContext<{ close: () => void } | null>(null);
export const useDialog = () => useContext(DialogContext);

export function Dialog({ title, onClose, children, initialFocus, className, restoreFocus = true }: DialogProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const state = useSyncExternalStore(subscribeStack, readStack);
  const top = state.split("|").pop() === id;
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const restore = useRef(restoreFocus);
  restore.current = restoreFocus;
  const shouldRestore = () => (typeof restore.current === "object" ? restore.current.current : restore.current);

  const layer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (layer.current) layers.set(id, layer.current);
    stack.push(id);
    refreshStack();
    const root = document.getElementById("root");
    if (root) root.inert = true;
    const first = initialFocus ? box.current?.querySelector<HTMLElement>(initialFocus) : box.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      const at = stack.indexOf(id);
      if (at >= 0) stack.splice(at, 1);
      layers.delete(id);
      refreshStack();
      if (!stack.length && root) root.inert = false;
      const target = opener.current;
      if (shouldRestore() && target && target.isConnected) target.focus();
    };
  }, [id]);

  useEffect(() => {
    if (!top) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!items.length) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      const active = document.activeElement;
      if (event.shiftKey && (active === head || !box.current.contains(active))) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && (active === tail || !box.current.contains(active))) {
        event.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [top]);

  return createPortal(
    <div ref={layer} className="dialog-layer">
      <div className="dialog-backdrop" onMouseDown={() => closeRef.current()} />
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} className={`dialog ${className ?? ""}`}>
        <DialogContext.Provider value={{ close: onClose }}>{children}</DialogContext.Provider>
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({
  title, message, action, pending, error, onConfirm, onClose, children, restoreFocus,
}: {
  title: string; message: ReactNode; action: string; pending?: boolean; error?: ReactNode; onConfirm: () => void;
  onClose: () => void; children?: ReactNode; restoreFocus?: boolean | { current: boolean };
}) {
  return (
    <Dialog title={title} onClose={onClose} initialFocus="[data-cancel]" restoreFocus={restoreFocus}>
      <h2>{title}</h2>
      <p>{message}</p>
      {children}
      {error && <p className="field-error"><ErrorLine>{error}</ErrorLine></p>}
      <div className="dialog-actions">
        <button type="button" className="btn" data-cancel onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-solid" onClick={onConfirm} disabled={pending} aria-busy={pending}>{action}</button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- tabs
export function Tabs({
  label, tabs, selected, onSelect, panels, idPrefix,
}: {
  label: string; tabs: string[]; selected: string; onSelect: (tab: string) => void; panels: Record<string, ReactNode>; idPrefix: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (tab: string) => {
    onSelect(tab);
    requestAnimationFrame(() => refs.current[tab]?.focus());
    refs.current[tab]?.focus();
  };
  return (
    <>
      <div role="tablist" aria-label={label} className="tablist">
        {tabs.map((tab, index) => (
          <button
            key={tab}
            ref={(el) => { refs.current[tab] = el; }}
            role="tab"
            type="button"
            id={`${idPrefix}-tab-${tab}`}
            aria-selected={selected === tab}
            aria-controls={`${idPrefix}-panel-${tab}`}
            tabIndex={selected === tab ? 0 : -1}
            onClick={() => onSelect(tab)}
            onKeyDown={(event) => {
              const n = tabs.length;
              const to = event.key === "ArrowRight" ? tabs[(index + 1) % n] : event.key === "ArrowLeft" ? tabs[(index + n - 1) % n]
                : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[n - 1] : null;
              if (to) {
                event.preventDefault();
                move(to);
              }
            }}
          >
            {tab}
          </button>
        ))}
      </div>
      {tabs.filter((tab) => tab === selected).map((tab) => (
        <div key={tab} role="tabpanel" id={`${idPrefix}-panel-${tab}`} aria-labelledby={`${idPrefix}-tab-${tab}`} className="tabpanel">
          {panels[tab]}
        </div>
      ))}
    </>
  );
}

/** A defect row's visible detail. The button's accessible name is pinned to "<id>, <type>", so the detail is hidden from
 *  the name; `RowDetail`, placed beside the button, offers it as the button's description. */
const rowDetail = (defect: Defect, flat: boolean, showLock?: boolean) => ({
  detail: flat ? `panel ${defect.cell}` : `${defect.bearing_deg.toFixed(1)}° ${defect.depth_m.toFixed(1)} m`,
  repaired: defect.status === "repaired",
  lock: showLock && defect.lock ? `Being edited on ${defect.lock.device_name}` : "",
});

export function RowBody({ defect, flat, showLock }: { defect: Defect; flat: boolean; showLock?: boolean }) {
  const { detail, repaired, lock } = rowDetail(defect, flat, showLock);
  return (
    <>
      <span className="row-main num">{defect.id} {defect.type}<span aria-hidden="true"> {detail}</span></span>
      {repaired && <span className="row-tag" aria-hidden="true">Repaired</span>}
      {lock && <span className="row-lock" aria-hidden="true">{lock}</span>}
    </>
  );
}

export function RowDetail({ defect, flat, showLock }: { defect: Defect; flat: boolean; showLock?: boolean }) {
  const { detail, repaired, lock } = rowDetail(defect, flat, showLock);
  return <span className="visually-hidden" id={`row-detail-${defect.id}`}>{[detail, repaired ? "Repaired" : "", lock].filter(Boolean).join(". ")}</span>;
}
