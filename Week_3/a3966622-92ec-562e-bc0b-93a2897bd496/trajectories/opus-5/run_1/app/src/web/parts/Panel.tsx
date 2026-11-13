import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../hooks.ts';

const EXIT_MS = 250;

export type PanelProps = {
  open: boolean;
  label: string;
  kind: 'dialog' | 'drawer' | 'sheet';
  onClose: () => void;
  children: React.ReactNode;
};

/** Open panels hold focus; a closing panel is inert at once, so none of its controls can be read. */
export function Panel({ open, label, kind, onClose, children }: PanelProps): JSX.Element | null {
  const container = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const node = container.current;
    if (node !== null) node.inert = !open;
  }, [open, mounted]);

  useFocusTrap(container, open, onClose);

  if (!open && !mounted) return null;
  return (
    <div
      ref={container}
      role="dialog"
      aria-label={label}
      aria-hidden={open ? undefined : true}
      aria-modal={kind === 'dialog' ? true : undefined}
      className={kind === 'dialog' ? 'panel' : kind}
      style={
        kind === 'dialog'
          ? { position: 'fixed', inset: '10vh auto auto 50%', transform: 'translateX(-50%)', zIndex: 30 }
          : undefined
      }
    >
      {children}
    </div>
  );
}
