import { createContext, type ComponentChildren, type JSX } from 'preact';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ICONS, type IconName } from './icons';

export interface DeskFeedback {
  say: (message: string) => void;
  warn: (message: string) => void;
  clear: () => void;
}

export const Feedback = createContext<DeskFeedback>({ say: () => {}, warn: () => {}, clear: () => {} });

export function useFeedback(): DeskFeedback {
  return useContext(Feedback);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ---------- glyphs ---------- */

export function Glyph({ shape, tone }: { shape: IconName; tone: 'cut' | 'award' | 'signal' }): JSX.Element {
  return (
    <svg
      class={`glyph glyph--${tone}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICONS[shape] }}
    />
  );
}

export function CutMarker({ cut }: { cut: 'above' | 'below' }): JSX.Element {
  return (
    <span class="marker">
      <Glyph shape={cut === 'above' ? 'triangle-filled' : 'triangle'} tone="cut" />
      <span>{cut === 'above' ? 'Above cut' : 'Below cut'}</span>
    </span>
  );
}

const AWARD_SHAPE: Record<string, { shape: IconName; label: string }> = {
  winner: { shape: 'star-filled', label: 'Winner' },
  finalist: { shape: 'star', label: 'Finalist' },
  honourable_mention: { shape: 'circle', label: 'Honourable mention' },
};

export function StatusLabel({ state, label }: { state: string; label: string }): JSX.Element {
  if (state !== 'disqualified') return <span>{label}</span>;
  return (
    <span class="marker disqualified">
      <Glyph shape="cross" tone="signal" />
      <span>{label}</span>
    </span>
  );
}

export function AwardMarker({ award }: { award: string }): JSX.Element | null {
  const marker = AWARD_SHAPE[award];
  if (marker === undefined) return null;
  return (
    <span class="marker">
      <Glyph shape={marker.shape} tone="award" />
      <span>{marker.label}</span>
    </span>
  );
}

/* ---------- dialog ---------- */

export function Dialog({
  title,
  children,
  onClose,
  labelledBy,
}: {
  title: string;
  children: ComponentChildren;
  onClose: () => void;
  labelledBy: string;
}): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const node = panel.current;
    if (node !== null) {
      const first = node.querySelector<HTMLElement>(
        'input, textarea, select, [data-safe="true"], button, [href]',
      );
      first?.focus();
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || node === null) return;
      const focusables = [
        ...node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea'),
      ].filter((element) => !element.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      (opener.current as HTMLElement | null)?.focus();
    };
  }, [onClose]);

  return (
    <div class="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={panel}>
        <h2 id={labelledBy} style="font-size:1.1rem">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/* ---------- forms ---------- */

export function Field({
  label,
  id,
  error,
  children,
}: {
  label: string;
  id: string;
  error?: string;
  children: ComponentChildren;
}): JSX.Element {
  return (
    <div>
      <label for={id}>{label}</label>
      {children}
      {error !== undefined && error !== '' ? (
        <p class="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function usePending(): [boolean, <T>(run: () => Promise<T>) => Promise<T | undefined>] {
  const [pending, setPending] = useState(false);
  const feedback = useFeedback();
  const run = async <T,>(task: () => Promise<T>): Promise<T | undefined> => {
    setPending(true);
    try {
      return await task();
    } catch (error) {
      feedback.warn(error instanceof Error ? error.message : String(error));
      return undefined;
    } finally {
      setPending(false);
    }
  };
  return [pending, run];
}

/* ---------- grid hairlines ---------- */

export function GridLines(): JSX.Element {
  const [count, setCount] = useState(12);
  useLayoutEffect(() => {
    const measure = (): void => {
      const width = window.innerWidth;
      setCount(width <= 600 ? 4 : width <= 1024 ? 6 : 12);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return (
    <div class="grid-lines" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

export function ordinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo === 11 || lastTwo === 12 || lastTwo === 13) return `${value}th`;
  const last = value % 10;
  if (last === 1) return `${value}st`;
  if (last === 2) return `${value}nd`;
  if (last === 3) return `${value}rd`;
  return `${value}th`;
}

export function money(cents: number): string {
  return (cents / 100).toFixed(2);
}
