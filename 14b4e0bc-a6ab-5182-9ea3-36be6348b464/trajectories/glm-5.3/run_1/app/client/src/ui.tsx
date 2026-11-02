import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Tag } from '../../shared/domain';

export function TagGlyph({ tag }: { tag: Tag }): ReactNode {
  return (
    <span className={`tag-glyph ${tag === 'PII' ? 'glyph-pii' : 'glyph-conf'}`} data-tag-glyph={tag}>
      {tag === 'PII' ? 'P' : 'C'}
    </span>
  );
}

export function TagGlyphs({ tags }: { tags: readonly Tag[] }): ReactNode {
  return (
    <span className="tag-glyphs">
      {tags.map((t) => (
        <TagGlyph key={t} tag={t} />
      ))}
    </span>
  );
}

export interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  firstFieldRef?: React.RefObject<HTMLElement>;
  onOpen?: (dialog: HTMLElement | null) => void;
}

/**
 * The shared dialog: focus moves to its first field, Tab wraps inside it, and
 * it reopens safely during its exit transition (DP-25, DP-26, DP-72).
 */
export function Dialog({ title, onClose, children, firstFieldRef, onOpen }: DialogProps): ReactNode {
  const [transition, setTransition] = useState<'entering' | 'open' | 'leaving'>('entering');
  const ref = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setTransition('open'));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (node) {
      const first = firstFieldRef?.current ?? (node.querySelector('input, textarea, select, button') as HTMLElement | null);
      first?.focus();
      onOpen?.(node);
    }
    return () => onOpen?.(null);
  }, [firstFieldRef, onOpen]);

  const requestClose = (): void => {
    if (leaving.current) return;
    leaving.current = true;
    onClose();
  };

  const onKeyDown = (ev: React.KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      requestClose();
      return;
    }
    if (ev.key === 'Tab') {
      const node = ref.current;
      if (!node) return;
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])')
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement;
      if (ev.shiftKey && (active === first || !node.contains(active))) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && (active === last || !node.contains(active))) {
        ev.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="overlay-backdrop">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-transition={transition}
        className="dialog"
        onKeyDown={onKeyDown}
      >
        <div className="dialog-title">{title}</div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

export interface FieldState {
  invalid: boolean;
  message: string | null;
}

export function fieldError(errors: Record<string, string>, key: string): FieldState {
  const message = errors[key];
  return { invalid: message !== undefined, message: message ?? null };
}

export function DialogFieldError({ state, id }: { state: FieldState; id: string }): ReactNode {
  if (!state.invalid || !state.message) return null;
  return (
    <span id={id} className="field-error">
      {state.message}
    </span>
  );
}

