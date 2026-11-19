// Shared screen pieces: the router, links, the focus-trapping dialog (adapted from kit/modules/a11y_dialog),
// the digit ticker and the usage meter.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type MouseEvent } from "react";
import { EASE_OUT, EASE_SOFT, reducedMotion, rise } from "./motion.js";

const subscribers = new Set<() => void>();

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.scrollTo(0, 0);
  subscribers.forEach((s) => s());
}

window.addEventListener("popstate", () => subscribers.forEach((s) => s()));

export function usePath(): string {
  return useSyncExternalStore(
    (s) => {
      subscribers.add(s);
      return () => subscribers.delete(s);
    },
    () => location.pathname,
  );
}

export function Link({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} className={className} onClick={go}>
      {children}
    </a>
  );
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden],[inert]"));
}

/** Keeps Tab inside `root` and closes on Escape. */
function trapKeys(root: HTMLElement, onClose: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const items = focusables(root);
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
      e.preventDefault();
      first.focus();
    }
  };
}

/** Moves focus in on open, traps it, and returns it to the opener (or `returnTo`) on close. */
export function useFocusTrap(onClose: () => void, returnTo?: () => HTMLElement | null) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = root.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(root)[0] ?? root;
    target.focus({ preventScroll: true });
    const trap = trapKeys(root, () => close.current());
    const onKey = (e: KeyboardEvent) => {
      const open = document.querySelectorAll('[aria-modal="true"]');
      if (open[open.length - 1] === root) trap(e);
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const back = returnTo?.() ?? opener;
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}

export function Dialog({
  title,
  onClose,
  children,
  wide,
  returnTo,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  returnTo?: () => HTMLElement | null;
}) {
  const ref = useFocusTrap(onClose, returnTo);
  const id = useRef(`dlg-${Math.random().toString(36).slice(2)}`).current;
  useLayoutEffect(() => {
    if (ref.current) rise(ref.current);
  }, [ref]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className={wide ? "dialog dialog-wide" : "dialog"} tabIndex={-1}>
        <h2 id={id} className="dialog-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/**
 * Rolls each changed digit column to the new value. The text already holds the final value; the old digit is
 * drawn by the column's ::before, so it is never part of the text.
 */
export function Ticker({ value }: { value: string }) {
  const prev = useRef(value);
  const [from, setFrom] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (prev.current === value) return;
    const old = prev.current;
    prev.current = value;
    if (!reducedMotion()) setFrom(old);
  }, [value]);
  useLayoutEffect(() => {
    if (from === null || !ref.current) return;
    const animations = [...ref.current.querySelectorAll<HTMLElement>(".tick-stack")].map((s) =>
      s.animate([{ transform: "translateY(1.5em)" }, { transform: "translateY(0)" }], { duration: 400, easing: EASE_OUT, fill: "backwards" }),
    );
    let live = true;
    Promise.all(animations.map((a) => a.finished)).then(
      () => live && setFrom(null),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [from]);
  const width = Math.max(value.length, from?.length ?? 0);
  const to = value.padStart(width, " ");
  const old = from?.padStart(width, " ") ?? null;
  return (
    <span ref={ref} className="ticker">
      {[...to].map((ch, i) => {
        const was = old?.[i];
        if (old === null || was === ch || !/\d/.test(ch)) return ch === " " ? null : <span key={i}>{ch}</span>;
        return (
          <span key={i} className="tick-win">
            <span className="tick-stack" data-d={was === " " ? "" : was}>
              {ch}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** A usage meter whose bar grows or shrinks from its previous fill. */
export function Meter({ label, used, cap }: { label: string; used: number; cap: number | null }) {
  const bar = useRef<HTMLSpanElement>(null);
  const fill = cap === null ? 0 : Math.min(1, cap === 0 ? 1 : used / cap);
  const last = useRef(fill);
  useLayoutEffect(() => {
    const from = last.current;
    last.current = fill;
    if (from === fill || !bar.current || reducedMotion()) return;
    bar.current.animate([{ transform: `scaleX(${from})` }, { transform: `scaleX(${fill})` }], { duration: 600, easing: EASE_SOFT });
  }, [fill]);
  const text = cap === null ? `${used}, unlimited` : `${used} of ${cap}`;
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={cap ?? Math.max(used, 1)} aria-valuenow={used} aria-valuetext={text} className="meter">
      <span className="meter-text">
        {label} — <Ticker value={String(used)} />
        {cap === null ? ", unlimited" : <> of <Ticker value={String(cap)} /></>}
      </span>
      {cap !== null && (
        <span className="meter-track" aria-hidden="true">
          <span ref={bar} className="meter-bar" style={{ transform: `scaleX(${fill})` }} />
        </span>
      )}
    </div>
  );
}

/** Document title per page. */
export function useTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Lanternfold Rooms`;
  }, [title]);
}
