import { useEffect, useRef, type ReactNode } from 'react';
import { isFailure } from './api/client';
import { useAnnouncer } from './api/session';
import { Icon } from './icons/Icon';

export const GENERIC_ERROR = 'Something went wrong on our side. Nothing was changed.';

/** A dialog that keeps and returns focus, and closes on Escape or cancel. */
export function Dialog({
  label,
  onClose,
  children,
  returnFocusRef,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  returnFocusRef: React.RefObject<HTMLElement | null>;
}): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const firstFieldRef = useRef<HTMLDivElement | null>(null);
  const { announce } = useAnnouncer();

  useEffect(() => {
    const el = dialogRef.current;
    if (el === null) return;
    el.showModal();
    const focusable = el.querySelector<HTMLElement>('input, select, textarea, button');
    focusable?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        announce('');
        onClose();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      el.close();
      returnFocusRef.current?.focus();
    };
  }, [onClose, announce, returnFocusRef]);

  return (
    <dialog ref={dialogRef} aria-label={label}>
      <div ref={firstFieldRef} className="dialog-body">
        {children}
      </div>
    </dialog>
  );
}

/** The single mapper from an API failure to the human reason used in announcements. */
export const reasonFor = (e: unknown): string => {
  if (isFailure(e)) {
    switch (e.code) {
      case 'version_conflict':
        return 'it was changed on another device';
      case 'workspace_read_only':
        return 'this workspace is read-only';
      case 'day_in_past':
        return 'that day has already passed';
      case 'already_scheduled':
        return "it's already on the calendar";
      case 'estimate_required':
        return 'add an estimate first';
      case 'crosses_midnight':
        return 'it would run past midnight';
      default:
        return 'the server didn\u2019t respond';
    }
  }
  return 'the server didn\u2019t respond';
};

export const announceError = (announce: (s: string) => void, e: unknown): void => {
  announce(isFailure(e) ? e.message : GENERIC_ERROR);
};

export const fieldErrors = (e: unknown): Record<string, string> | undefined =>
  isFailure(e) ? e.fields : undefined;

/** Button with pending state and the busy copy. */
export function PendingButton({
  pending,
  pendingLabel,
  children,
  className,
  ...rest
}: {
  pending: boolean;
  pendingLabel: string;
  children: ReactNode;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      {...rest}
      className={className}
      aria-busy={pending}
      disabled={pending || rest.disabled}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function DialogCloseButton({ onClose, label }: { onClose: () => void; label: string }): JSX.Element {
  return (
    <button type="button" onClick={onClose}>
      <Icon name="x" /> {label}
    </button>
  );
}
