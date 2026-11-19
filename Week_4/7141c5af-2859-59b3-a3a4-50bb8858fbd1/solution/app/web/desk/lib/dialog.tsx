import type { ComponentChildren, JSX, RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { onSessionEnded, sessionHasEnded } from "./api.ts";
import { EASE, isPhone, MOVE_MS, reducedMotion } from "./motion.ts";
import { currentAddress } from "./router.tsx";
import { draftFor, type Draft } from "./drafts.ts";

const FOCUSABLE = 'a[href],button,input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => !node.closest("[inert]") && node.getClientRects().length > 0);
}

/** Open overlays, innermost last. Only the innermost answers Escape. */
const stack: DialogPanel[] = [];

interface DialogPanel {
  close: () => void;
}

function pageInert(inert: boolean): void {
  (document.getElementById("app") as HTMLElement).inert = inert;
}

addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const top = stack.at(-1);
  if (!top) return;
  event.preventDefault();
  top.close();
});

export interface DialogControl {
  name: string;
  open: boolean;
  mounted: boolean;
  show: (opener?: HTMLElement | null) => void;
  /** Closes with focus back on the opener, at once, while the closing animation still runs. */
  hide: () => void;
  /** After an action: focus to the opener, or to the level-one heading when the opener is gone (SR12). */
  done: () => void;
  gone: () => void;
  opener: RefObject<HTMLElement | null>;
  draft: Draft | null;
}

export function focusHeading(): void {
  document.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: false });
}

export function useDialog(name: string): DialogControl {
  const [draft] = useState(() => draftFor(name));
  const [open, setOpen] = useState(draft !== null);
  const [mounted, setMounted] = useState(draft !== null);
  const opener = useRef<HTMLElement | null>(null);

  const show = useCallback((from?: HTMLElement | null) => {
    opener.current = from ?? (document.activeElement as HTMLElement | null);
    setMounted(true);
    setOpen(true);
  }, []);

  const done = useCallback(() => {
    setOpen(false);
    pageInert(stack.length > 1);
    const back = opener.current;
    if (back?.isConnected) back.focus();
    else focusHeading();
  }, []);

  const gone = useCallback(() => setMounted(false), []);

  return { name, open, mounted, show, hide: done, done, gone, opener, draft };
}

function keyframes(kind: "dialog" | "sheet", rtl: boolean): Keyframe[] {
  if (isPhone()) return [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }];
  if (kind === "sheet") return [{ transform: `translateX(${rtl ? "-100%" : "100%"})` }, { transform: "translateX(0)" }];
  return [
    { transform: "scale(0.9)", opacity: 0 },
    { transform: "scale(1)", opacity: 1 },
  ];
}

interface DialogProps {
  control: DialogControl;
  title: string;
  kind?: "dialog" | "sheet";
  /** The dialog's `Close` button: omitted where the brief lists its own way out. */
  closeLabel?: string | null;
  children: ComponentChildren;
  class?: string;
}

/**
 * A `role="dialog"` div and never a native modal, so Announcements stays out of the inert page (SR28). One WAAPI
 * animation per panel: closing reverses it and reopening reverses it again, so it carries on from wherever it stands (SR27).
 */
export function Dialog({ control, title, kind = "dialog", closeLabel = "Close", children, class: className }: DialogProps): JSX.Element | null {
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const motion = useRef<Animation[]>([]);
  const self = useRef<DialogPanel>({ close: control.hide });
  self.current.close = control.hide;
  const titleId = useId();
  const wasOpen = useRef(false);
  const [ended, setEnded] = useState(sessionHasEnded());
  useEffect(() => onSessionEnded(() => setEnded(true)), []);

  useLayoutEffect(() => {
    const node = panel.current;
    const veil = scrim.current;
    if (!node || !veil || control.open === wasOpen.current) return;
    wasOpen.current = control.open;
    const running = motion.current.filter((animation) => animation.playState === "running");

    if (control.open) {
      if (!stack.includes(self.current)) stack.push(self.current);
      pageInert(true);
      node.inert = false;
      const first = focusables(node);
      (first.find((item) => item.matches("input,select,textarea")) ?? first[0] ?? node).focus();
    } else {
      stack.splice(stack.indexOf(self.current), 1);
      node.inert = true;
    }

    if (running.length > 0) {
      for (const animation of running) animation.reverse();
      return;
    }
    if (reducedMotion()) {
      if (!control.open) control.gone();
      return;
    }
    const timing: KeyframeAnimationOptions = { duration: MOVE_MS, easing: EASE, fill: "both", direction: control.open ? "normal" : "reverse" };
    const rtl = document.documentElement.dir === "rtl";
    motion.current = [node.animate(keyframes(kind, rtl), timing), veil.animate([{ opacity: 0 }, { opacity: 1 }], timing)];
    const [main] = motion.current;
    (main as Animation).onfinish = () => {
      for (const animation of motion.current) animation.cancel();
      motion.current = [];
      if (!stack.includes(self.current)) control.gone();
    };
  }, [control.open, control.mounted]);

  useEffect(
    () => () => {
      const at = stack.indexOf(self.current);
      if (at >= 0) {
        stack.splice(at, 1);
        pageInert(stack.length > 0);
      }
    },
    [],
  );

  const trap = (event: KeyboardEvent): void => {
    if (event.key !== "Tab" || !panel.current) return;
    const items = focusables(panel.current);
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!control.mounted) return null;
  const overlays = document.getElementById("overlays") as HTMLElement;
  return createPortal(
    <div class="overlay" data-kind={kind}>
      <div class="scrim" ref={scrim} onClick={() => control.open && control.hide()} />
      <div ref={panel} class={`panel ${className ?? ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={trap}>
        <h2 id={titleId}>{title}</h2>
        {children}
        {ended ? (
          <a class="link-row" href={`/sign-in?returnTo=${encodeURIComponent(currentAddress())}`}>
            Sign in again
          </a>
        ) : null}
        {closeLabel ? (
          <button type="button" class="button panel-close" onClick={control.hide}>
            {closeLabel}
          </button>
        ) : null}
      </div>
    </div>,
    overlays,
  );
}
