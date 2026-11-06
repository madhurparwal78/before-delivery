// Dialogs, focus containment and live status lines (brief: Interactions, Dialogs; Feedback states).
// Dialogs are in-page elements, not modal <dialog>s: the page's status lines stay readable while one is open.
import type { ComponentChildren, JSX } from "preact";
import { createPortal } from "preact/compat";
import { useLayoutEffect, useRef } from "preact/hooks";
import { Icon } from "./icons";

let lastId = 0;

// A document-unique id for label and description wiring (Preact's useId repeats across portals).
function useUniqueId(): string {
  const id = useRef("");
  if (!id.current) id.current = `f${++lastId}`;
  return id.current;
}

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']";

function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.getClientRects().length > 0);
}

// Tab and Shift+Tab wrap inside the container.
export function trapTab(event: KeyboardEvent, container: HTMLElement): void {
  if (event.key !== "Tab") return;
  const items = focusables(container);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

export function reducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface DialogProps {
  title: string;
  titleHidden?: boolean;
  onClose: () => void;
  sheet?: boolean;
  children: ComponentChildren;
}

// Open dialogs, innermost last: only the innermost one answers Escape and holds Tab.
const openDialogs: HTMLElement[] = [];

export function Dialog({ title, titleHidden, onClose, sheet, children }: DialogProps): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useUniqueId();
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = box.current as HTMLDivElement;
    openDialogs.push(container);
    (container.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(container)[0] ?? container).focus();
    // Captured at the document so keys still reach the dialog when focus has fallen to the page body.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (openDialogs[openDialogs.length - 1] !== container) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      } else {
        trapTab(event, container);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      openDialogs.splice(openDialogs.indexOf(container), 1);
      if (opener?.isConnected && !opener.matches(":disabled")) opener.focus();
    };
  }, []);
  return createPortal(
    <div class={sheet ? "backdrop backdrop--sheet" : "backdrop"} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={box}
        class={sheet ? "dialog dialog--sheet" : "dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId} class={titleHidden ? "vh" : "dialog__title"}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// A polite live line; empty until its action has something to say.
// An error reads in ink behind the circle-x glyph (brief: Visual design, Colour).
export function Status({ label, text, class: extra, error = false }: { label: string; text: string; class?: string; error?: boolean }): JSX.Element {
  return (
    <div role="status" aria-label={label} class={extra ? `status ${extra}` : "status"}>
      {error && text && <Icon name="circle-x" />}
      {text}
    </div>
  );
}

// A text field whose label is exactly its accessible name, with an optional hint and server message.
interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: (describedBy: string | undefined, id: string) => JSX.Element;
}

export function Field({ label, hint, error, children }: FieldProps): JSX.Element {
  const id = useUniqueId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div class={error ? "field field--error" : "field"}>
      <label for={id}>{label}</label>
      {children(describedBy, id)}
      {hint && (
        <p id={hintId} class="field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} class="field__error">
          <Icon name="circle-x" />
          {error}
        </p>
      )}
    </div>
  );
}
