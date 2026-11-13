import type { ComponentPropsWithRef } from 'react';

interface ButtonProps extends ComponentPropsWithRef<'button'> {
  /** the one sage button on a screen */
  primary?: boolean;
}

/** The one button element: square, one text size, at least 44 px on touch layouts. `aria-pressed` paints sage. */
export function Button({ primary = false, className, type = 'button', ...rest }: ButtonProps) {
  const classes = ['btn', primary ? 'btn--primary' : '', className ?? ''].filter(Boolean);
  return <button type={type} className={classes.join(' ')} {...rest} />;
}
