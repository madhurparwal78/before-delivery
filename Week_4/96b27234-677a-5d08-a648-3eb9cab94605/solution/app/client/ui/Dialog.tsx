import { useEffect, useRef, useState, type ReactNode } from "react";
import { focusFirst, popLayer, pushLayer, type Layer } from "../lib/layers";

export interface DialogHandle {
  open: boolean;
  opener: HTMLElement | null;
  show: (opener?: HTMLElement | null) => void;
  hide: () => void;
}

/** Open state plus the control focus returns to when the dialog closes. */
export function useDialog(): DialogHandle {
  const [state, setState] = useState<{ open: boolean; opener: HTMLElement | null }>({ open: false, opener: null });
  return {
    open: state.open,
    opener: state.opener,
    show: (opener) => setState({ open: true, opener: opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null) }),
    hide: () => setState((current) => ({ ...current, open: false })),
  };
}

function restoreFocus(target: HTMLElement | null): void {
  if (target && target.isConnected) target.focus();
  else document.querySelector<HTMLElement>("h1")?.focus();
}

/** A hand-built modal dialog: Tab wraps inside, Escape closes, focus returns to the opener. */
export function Dialog({ label, handle, children }: { label: string; handle: DialogHandle; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const hide = useRef(handle.hide);
  hide.current = handle.hide;
  const opener = handle.opener;
  const open = handle.open;
  useEffect(() => {
    const element = ref.current;
    if (!open || !element) return undefined;
    const layer: Layer = { element, close: () => hide.current(), restore: opener };
    pushLayer(layer);
    focusFirst(element);
    return () => {
      popLayer(layer);
      restoreFocus(opener);
    };
  }, [open, opener]);
  if (!open) return null;
  return (
    <div className="backdrop">
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} className="dialog" tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}

