// Dialogs and sheets: focus moves in and stays in, Escape and Cancel close at once, and the page behind is usable during the closing animation.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, type AnimationEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlayPhase, type DialogControl } from "../hooks";

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
const FIRST_FIELD = "input:not(:disabled), select:not(:disabled), textarea:not(:disabled)";

/** What Tab can reach: a radio group counts once, at its checked radio. */
function tabStops(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== "radio" || element.checked) return true;
    const group = panel.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${element.name}"]`);
    return ![...group].some((radio) => radio.checked) && group[0] === element;
  });
}

const stack: HTMLElement[] = [];

function pageRoot(): HTMLElement | null {
  return document.getElementById("page");
}

type DialogVariant = "center" | "sheet-right" | "sheet-bottom";

export function Dialog({ control, variant = "center", children, wide = false, title }: { control: DialogControl; variant?: DialogVariant; children: ReactNode; wide?: boolean; title?: ReactNode }) {
  const { mounted, closing, opening, onAnimationEnd } = useOverlayPhase(control.isOpen);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { close } = control;
  const shown = mounted && !closing;

  useLayoutEffect(() => {
    if (!shown) return undefined;
    const element = panel.current;
    if (element) stack.push(element);
    const root = pageRoot();
    if (root) root.inert = true;
    return () => {
      if (element) stack.splice(stack.indexOf(element), 1);
      if (root && stack.length === 0) root.inert = false;
    };
  }, [shown]);

  useEffect(() => {
    if (!shown || !panel.current) return;
    const target = panel.current.querySelector<HTMLElement>(FIRST_FIELD) ?? panel.current.querySelector<HTMLElement>("button:not(:disabled)");
    (target ?? panel.current).focus();
  }, [shown, opening]);

  useEffect(() => {
    if (!shown) return undefined;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape" && stack.at(-1) === panel.current) {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shown, close]);

  const keepFocusInside = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !panel.current) return;
    const stops = tabStops(panel.current);
    const first = stops[0];
    const last = stops.at(-1);
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && stops.includes(active);
    if (!inside || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }, []);

  const finishClosing = (event: AnimationEvent<HTMLDivElement>): void => {
    if (event.target === panel.current && closing) onAnimationEnd();
  };

  if (!mounted) return null;
  return createPortal(
    <div className={`dialog-layer ${variant}${closing ? " closing" : ""}`} inert={closing}>
      <div className="backdrop" aria-hidden="true" onClick={variant === "center" ? undefined : () => close()} />
      <div ref={panel} className={`dialog${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-hidden={closing ? true : undefined} tabIndex={-1} onKeyDown={keepFocusInside} onAnimationEnd={finishClosing}>
        <h2 className="dialog-title" id={titleId}>
          {title ?? control.name}
        </h2>
        <div className="dialog-content" key={opening}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
