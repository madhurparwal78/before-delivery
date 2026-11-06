import {
  Children,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { TriangleAlert } from 'lucide-react';

/** A polite status region whose text is replaced by its newest announcement. */
export function Status({ name, text }: { name: string; text: string }): ReactNode {
  return (
    <p role="status" aria-label={name} aria-live="polite" className="status-region">
      {text}
    </p>
  );
}

/** Errors are ink with a warning icon and words, never colour alone. */
export function FieldError({ id, message }: { id: string; message: string }): ReactNode {
  if (message === '') return null;
  return (
    <p className="field-error" id={id}>
      <TriangleAlert aria-hidden="true" size={16} />
      <span>{message}</span>
    </p>
  );
}

/** The error summary lists each field's message as a link to its field. */
export function ErrorSummary({
  name,
  order,
  fields,
}: {
  name: string;
  order: readonly { field: string; targetId: string }[];
  fields: Record<string, string>;
}): ReactNode {
  const present = order.filter((entry) => fields[entry.field] !== undefined);
  return (
    <p role="status" aria-label={name} aria-live="polite">
      {present.map((entry, index) => (
        <span key={entry.field}>
          {index > 0 ? ' ' : ''}
          <a
            href={`#${entry.targetId}`}
            onClick={(event) => {
              event.preventDefault();
              document.getElementById(entry.targetId)?.focus();
            }}
          >
            {fields[entry.field]}
          </a>
        </span>
      ))}
    </p>
  );
}

export const summaryText = (
  order: readonly string[],
  fields: Record<string, string>,
): string =>
  order
    .filter((field) => fields[field] !== undefined)
    .map((field) => fields[field])
    .join(' ');

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** The viewport width band, which decides which published layout is shown. */
export function useWidthBand(): 'small' | 'medium' | 'large' {
  const [band, setBand] = useState(() => bandOf(window.innerWidth));
  useEffect(() => {
    const onResize = (): void => setBand(bandOf(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return band;
}

const bandOf = (width: number): 'small' | 'medium' | 'large' =>
  width >= 1280 ? 'large' : width >= 768 ? 'medium' : 'small';

/**
 * The WAI-ARIA grid pattern with a roving tabindex: exactly one cell carries
 * tabindex 0, and arrow keys move focus between cells.
 */
interface GridCursor {
  readonly x: number;
  readonly y: number;
}

interface GridNav {
  readonly cursor: GridCursor;
  readonly setCursor: (next: GridCursor) => void;
  readonly onKeyDown: (event: React.KeyboardEvent) => boolean;
  readonly register: (x: number, y: number, node: HTMLElement | null) => void;
  readonly focusCell: (x: number, y: number) => void;
}

export function useGrid(
  columns: number,
  rows: number,
  start: GridCursor,
  options?: { readonly pageRows?: number },
): GridNav {
  const [cursor, setCursorState] = useState<GridCursor>(start);
  const cells = useRef(new Map<string, HTMLElement>());
  const wanted = useRef<string | null>(null);

  const register = useCallback((x: number, y: number, node: HTMLElement | null) => {
    const key = `${x},${y}`;
    if (node === null) cells.current.delete(key);
    else cells.current.set(key, node);
  }, []);

  useLayoutEffect(() => {
    if (wanted.current === null) return;
    const node = cells.current.get(wanted.current);
    wanted.current = null;
    node?.focus();
  }, [cursor]);

  /* Moves the cursor without moving focus; a cell that takes focus by any
     means calls this, so the roving cursor always follows focus. */
  const setCursor = useCallback((next: GridCursor) => {
    setCursorState((current) =>
      current.x === next.x && current.y === next.y ? current : next,
    );
  }, []);

  const move = useCallback((next: GridCursor) => {
    wanted.current = `${next.x},${next.y}`;
    setCursorState(next);
  }, []);

  const focusCell = useCallback((x: number, y: number) => {
    wanted.current = `${x},${y}`;
    setCursorState({ x, y });
  }, []);

  const page = options?.pageRows ?? 8;

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent): boolean => {
      if (event.shiftKey || event.altKey || event.metaKey) return false;
      const clamp = (x: number, y: number): GridCursor => ({
        x: Math.min(Math.max(x, 0), columns - 1),
        y: Math.min(Math.max(y, 0), rows - 1),
      });
      switch (event.key) {
        case 'ArrowLeft':
          move(clamp(cursor.x - 1, cursor.y));
          return true;
        case 'ArrowRight':
          move(clamp(cursor.x + 1, cursor.y));
          return true;
        case 'ArrowUp':
          move(clamp(cursor.x, cursor.y - 1));
          return true;
        case 'ArrowDown':
          move(clamp(cursor.x, cursor.y + 1));
          return true;
        case 'Home':
          move(event.ctrlKey ? clamp(0, 0) : clamp(0, cursor.y));
          return true;
        case 'End':
          move(event.ctrlKey ? clamp(columns - 1, rows - 1) : clamp(columns - 1, cursor.y));
          return true;
        case 'PageUp':
          move(clamp(cursor.x, cursor.y - page));
          return true;
        case 'PageDown':
          move(clamp(cursor.x, cursor.y + page));
          return true;
        default:
          return false;
      }
    },
    [columns, rows, cursor, move, page],
  );

  return { cursor, setCursor, onKeyDown, register, focusCell };
}

/** The WAI-ARIA modal dialog pattern: focus trap, Escape, and focus return. */
export function Dialog({
  label,
  onClose,
  children,
  initialFocus,
  className,
  dialogRef,
  returnFocus,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  initialFocus?: React.RefObject<HTMLElement>;
  /** Where focus goes when the dialog closes, when that is not its opener. */
  returnFocus?: () => HTMLElement | null;
  className?: string;
  dialogRef?: React.RefObject<HTMLDivElement>;
}): ReactNode {
  const own = useRef<HTMLDivElement>(null);
  const node = dialogRef ?? own;
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = initialFocus?.current ?? focusables(node.current)[0] ?? node.current;
    target?.focus();
    return () => {
      (returnFocus?.() ?? opener.current)?.focus();
    };
    // The dialog mounts once; its first focus target never changes afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dialog-backdrop">
      <div
        className={className ?? 'dialog'}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={node}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const items = focusables(node.current);
          if (items.length === 0) return;
          const first = items[0];
          const last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (root === null) return [];
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => node.offsetParent !== null || node === document.activeElement);
}

/** Countdowns run from the server's remaining time, never the device clock. */
export function useServerCountdown(remainingMs: number | null): number | null {
  const [seconds, setSeconds] = useState<number | null>(
    remainingMs === null ? null : Math.max(0, Math.ceil(remainingMs / 1000)),
  );
  const arrived = useRef<number>(performance.now());
  const base = useRef<number | null>(remainingMs);

  useEffect(() => {
    base.current = remainingMs;
    arrived.current = performance.now();
    setSeconds(remainingMs === null ? null : Math.max(0, Math.ceil(remainingMs / 1000)));
  }, [remainingMs]);

  useEffect(() => {
    if (remainingMs === null) return;
    const timer = setInterval(() => {
      const left = (base.current ?? 0) - (performance.now() - arrived.current);
      setSeconds(Math.max(0, Math.ceil(left / 1000)));
    }, 250);
    return () => clearInterval(timer);
  }, [remainingMs]);

  return seconds;
}


export function useInterval(ms: number, work: () => void): void {
  const latest = useRef(work);
  latest.current = work;
  useEffect(() => {
    const timer = setInterval(() => latest.current(), ms);
    return () => clearInterval(timer);
  }, [ms]);
}

/** Groups a grid's cells into ARIA rows; the rows take no part in the layout. */
export function GridRows({
  columns,
  children,
}: {
  columns: number;
  children: ReactNode;
}): ReactNode {
  const cells = Children.toArray(children);
  return Array.from({ length: Math.ceil(cells.length / columns) }, (_, row) => (
    <div role="row" className="grid-row" key={row}>
      {cells.slice(row * columns, (row + 1) * columns)}
    </div>
  ));
}
