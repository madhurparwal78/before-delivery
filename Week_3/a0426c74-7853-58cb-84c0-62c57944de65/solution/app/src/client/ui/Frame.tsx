import type { HTMLAttributes, ReactNode } from 'react';

export interface FrameProps extends HTMLAttributes<HTMLElement> {
  /** the drawn sheet (an `<svg>`), already sized by its own viewBox */
  children: ReactNode;
  /** text under the frame, in the one text size */
  caption?: ReactNode;
}

/** One small procedural sheet frame of a contact sheet: paper-edge border, square corners, optional caption. */
export function Frame({ children, caption, className, ...rest }: FrameProps) {
  return (
    <figure className={['frame', className ?? ''].filter(Boolean).join(' ')} {...rest}>
      <div className="frame-sheet">{children}</div>
      {caption === undefined ? null : <figcaption className="frame-caption">{caption}</figcaption>}
    </figure>
  );
}

/** An empty frame drawn in code: paper outline and a blank title block. Decorative; `dimmed` is the loading skeleton (no caption, no motion). */
export function EmptyFrame({ dimmed = false }: { dimmed?: boolean }) {
  return (
    <Frame className={dimmed ? 'frame--empty frame--dimmed' : 'frame--empty'} aria-hidden="true">
      <svg viewBox="0 0 120 85" focusable="false">
        <rect x="6" y="6" width="108" height="73" className="sheet-line sheet-line--fine sheet-line--dash sheet-line--muted" />
        <rect x="76" y="62" width="32" height="13" className="sheet-line sheet-line--fine sheet-line--muted" />
      </svg>
    </Frame>
  );
}
