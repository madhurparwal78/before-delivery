import type { ReactNode } from 'react';
import { useFocusTrap } from '../hooks.ts';

export function Dialog(props: {
  name: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  sheet?: boolean;
}) {
  const ref = useFocusTrap(true, props.onClose);
  return (
    <div className="scrim" data-sheet={props.sheet ? 'true' : undefined}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={props.name}
        className={`paper dialog${props.wide ? ' dialog-wide' : ''}${props.sheet ? ' dialog-sheet' : ''}`}
        ref={ref}
      >
        {props.children}
      </div>
    </div>
  );
}
