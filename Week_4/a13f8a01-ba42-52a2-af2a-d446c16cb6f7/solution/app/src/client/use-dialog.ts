import { useEffect, useRef, type KeyboardEvent, type SyntheticEvent } from "react";

const TABBABLE = 'a[href], button, input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])';

function tabbables(root: HTMLElement): HTMLElement[] {
  const radiosChecked = new Set<string>();
  for (const radio of root.querySelectorAll<HTMLInputElement>("input[type=radio]:checked")) radiosChecked.add(radio.name);
  const seen = new Set<string>();
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((element) => {
    if (element.hasAttribute("disabled") || element.tabIndex < 0 || element.getClientRects().length === 0) return false;
    if (element instanceof HTMLInputElement && element.type === "radio") {
      if (radiosChecked.has(element.name)) return element.checked;
      if (seen.has(element.name)) return false;
      seen.add(element.name);
    }
    return true;
  });
}

interface DialogBinding {
  ref: React.RefObject<HTMLDialogElement | null>;
  props: { onCancel: (event: SyntheticEvent) => void; onKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => void };
}

export function useDialog(open: boolean, close: () => void, firstFocus: (dialog: HTMLDialogElement) => HTMLElement | null): DialogBinding {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const latest = useRef(firstFocus);
  latest.current = firstFocus;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      (latest.current(dialog) ?? tabbables(dialog)[0] ?? dialog).focus();
    } else if (!open && dialog.open) {
      dialog.close();
      opener.current?.focus();
    }
  }, [open]);

  return {
    ref,
    props: {
      onCancel: (event) => {
        event.preventDefault();
        close();
      },
      onKeyDown: (event) => {
        if (event.key !== "Tab") return;
        const items = tabbables(event.currentTarget);
        const first = items[0];
        const last = items[items.length - 1];
        if (first === undefined || last === undefined) return;
        const active = document.activeElement;
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      },
    },
  };
}
