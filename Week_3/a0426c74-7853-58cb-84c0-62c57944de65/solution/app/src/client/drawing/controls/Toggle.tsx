import type { ButtonHTMLAttributes } from 'react';
import '../../styles/drawing/controls.css';

/** A pressed/unpressed button for a flag (`aria-pressed`) that is not an active tool, so it is not sage. */
export function Toggle({ pressed, className, ...rest }: { pressed: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={['toggle', className ?? ''].filter(Boolean).join(' ')} aria-pressed={pressed} {...rest} />;
}
