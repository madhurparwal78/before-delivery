import { createPortal } from "preact/compat";
import type { ComponentChildren } from "preact";
import { useLayoutEffect as useEffect, useId, useRef, useState } from "preact/hooks";
import { useReducedMotion } from "./hooks";

type ModalState = "closed" | "open" | "closing";

const FADE_OUT_MS = 160;
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href]';

const page = (): HTMLElement | null => document.getElementById("app");
const layer = (): HTMLElement | null => document.getElementById("layer");

interface ModalControl {
  state: ModalState;
  open: (opener: HTMLElement | null) => void;
  close: () => void;
}

/** Open, closing (fading out) and closed; reopening during the fade-out keeps the dialog open. */
export function useModal(): ModalControl {
  const [state, setState] = useState<ModalState>("closed");
  const current = useRef<ModalState>("closed");
  const timer = useRef<number | undefined>(undefined);
  const opener = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();

  const move = (next: ModalState): void => {
    current.current = next;
    setState(next);
  };

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      page()?.removeAttribute("inert");
    },
    [],
  );

  return {
    state,
    open(from) {
      window.clearTimeout(timer.current);
      opener.current = from;
      page()?.setAttribute("inert", "");
      move("open");
    },
    close() {
      if (current.current !== "open") return;
      page()?.removeAttribute("inert");
      opener.current?.focus();
      move("closing");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => move("closed"), reduced ? 0 : FADE_OUT_MS);
    },
  };
}

interface ModalProps {
  title: string;
  control: ModalControl;
  children: ComponentChildren;
}

/** A compact centred card over a dimmed page; focus stays inside while it is open. */
export function Modal({ title, control, children }: ModalProps) {
  const { state } = control;
  const titleId = useId();
  const card = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (state === "open") card.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [state]);

  const target = layer();
  if (state === "closed" || !target) return null;
  const closing = state === "closing";

  const keep = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      control.close();
      return;
    }
    if (event.key !== "Tab" || !card.current) return;
    const found = [...card.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const stops = found.filter((el, index) => !(el instanceof HTMLInputElement && el.type === "radio" && found.findIndex((other) => other instanceof HTMLInputElement && other.type === "radio" && other.name === el.name) !== index));
    const active = document.activeElement as HTMLElement | null;
    const group = active instanceof HTMLInputElement && active.type === "radio" ? stops.find((el) => el instanceof HTMLInputElement && el.name === active.name) : active;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && (group === first || !group || !card.current.contains(group))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (group === last || !group || !card.current.contains(group))) {
      event.preventDefault();
      first?.focus();
    }
  };

  return createPortal(
    <div class="dialog-root">
      <div class="dialog-backdrop" data-closing={closing ? "true" : "false"} />
      <dialog
        ref={card}
        class="card"
        open
        aria-modal="true"
        aria-labelledby={titleId}
        data-closing={closing ? "true" : "false"}
        inert={closing}
        onKeyDown={keep}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </dialog>
    </div>,
    target,
  );
}
