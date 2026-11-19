import type { ComponentChildren, JSX } from "preact";
import { createPortal } from "preact/compat";
import { useLayoutEffect, useRef } from "preact/hooks";
import { reducedMotion } from "./text.ts";

let layer: HTMLElement | null = null;
function dialogLayer(): HTMLElement {
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "dialog-layer";
    document.body.append(layer);
  }
  return layer;
}

const open: HTMLElement[] = [];
let sequence = 0;

export function anyDialogOpen(): boolean {
  return open.length > 0;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && !el.closest("[hidden]") && el.getClientRects().length > 0,
  );
}

/** Where focus goes when the next dialog closes, in place of its opener (for example the new treeitem after an upload). */
let closingTarget: (() => HTMLElement | null) | null = null;
export function focusOnClose(target: () => HTMLElement | null): void {
  closingTarget = target;
}

/** The control a dialog returns focus to: its opener, or More (else the source) when the opener has gone. */
function returnTarget(opener: Element | null): HTMLElement | null {
  const element = opener as HTMLElement | null;
  if (element && !element.isConnected) {
    return document.querySelector<HTMLElement>("[data-more-button]") ?? document.querySelector<HTMLElement>("#source");
  }
  return element && typeof element.focus === "function" ? element : null;
}

interface DialogProps {
  title: string;
  role?: "dialog" | "alertdialog";
  onClose: () => void;
  children: ComponentChildren;
  wide?: boolean;
  tall?: boolean;
  /** Selector of the element that takes focus when the dialog opens. */
  initial?: string;
}

export function Dialog(props: DialogProps): JSX.Element {
  const { title, role = "dialog", onClose, children, wide, tall, initial } = props;
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const headingId = useRef(`dialog-title-${(sequence += 1)}`);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const element = box.current as HTMLDivElement;
    open.push(element);
    const first = (initial && element.querySelector<HTMLElement>(initial)) || focusables(element)[0] || element;
    first.focus();
    // Keys pressed while focus sits outside every dialog (on a control that just went away).
    const stray = (event: KeyboardEvent) => {
      if (open[open.length - 1] !== element || element.contains(event.target as Node)) return;
      if ((event.target as HTMLElement | null)?.closest?.(".dialog, .mention-list")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      } else if (event.key === "Tab") {
        event.preventDefault();
        (focusables(element)[0] ?? element).focus();
      }
    };
    document.addEventListener("keydown", stray);
    if (!reducedMotion()) {
      element.animate(
        [
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 200, easing: "cubic-bezier(.2,.7,.2,1)" },
      );
    }
    return () => {
      document.removeEventListener("keydown", stray);
      open.splice(open.indexOf(element), 1);
      const chosen = closingTarget;
      closingTarget = null;
      if (chosen) {
        // The caller's target may only exist once this render has committed; focus it right after.
        queueMicrotask(() => chosen()?.focus());
        return;
      }
      const back = returnTarget(opener.current);
      back?.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    const element = box.current as HTMLDivElement;
    if (open[open.length - 1] !== element) return;
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(element);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    // Focus on a target that is not a Tab stop itself (the dialog, a row header) moves on from the dialog's ends.
    const active = document.activeElement;
    const offStops = !items.includes(active as HTMLElement);
    if (event.shiftKey && (active === first || offStops)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || offStops)) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div class="dialog-backdrop">
      <div
        ref={box}
        role={role}
        aria-modal="true"
        aria-labelledby={headingId.current}
        class={`dialog${wide ? " dialog-wide" : ""}${tall ? " dialog-tall" : ""}`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div class="dialog-head">
          <h2 id={headingId.current}>{title}</h2>
        </div>
        {children}
        <button type="button" class="icon-button dialog-close" aria-label="Close" tabIndex={-1} onClick={() => close.current()}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>,
    dialogLayer(),
  );
}

/** A form field with its label and an error linked to it. */
export function Field(props: {
  id: string;
  label: string;
  error?: string | null;
  children: (describedBy: string | undefined) => ComponentChildren;
}): JSX.Element {
  const errorId = `${props.id}-error`;
  return (
    <div class="field">
      <label for={props.id}>{props.label}</label>
      {props.children(props.error ? errorId : undefined)}
      {props.error ? (
        <p class="field-error" id={errorId}>
          {props.error}
        </p>
      ) : null}
    </div>
  );
}
