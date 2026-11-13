import { useCallback, useRef, type ReactNode } from 'react';
import { useRovingTabIndex } from './roving.js';

export interface ToolbarProps {
  children: ReactNode;
}

/** One Tab stop: Left and Right move between chips, Home and End jump to the ends. */
export function Toolbar({ children }: ToolbarProps): JSX.Element {
  const bar = useRef<HTMLDivElement | null>(null);
  useRovingTabIndex(bar, '[data-chip]');

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key) || !bar.current) return;
    const items = [...bar.current.querySelectorAll<HTMLElement>('[data-chip]')].filter(
      (item) => !item.hasAttribute('disabled'),
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    if (event.key === 'Home') {
      items[0].focus();
      return;
    }
    if (event.key === 'End') {
      items[items.length - 1].focus();
      return;
    }
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = index < 0 ? 0 : (index + step + items.length) % items.length;
    items[next].focus();
  }, []);

  return (
    <div className="toolbar" role="toolbar" aria-label="Bench tools" ref={bar} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

export function ToolbarDivider(): JSX.Element {
  return <span className="divider" aria-hidden="true" />;
}

export function Wordmark(): JSX.Element {
  return <span className="wordmark">Rampwright</span>;
}
