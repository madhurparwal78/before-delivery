import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from './link.tsx';

type ButtonVariant = 'primary' | 'secondary' | 'quiet';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  compact?: boolean;
}

/** Primary buttons are lime; secondary ones are white pills; every one is at least 48px tall. */
export function Button({ variant = 'secondary', compact = false, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={`btn btn-${variant}${compact ? ' btn-compact' : ''}`} {...rest} />;
}

export function LinkButton({ to, variant = 'primary', big = false, children }: {
  to: string;
  variant?: ButtonVariant;
  big?: boolean;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={`btn btn-${variant}${big ? ' btn-big' : ''}`}>
      {children}
    </Link>
  );
}
