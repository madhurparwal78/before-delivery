import { useEffect, useRef, useState } from 'preact/hooks';
import { Info } from './icons.js';
import { EASE_IN_OUT, enter } from './motion.js';

/** A small "i" button whose tip opens by click or tap and closes on Escape, an outside click or a second press. */
export function InfoTip({ id, label, text }: { id: string; label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        box.current?.querySelector('button')?.focus();
      } else if (box.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <span class="tip" ref={box}>
      <button
        type="button"
        class="tip-button"
        aria-label={label}
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={`${id}-tip`}
        onClick={() => setOpen(!open)}
      >
        <Info size={16} />
      </button>
      {open && (
        <span class="tip-panel" id={`${id}-tip`} role="tooltip" ref={(el) => enter(el, 150, 4, EASE_IN_OUT)}>
          {text}
        </span>
      )}
    </span>
  );
}
