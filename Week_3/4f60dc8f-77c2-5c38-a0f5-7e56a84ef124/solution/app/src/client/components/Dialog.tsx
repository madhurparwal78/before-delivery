// Modal dialogs, adapted from kit/modules/a11y_dialog: focus moves in, Tab and Shift+Tab wrap, Escape closes.
import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[inert]") && el.getClientRects().length > 0);
}

/** Tab stops in order: a radio group is one stop (its checked radio, else its first). */
function tabStops(root: HTMLElement): HTMLElement[] {
  const seen = new Set<string>();
  return focusables(root).filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== "radio" || !el.name) return true;
    if (seen.has(el.name)) return false;
    seen.add(el.name);
    return true;
  }).map((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== "radio") return el;
    return root.querySelector<HTMLInputElement>(`input[type="radio"][name="${el.name}"]:checked`) ?? el;
  });
}

/** Keeps Tab and Shift+Tab inside `root` while `active`, wrapping at either end. */
export function useFocusTrap(root: RefObject<HTMLElement>, active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent): void => {
      const box = root.current;
      if (!box) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      event.preventDefault();
      const stops = tabStops(box);
      if (!stops.length) return;
      const here = document.activeElement;
      const radioName = here instanceof HTMLInputElement && here.type === "radio" ? here.name : null;
      const at = stops.findIndex((el) => el === here || (radioName !== null && el instanceof HTMLInputElement && el.name === radioName));
      const next = at < 0 ? (event.shiftKey ? stops.length - 1 : 0) : (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
      stops[next]?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [active, onEscape, root]);
}

type Props = { title: string; onClose: () => void; children: ComponentChildren; initialFocus?: string };

/** An in-page modal: opening focuses the first field (or `initialFocus`); closing is the caller's, who returns focus to the opener. */
export function Dialog({ title, onClose, children, initialFocus }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useRef(`dialog-${Math.random().toString(36).slice(2)}`).current;
  useFocusTrap(ref, true, onClose);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const target = (initialFocus ? box.querySelector<HTMLElement>(initialFocus) : null) ?? focusables(box)[0];
    target?.focus();
  }, []);
  return (
    <div class="dialog-backdrop">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
