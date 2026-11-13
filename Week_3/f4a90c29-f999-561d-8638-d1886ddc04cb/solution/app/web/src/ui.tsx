import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  const all = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden",
  );
  return all.filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== "radio" || !el.name) return true;
    const group = all.filter((o) => o instanceof HTMLInputElement && o.type === "radio" && o.name === el.name);
    const checked = group.find((o) => (o as HTMLInputElement).checked);
    return checked ? checked === el : group[0] === el;
  });
}

/** Returns focus to the control that opened a dialog, found again by its key when the grid redrew it. */
export function restoreFocus(opener: HTMLElement | null, fallback?: () => void): void {
  queueMicrotask(() => {
    if (opener?.isConnected) {
      opener.focus();
      return;
    }
    const key = opener?.getAttribute("data-fk");
    const again = key ? document.querySelector<HTMLElement>(`[data-fk="${CSS.escape(key)}"]`) : null;
    if (again) again.focus();
    else fallback?.();
  });
}

export function anyDialogOpen(): boolean {
  return document.querySelector("dialog[open]") !== null;
}

/** A closing dialog leaves at once; an inert, hidden picture of it fades out in less time than a dialog takes to arrive. */
function fadeOut(dialog: HTMLDialogElement): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = dialog.getBoundingClientRect();
  const picture = document.createElement("div");
  picture.className = `dialog-picture ${dialog.className}`;
  picture.inert = true;
  picture.setAttribute("aria-hidden", "true");
  picture.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
  picture.append(...Array.from(dialog.cloneNode(true).childNodes));
  picture.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  document.body.append(picture);
  const fade = picture.animate({ opacity: [1, 0] }, { duration: 120, easing: "ease-in", fill: "forwards" });
  fade.onfinish = fade.oncancel = () => picture.remove();
}

interface ModalProps {
  label: string;
  onClose: () => void;
  children: ComponentChildren;
  className?: string;
  fallback?: () => void;
}

/** A modal dialog that wraps Tab inside itself, closes on Escape and returns focus to its opener. */
export function Modal({ label, onClose, children, className, fallback }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const dialog = ref.current as HTMLDialogElement;
    dialog.showModal();
    const first = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(dialog)[0];
    first?.focus();
    return () => {
      fadeOut(dialog);
      restoreFocus(opener.current, fallback);
    };
  }, []);
  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const dialog = event.currentTarget;
    const list = focusables(dialog);
    if (list.length === 0) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === list[0] || !dialog.contains(active))) {
      event.preventDefault();
      list[list.length - 1].focus();
    } else if (!event.shiftKey && (active === list[list.length - 1] || !dialog.contains(active))) {
      event.preventDefault();
      list[0].focus();
    }
  };
  return (
    <dialog
      ref={ref}
      class={className}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onKeyDown={onKeyDown}
    >
      {children}
    </dialog>
  );
}

export function Chevron({ direction }: { direction: "left" | "right" | "up" | "down" }) {
  const path = { left: "M14 6l-6 6 6 6", right: "M10 6l6 6-6 6", up: "M6 14l6-6 6 6", down: "M6 10l6 6 6-6" }[direction];
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d={path} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function WarningMark() {
  return (
    <svg role="img" aria-label="Zone rule warning" class="warn-mark" viewBox="0 0 24 24" width="18" height="18">
      <path d="M12 3l10 18H2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      <path d="M12 10v5M12 18v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  );
}
