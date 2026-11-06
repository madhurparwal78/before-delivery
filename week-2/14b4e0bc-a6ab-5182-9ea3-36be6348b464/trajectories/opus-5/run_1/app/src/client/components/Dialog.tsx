import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../lib/hooks.ts';

export type Transition = 'entering' | 'open' | 'leaving';

interface DialogProps {
  name: string;
  role?: 'dialog' | 'complementary';
  open: boolean;
  motion: 'reduced' | 'full';
  onClose: () => void;
  /** Focused when the panel opens; panels whose focus the store owns pass false. */
  autoFocus?: boolean;
  className?: string;
  /** Extra published attributes the panel itself must carry. */
  attributes?: Record<string, string>;
  children: ReactNode;
}

const ENTER_MS = 240;
const LEAVE_MS = 200;

/** A dialog, the Filters sheet or the Lineage rail: trapped, inert while leaving, and settled. */
export function Overlay({
  name,
  role = 'dialog',
  open,
  motion,
  onClose,
  autoFocus = true,
  className,
  attributes,
  children,
}: DialogProps): ReactNode {
  const [mounted, setMounted] = useState(open);
  const [transition, setTransition] = useState<Transition>(open ? 'open' : 'leaving');
  const container = useRef<HTMLDivElement | null>(null);
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      if (motion === 'reduced') {
        setTransition('open');
        return;
      }
      setTransition('entering');
      const timer = window.setTimeout(() => setTransition('open'), ENTER_MS);
      return () => window.clearTimeout(timer);
    }
    if (!mounted) return;
    setTransition('leaving');
    const timer = window.setTimeout(() => setMounted(false), motion === 'reduced' ? 0 : LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [open, motion, mounted]);

  useFocusTrap(node, onClose, open);

  useEffect(() => {
    if (!open || node === null || !autoFocus) return;
    node.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
  }, [open, node, autoFocus]);

  if (!mounted) return null;
  return (
    <div className="overlay-layer" data-overlay={name}>
      <div className="overlay-backdrop" aria-hidden="true" />
      <div
        role={role}
        {...(role === 'dialog' ? { 'aria-modal': true } : {})}
        aria-label={name}
        {...(attributes ?? {})}
        data-transition={transition}
        className={`overlay ${className ?? ''} ${transition === 'leaving' ? 'overlay-leaving' : ''}`}
        ref={(element) => {
          container.current = element;
          setNode(element);
        }}
      >
        {children}
      </div>
    </div>
  );
}
