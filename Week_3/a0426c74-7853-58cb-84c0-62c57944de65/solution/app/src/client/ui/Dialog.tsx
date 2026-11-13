import { useId, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';

interface DialogProps {
  /** the accessible name, also shown as the dialog's title: `Export`, `Import preview`, `New issue`... */
  name: string;
  /** called on Escape; the owner then stops rendering the dialog */
  onClose: () => void;
  /** where focus returns when the dialog is closed; default is the element focused when it opened */
  opener?: RefObject<HTMLElement | null>;
  /** `bottom` is the phone bottom sheet (full width, at most the lower 60 percent) */
  placement?: 'center' | 'bottom';
  /** keep the name for assistive technology but do not draw it */
  titleHidden?: boolean;
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

function isRadio(element: Element | null): element is HTMLInputElement {
  return element instanceof HTMLInputElement && element.type === 'radio';
}

/** A radio group is one tab stop: its checked radio, else its first. */
function isRadioTabStop(radio: HTMLInputElement, dialog: HTMLDialogElement): boolean {
  if (radio.checked) return true;
  const group = [...dialog.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(radio.name)}"]`)];
  return !group.some((member) => member.checked) && group[0] === radio;
}

/** The controls Tab visits inside the dialog, in order. */
function tabStops(dialog: HTMLDialogElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.hasAttribute('disabled') &&
      !element.closest('[hidden], [inert]') &&
      element.getClientRects().length > 0 &&
      !(isRadio(element) && !isRadioTabStop(element, dialog)),
  );
}

/**
 * Modal dialog on a native `<dialog>` opened with `showModal()`. It exists while it is rendered: render it
 * when it should be open. Initial focus goes to the first control (or `[data-autofocus]`), Tab and Shift+Tab
 * wrap inside it, Escape calls `onClose`, and when it unmounts focus returns to the opener.
 */
export function Dialog({ name, onClose, opener, placement = 'center', titleHidden = false, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const openedFrom = useRef(document.activeElement);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    dialog.showModal();
    const first = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? tabStops(dialog)[0];
    (first ?? dialog).focus();
    return () => {
      // leave modal state first: while it lasts the rest of the page is inert and cannot take focus
      dialog.close();
      const target = opener?.current ?? openedFrom.current;
      if (target instanceof HTMLElement) target.focus();
    };
  }, [opener]);

  function moveTab(event: KeyboardEvent<HTMLDialogElement>): void {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const stops = tabStops(event.currentTarget);
    const active = document.activeElement;
    const index = stops.findIndex((stop) => stop === active || (isRadio(stop) && isRadio(active) && stop.name === active.name));
    const step = event.shiftKey ? -1 : 1;
    const next = index === -1 ? (event.shiftKey ? stops.length - 1 : 0) : (index + step + stops.length) % stops.length;
    stops[next]?.focus();
  }

  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${placement}`}
      aria-labelledby={titleId}
      onKeyDown={moveTab}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <p id={titleId} className={titleHidden ? 'visually-hidden' : 'dialog-title'}>{name}</p>
      {children}
    </dialog>
  );
}
