// Modal dialogs and the Filters sheet, adapted from kit/modules/a11y_dialog: native <dialog> with showModal (so
// everything behind is inert), Tab and Shift+Tab wrapping, Escape to close, and focus back to the opener. The exit
// is played by a decorative copy, so an earlier close can never hide a dialog that is opened again during it.
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../lib/media";

const EXIT_MS = 250;

/**
 * The exit: the real dialog closes at once (so nothing behind it stays inert and focus can return), and a decorative,
 * inert copy of it sinks and fades for a quarter second on the animation timeline.
 */
function playExit(dialog: HTMLDialogElement): () => void {
  const box = dialog.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = `dialog-ghost ${dialog.className}`;
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  for (const node of dialog.childNodes) ghost.append(node.cloneNode(true));
  ghost.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  Object.assign(ghost.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  document.body.append(ghost);
  const animation = ghost.animate(
    [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(16px)" }],
    { duration: EXIT_MS, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "forwards" },
  );
  const remove = (): void => ghost.remove();
  animation.onfinish = remove;
  return remove;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, input, select, a[href], [tabindex]")].filter(
    (el) => el.tabIndex >= 0 && !el.hasAttribute("disabled") && !(el instanceof HTMLInputElement && el.type === "radio" && !el.checked && radioGroupHasChecked(root, el)),
  );
}

function radioGroupHasChecked(root: HTMLElement, radio: HTMLInputElement): boolean {
  return [...root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${radio.name}"]`)].some((r) => r.checked);
}

interface ModalProps {
  open: boolean;
  label: string;
  onClose(): void;
  /** Receives focus when the dialog opens (or opens again during its exit). */
  initialFocus?: RefObject<HTMLElement>;
  /** The control that opened the dialog; focus returns to it on close. */
  opener?: RefObject<HTMLElement>;
  className?: string;
  children: ReactNode;
}

export function Modal({ open, label, onClose, initialFocus, opener, className, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const removeGhost = useRef<(() => void) | null>(null);
  const [rendered, setRendered] = useState(open);
  if (open && !rendered) setRendered(true);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      removeGhost.current?.();
      removeGhost.current = null;
      if (!dialog.open) dialog.showModal();
      (initialFocus?.current ?? focusables(dialog)[0])?.focus();
      return;
    }
    if (!dialog.open) return;
    if (!prefersReducedMotion()) removeGhost.current = playExit(dialog);
    dialog.close();
    setRendered(false);
    opener?.current?.focus();
  }, [open, opener, initialFocus]);

  useEffect(() => () => removeGhost.current?.(), []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>): void => {
    if (event.key !== "Tab" || !ref.current) return;
    const items = focusables(ref.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return event.preventDefault();
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !ref.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !ref.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={className}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        if (open) onClose();
      }}
    >
      {open || rendered ? children : null}
    </dialog>
  );
}
