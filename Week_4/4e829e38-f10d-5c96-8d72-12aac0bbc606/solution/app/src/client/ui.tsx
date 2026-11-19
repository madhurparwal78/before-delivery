import type { ComponentChildren, JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { useMount } from "./hooks";
import { closeModal, useModals, useStatuses, useToasts, type StatusName } from "./store";

/* ------------------------------------------------------------------ focus */

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.hasAttribute("disabled") || el.closest("[hidden], [inert]") || el.getAttribute("tabindex") === "-1") return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && el.getClientRects().length > 0;
  });
}

/** Keeps Tab and Shift+Tab inside `root`. Returns true when it handled the key. */
function trapTab(event: KeyboardEvent, root: HTMLElement): boolean {
  if (event.key !== "Tab") return false;
  const items = focusablesIn(root);
  if (!items.length) {
    event.preventDefault();
    return true;
  }
  const active = document.activeElement as HTMLElement | null;
  const first = items[0];
  const last = items[items.length - 1];
  if (!active || !root.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
  return true;
}

export function refocus(target: HTMLElement | null | undefined): void {
  queueMicrotask(() => {
    if (target?.isConnected) target.focus();
  });
}

/* ------------------------------------------------------------------ dialog */

interface DialogProps {
  label: string;
  onClose: () => void;
  children: ComponentChildren;
  class?: string;
  /** Where focus goes on close; defaults to what had focus when the dialog opened. */
  returnTo?: () => HTMLElement | null | false;
  modal?: boolean;
}

export function Dialog({ label, onClose, children, class: className, returnTo, modal = true }: DialogProps) {
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  useMount(() => {
    const dialog = root.current!;
    const first = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? focusablesIn(dialog)[0] ?? dialog;
    first.focus();
    return () => {
      const target = returnTo ? returnTo() : null;
      if (target !== false) refocus(target ?? opener.current);
    };
  }, []);
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    } else trapTab(event, root.current!);
  };
  return (
    <div class={`dialog-layer${modal ? "" : " is-popover"}`}>
      {modal && <div class="dialog-scrim" onClick={onClose} />}
      <div ref={root} role="dialog" aria-modal={modal ? "true" : undefined} aria-label={label} tabIndex={-1}
        class={`dialog ${className ?? ""}`} onKeyDown={keydown}>
        {children}
      </div>
    </div>
  );
}

export function ModalHost() {
  const modals = useModals();
  return <>{modals.map((m) => <div key={m.id}>{m.render(() => closeModal(m.id))}</div>)}</>;
}

/* ------------------------------------------------------------------ live regions and toasts */

export function LiveRegions() {
  const statuses = useStatuses();
  const toasts = useToasts();
  const names: StatusName[] = ["Inbox status"];
  return (
    <>
      {names.map((name) => <div key={name} role="status" aria-label={name} aria-live="polite" class="sr-only">{statuses[name] ?? ""}</div>)}
      <div role="status" aria-label="Notifications" aria-live="polite" class="toasts">
        {toasts.map((t) => <div key={t.id} class="toast">{t.text}</div>)}
      </div>
    </>
  );
}

/** A screen-reader-only live region for one screen's announcements. */
export function Status({ name, assertive = false, visible = false }: { name: StatusName; assertive?: boolean; visible?: boolean }) {
  const statuses = useStatuses();
  return (
    <div role="status" aria-label={name} aria-live={assertive ? "assertive" : "polite"} class={visible ? "status-line" : "sr-only"}>
      {statuses[name] ?? ""}
    </div>
  );
}

/* ------------------------------------------------------------------ small controls */

export function useBusy(): [boolean, <T>(work: () => Promise<T>) => Promise<T | undefined>] {
  const [busy, setBusy] = useState(false);
  const flag = useRef(false);
  const run = async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    if (flag.current) return undefined;
    flag.current = true;
    setBusy(true);
    try {
      return await work();
    } finally {
      flag.current = false;
      setBusy(false);
    }
  };
  return [busy, run];
}

type ButtonProps = Omit<JSX.IntrinsicElements["button"], "ref"> & { kind?: "ink" | "outline" | "danger" | "light" | "darkoutline"; busy?: boolean };

export function Pill({ kind = "ink", busy, class: className, children, ...rest }: ButtonProps) {
  return (
    <button type="button" {...rest} aria-busy={busy ? "true" : undefined} class={`pill pill-${kind} ${className ?? ""}`}
      onClick={busy ? undefined : rest.onClick}>
      {children}
    </button>
  );
}

export function FieldError({ id, text }: { id: string; text?: string }) {
  return text ? <p id={id} class="field-error">{text}</p> : null;
}

