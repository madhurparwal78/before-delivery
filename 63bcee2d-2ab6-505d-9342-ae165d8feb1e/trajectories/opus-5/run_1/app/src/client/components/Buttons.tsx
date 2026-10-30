/** Action buttons, which carry their pending copy, and rolling primary labels. */

import type { ReactNode } from 'react';
import { Link } from '../lib/router.jsx';

export function ActionButton({
  children,
  pendingLabel,
  busy,
  onPress,
  className,
  ...rest
}: {
  children: ReactNode;
  pendingLabel: string;
  busy: boolean;
  onPress: () => void;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'className'>): JSX.Element {
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={onPress}
      {...rest}
    >
      {busy ? pendingLabel : children}
    </button>
  );
}

/** A primary label that rolls up on hover or focus; the copy is decorative. */
export function RollingLabel({ children }: { children: string }): JSX.Element {
  return (
    <span className="rolling">
      <span className="rolling-face">{children}</span>
      <span className="rolling-copy" aria-hidden="true">
        {children}
      </span>
    </span>
  );
}

export function PrimaryLink({
  to,
  label,
  className,
}: {
  to: string;
  label: string;
  className?: string;
}): JSX.Element {
  return (
    <Link to={to} className={`primary ${className ?? ''}`.trim()}>
      <RollingLabel>{label}</RollingLabel>
    </Link>
  );
}

export function PrimaryButton({
  label,
  pendingLabel,
  busy,
  onPress,
  className,
  ...rest
}: {
  label: string;
  pendingLabel: string;
  busy: boolean;
  onPress: () => void;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'className'>): JSX.Element {
  return (
    <button
      type="button"
      className={`primary ${className ?? ''}`.trim()}
      disabled={busy}
      onClick={onPress}
      {...rest}
    >
      {busy ? pendingLabel : <RollingLabel>{label}</RollingLabel>}
    </button>
  );
}
