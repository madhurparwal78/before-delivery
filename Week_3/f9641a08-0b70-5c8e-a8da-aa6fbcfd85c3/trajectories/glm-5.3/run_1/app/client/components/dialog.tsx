import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';

/**
 * Every dialog keeps Tab and Shift+Tab inside it, closes with Escape and
 * returns focus to its opener.
 */
export function Dialog(props: {
  label: string;
  open: boolean;
  onClose: () => void;
  children: preact.ComponentChild;
  className?: string;
  alert?: boolean;
  initialFocus?: 'first' | 'keep';
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (props.open) {
      openerRef.current = document.activeElement;
      const root = rootRef.current;
      if (root !== null) {
        const focusables = focusableIn(root);
        if (focusables.length > 0 && props.initialFocus !== 'keep') focusables[0].focus();
      }
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        } else if (e.key === 'Tab') {
          trap(e);
        }
      };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }
    return undefined;
  }, [props.open]);

  const close = (): void => {
    props.onClose();
    const opener = openerRef.current;
    if (opener instanceof HTMLElement) opener.focus();
  };

  const trap = (e: KeyboardEvent): void => {
    const root = rootRef.current;
    if (root === null) return;
    const focusables = focusableIn(root);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!props.open) return <></>;
  return (
    <div class={`dialog-backdrop ${props.className ?? ''}`}>
      <div
        ref={rootRef}
        role={props.alert === true ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={props.label}
        class="dialog"
        data-motion-ms={document.documentElement.dataset.motion === 'reduced' ? '0' : '320'}
        data-state="open"
      >
        {props.children}
      </div>
    </div>
  );
}

export function focusableIn(root: HTMLElement): HTMLElement[] {
  const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => !el.hasAttribute('disabled'));
}

/** A focus helper: moves focus to the first element matching the selector. */
export function focusFirst(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (el !== null) el.focus();
}
