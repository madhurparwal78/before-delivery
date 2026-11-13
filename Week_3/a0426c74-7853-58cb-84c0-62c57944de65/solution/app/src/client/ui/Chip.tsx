import type { HTMLAttributes } from 'react';

/** A flat surface chip for the corners of the drawing pane. Its controls are plain `Button`s; `chip--group` drops the box so each control is its own chip. */
export function Chip({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={className ? `chip ${className}` : 'chip'} {...rest} />;
}
