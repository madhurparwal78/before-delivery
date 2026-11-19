import type { ButtonHTMLAttributes, ReactNode } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "quiet" | "primary" | "danger";
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
}

/** Every async action disables its button and marks it busy while pending. */
export function Button({ variant = "quiet", busy = false, busyLabel, children, disabled, ...rest }: Props) {
  return (
    <button type="button" {...rest} className={`button button--${variant}`} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy && busyLabel !== undefined ? busyLabel : children}
    </button>
  );
}
