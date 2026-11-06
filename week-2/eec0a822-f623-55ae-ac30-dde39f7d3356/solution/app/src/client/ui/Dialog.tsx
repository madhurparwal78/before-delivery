// Dialogs, bottom sheets and the menu. Closed means unmounted: nothing inside is visible, focusable or in the
// accessibility tree. Exit plays 360 ms while inert; opening again during the exit cancels it.
import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { prefersReducedMotion } from "../lib/hooks";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Enabled, tabbable controls in document order (adapted from kit/modules/a11y_dialog). */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[inert]") && el.getClientRects().length > 0);
}

export interface DialogHandle {
  open: boolean;
  opener: HTMLElement | null;
  show: (event?: { currentTarget: EventTarget | null }) => void;
  hide: () => void;
}

/** Open state plus the control that opened it, so focus can return there. */
export function useDialog(): DialogHandle {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const show = useCallback((event?: { currentTarget: EventTarget | null }) => {
    opener.current = (event?.currentTarget as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
    setOpen(true);
  }, []);
  const hide = useCallback(() => setOpen(false), []);
  return { open, opener: opener.current, show, hide };
}

const MOTION_MS = 360;
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

type Variant = "dialog" | "sheet" | "menu";

function frames(variant: Variant): Keyframe[] {
  const wide = matchMedia("(min-width: 1024px)").matches;
  if (variant === "menu") return [{ transform: "translateY(-16px)", opacity: 0 }, { transform: "none", opacity: 1 }];
  if (variant === "sheet" && !wide) return [{ transform: "translateY(100%)" }, { transform: "none" }];
  return [{ transform: "translateY(12px) scale(0.98)", opacity: 0 }, { transform: "none", opacity: 1 }];
}

interface DialogProps {
  handle: DialogHandle;
  title: string;
  variant?: Variant;
  /** Hide the visible title (the menu names itself with its links). */
  quietTitle?: boolean;
  children: ComponentChildren;
  footer?: ComponentChildren;
}

let ids = 0;

export function Dialog({ handle, title, variant = "dialog", quietTitle, children, footer }: DialogProps) {
  const [mounted, setMounted] = useState(false);
  const layer = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const exit = useRef<Animation[]>([]);
  const wasOpen = useRef(false);
  const titleId = useRef(`dialog-title-${(ids += 1)}`).current;
  const opener = useRef<HTMLElement | null>(null);

  const shown = handle.open || mounted;
  if (handle.opener) opener.current = handle.opener;

  useLayoutEffect(() => {
    const el = panel.current;
    const backdrop = layer.current;
    if (!el || !backdrop) return;
    const reduced = prefersReducedMotion();
    if (handle.open && !wasOpen.current) {
      wasOpen.current = true;
      setMounted(true);
      for (const a of exit.current) a.cancel();
      exit.current = [];
      backdrop.inert = false;
      if (!reduced) {
        el.animate(frames(variant), { duration: MOTION_MS, easing: EASE });
        backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION_MS, easing: EASE });
      }
      const first = el.querySelector<HTMLElement>("[data-first]") ?? focusables(el)[0];
      (first ?? el).focus();
    } else if (!handle.open && wasOpen.current) {
      wasOpen.current = false;
      backdrop.inert = true;
      const target = opener.current;
      if (target?.isConnected) target.focus();
      if (reduced) {
        setMounted(false);
        return;
      }
      const options = { duration: MOTION_MS, easing: EASE, fill: "forwards" as const };
      const leaving = [el.animate([...frames(variant)].reverse(), options), backdrop.animate([{ opacity: 1 }, { opacity: 0 }], options)];
      exit.current = leaving;
      Promise.all(leaving.map((a) => a.finished)).then(
        () => {
          if (exit.current === leaving) setMounted(false);
        },
        () => undefined,
      );
    }
  }, [handle.open, mounted]);

  useEffect(() => () => exit.current.forEach((a) => a.cancel()), []);

  if (!shown) return null;

  const onKeyDown = (event: KeyboardEvent) => {
    const el = panel.current!;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      handle.hide();
      return;
    }
    if (event.key !== "Tab") return;
    const list = focusables(el);
    if (!list.length) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    const index = active ? list.indexOf(active) : -1;
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      list[list.length - 1].focus();
    } else if (!event.shiftKey && (index === -1 || index === list.length - 1)) {
      event.preventDefault();
      list[0].focus();
    }
  };

  return createPortal(
    <div class={`dialog-layer dialog-layer--${variant}`} ref={layer}>
      <div class="dialog-backdrop" onClick={() => handle.hide()} />
      <div
        ref={panel}
        class={`dialog dialog--${variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} class={quietTitle ? "sr-only" : "dialog__title"}>
          {title}
        </h2>
        <div class="dialog__body">{children}</div>
        {footer ? <div class="dialog__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
