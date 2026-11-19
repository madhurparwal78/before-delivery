import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog opens with focus on its first field, or its first button when it has
 * none. Tab cycles inside it, everything behind it is inert, and Escape or
 * Cancel returns focus to the control that opened it.
 */
export function Dialog(props: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    const node = panel.current;
    if (node !== null) {
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const firstField = items.find((item) => item.tagName === 'INPUT' || item.tagName === 'SELECT');
      (firstField ?? items[0])?.focus();
    }
    return () => {
      const back = opener.current;
      if (back !== null && document.body.contains(back)) back.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const node = panel.current;
      if (node === null) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div className="scrim">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={props.title} ref={panel}>
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}

export function FieldRow(props: {
  label: string;
  id: string;
  message?: string | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      {props.children}
      {props.message === undefined ? null : <p className="field-message">{props.message}</p>}
    </div>
  );
}
