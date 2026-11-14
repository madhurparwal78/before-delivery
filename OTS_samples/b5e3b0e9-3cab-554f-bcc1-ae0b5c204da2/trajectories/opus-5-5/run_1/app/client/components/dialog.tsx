import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

export function Dialog(props: { label: string; onClose(): void; returnFocus?: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const returnFocus = useRef(props.returnFocus);
  returnFocus.current = props.returnFocus;

  useLayoutEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button');
    first?.focus();
    return () => {
      if (returnFocus.current) returnFocus.current();
      else if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    };
  }, []);

  return (
    <div class="backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        class="dialog"
        ref={ref}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            props.onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
          if (items.length === 0) return;
          const first = items[0]!;
          const last = items[items.length - 1]!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <h2 class="dialog-title">{props.label}</h2>
        {props.children}
      </div>
    </div>
  );
}
