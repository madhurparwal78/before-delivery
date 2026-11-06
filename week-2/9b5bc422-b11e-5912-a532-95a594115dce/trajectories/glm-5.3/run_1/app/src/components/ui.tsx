import { useEffect, useRef, useState, type ReactNode } from 'react';

// A dialog that keeps Tab inside in both directions and closes on Escape,
// returning focus to its opener.
export function Dialog({
  label,
  onClose,
  children,
  initialFocusRef,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = initialFocusRef?.current ?? firstFocusable(ref.current);
    node?.focus();
    return () => {
      // focus returns to the opener
    };
  }, [initialFocusRef]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      trap(e, ref.current);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="dialog"
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

function firstFocusable(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  const list = focusables(root);
  return list[0] ?? null;
}

export function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
}

function trap(e: React.KeyboardEvent, root: HTMLElement | null): void {
  const list = focusables(root);
  if (list.length === 0) return;
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement as HTMLElement;
  if (e.shiftKey) {
    if (active === first || !root?.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

// A menu with arrow-key navigation.
export function useMenuHighlight(count: number): { highlighted: number; setHighlighted: (n: number) => void; move: (delta: number) => void; home: () => void; end: () => void } {
  const [highlighted, setHighlighted] = useState(0);
  return {
    highlighted,
    setHighlighted,
    move: (delta) => setHighlighted((h) => (h + delta + count) % count),
    home: () => setHighlighted(0),
    end: () => setHighlighted(count - 1),
  };
}
