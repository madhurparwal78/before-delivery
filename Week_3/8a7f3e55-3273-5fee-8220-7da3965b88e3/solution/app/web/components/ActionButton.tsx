import { type ReactNode, useLayoutEffect, useRef } from "react";
import { useAction } from "../lib/actions";
import type { ApiFailure } from "../lib/api";
import type { ActionKind } from "../lib/copy";

interface ActionButtonProps<T> {
  label: ReactNode;
  kind: ActionKind;
  /** Pending copy: the Action status text, and the button's label while the request is out. */
  pending: string;
  work: () => Promise<T>;
  success: (value: T) => string;
  onDone?: (value: T) => void;
  onFailure?: (failure: ApiFailure) => void;
  className?: string;
  /** The accessible name while idle, when it must say more than the visible label. */
  ariaLabel?: string;
}

/** A button that runs one action: it shows the pending copy as its label and stays disabled until the answer arrives. */
export function ActionButton<T>({ label, kind, pending, work, success, onDone, onFailure, className, ariaLabel }: ActionButtonProps<T>) {
  const action = useAction();
  const button = useRef<HTMLButtonElement>(null);
  const hadFocus = useRef(false);

  // A disabled button loses focus; when the answer leaves the button in place, focus comes back to it.
  useLayoutEffect(() => {
    if (action.pending || !hadFocus.current) return;
    hadFocus.current = false;
    if (document.activeElement === document.body) button.current?.focus();
  }, [action.pending]);

  const press = async () => {
    hadFocus.current = document.activeElement === button.current;
    const value = await action.run({ kind, pending, work, success, onFailure });
    if (value !== undefined) onDone?.(value);
  };
  return (
    <button ref={button} type="button" className={`btn ${className ?? ""}`} aria-label={action.pending ? undefined : ariaLabel} disabled={action.pending} onClick={() => void press()}>
      {action.pending ? pending : label}
    </button>
  );
}
