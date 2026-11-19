import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export type MotionName =
  | 'appointment-move'
  | 'queue-arrive'
  | 'board-status'
  | 'beacon-count'
  | 'beacon-roll'
  | 'toast'
  | 'chip-nudge'
  | 'idle';

const MOTION: Record<Exclude<MotionName, 'idle'>, { ms: number; easing: string }> = {
  'appointment-move': { ms: 250, easing: '0.2, 0, 0, 1' },
  'queue-arrive': { ms: 400, easing: 'ease-out' },
  'board-status': { ms: 300, easing: 'ease-in-out' },
  'beacon-count': { ms: 1600, easing: '0.16, 1, 0.3, 1' },
  'beacon-roll': { ms: 600, easing: '0.16, 1, 0.3, 1' },
  toast: { ms: 200, easing: 'ease-out' },
  'chip-nudge': { ms: 250, easing: 'ease-in-out' },
};

export function motionAttributes(
  name: Exclude<MotionName, 'idle'>,
  state: MotionName = name,
): Record<string, string> {
  const reduce = reducedMotion();
  const published = MOTION[name];
  if (state === 'idle') {
    return {
      'data-motion': reduce ? 'none' : 'idle',
      'data-motion-ms': reduce ? '0' : String(published.ms),
      'data-motion-easing': published.easing,
    };
  }
  return {
    'data-motion': reduce ? 'none' : state,
    'data-motion-ms': reduce ? '0' : String(MOTION[state as Exclude<MotionName, 'idle'>].ms),
    'data-motion-easing': MOTION[state as Exclude<MotionName, 'idle'>].easing,
  };
}

type AnnouncementContext = { announce: (text: string) => void };

const Announcer = createContext<AnnouncementContext>({ announce: () => undefined });

export function useAnnounce(): (text: string) => void {
  return useContext(Announcer).announce;
}

export function AnnouncementsRegion({ children }: { children: ReactNode }): JSX.Element {
  const [messages, setMessages] = useState<{ id: number; text: string }[]>([]);
  const next = useRef(1);
  const announce = useCallback((text: string) => {
    const id = next.current;
    next.current += 1;
    setMessages((current) => [...current, { id, text }]);
  }, []);
  return (
    <Announcer.Provider value={{ announce }}>
      <div role="status" aria-live="polite" aria-label="Announcements" className="announcements">
        {messages.map((message) => (
          <p key={message.id}>{message.text}</p>
        ))}
      </div>
      {children}
    </Announcer.Provider>
  );
}

export function AlertBanner({ message }: { message: string | null }): JSX.Element | null {
  if (!message) return null;
  return (
    <div role="alert" className="alert-banner">
      <p className="alert-banner-title">{message}</p>
    </div>
  );
}

export function InlineAlert({ message }: { message: string | null }): JSX.Element | null {
  if (!message) return null;
  return (
    <p role="alert" className="inline-alert">
      {message}
    </p>
  );
}

type PillProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'solid' | 'secondary';
  type?: 'button' | 'submit';
  busy?: boolean;
  disabled?: boolean;
  name?: string;
  className?: string;
};

export function Pill({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  busy = false,
  disabled = false,
  name,
  className = '',
}: PillProps): JSX.Element {
  return (
    <button
      type={type}
      className={`pill pill-${variant} ${className}`}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-label={name}
    >
      {children}
    </button>
  );
}

export function ArrowChip({
  href,
  label,
  onNavigate,
}: {
  href: string;
  label: string;
  onNavigate: (path: string) => void;
}): JSX.Element {
  return (
    <a
      className="arrow-chip"
      href={href}
      aria-label={label}
      {...motionAttributes('chip-nudge')}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(href);
      }}
    >
      <span aria-hidden="true">→</span>
    </a>
  );
}

export type SummaryItem = { field: string; message: string };

type DialogProps = {
  name: string;
  onClose: () => void;
  children: ReactNode;
  summary?: SummaryItem[];
  onSummaryLink?: (field: string) => void;
  className?: string;
};

/** Keeps focus inside, closes on Escape and returns focus to the opener. */
export function Dialog({
  name,
  onClose,
  children,
  summary = [],
  onSummaryLink,
  className = '',
}: DialogProps): JSX.Element {
  const container = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    opener.current = document.activeElement;
    const first = container.current?.querySelector<HTMLElement>(focusableSelector);
    first?.focus();
    return () => {
      const target = opener.current as HTMLElement | null;
      if (target && document.contains(target)) target.focus();
    };
  }, []);

  useEffect(() => {
    if (summary.length > 0) summaryRef.current?.focus();
  }, [summary.length, summary.map((item) => item.message).join('|')]);

  return (
    <div className="dialog-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`dialog ${className}`}
        ref={container}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key === 'Tab') trapFocus(event, container.current);
        }}
      >
        <h2 id={titleId} className="dialog-title">
          {name}
        </h2>
        {summary.length > 0 ? (
          <div role="alert" className="error-summary" tabIndex={-1} ref={summaryRef}>
            <ul>
              {summary.map((item) => (
                <li key={item.field}>
                  <a
                    href={`#${item.field}`}
                    onClick={(event) => {
                      event.preventDefault();
                      onSummaryLink?.(item.field);
                    }}
                  >
                    {item.message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapFocus(
  event: React.KeyboardEvent,
  container: HTMLElement | null,
): void {
  if (!container) return;
  const focusable = [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function EmptyCard({
  title,
  action,
  tint = 'mint',
}: {
  title: string;
  action?: { label: string; onClick: () => void };
  tint?: 'mint' | 'sky' | 'rose';
}): JSX.Element {
  return (
    <div className={`empty-card tint-${tint}`}>
      <p className="card-title">{title}</p>
      {action ? (
        <Pill onClick={action.onClick} variant="primary">
          {action.label}
        </Pill>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  id,
  children,
  error,
}: {
  label: string;
  id: string;
  children: ReactNode;
  error?: string | null;
}): JSX.Element {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

type BeaconValue = { label: string; value: number; tint: 'mint' | 'rose' | 'sky' };

export function KennelBeacon({ beacons }: { beacons: { waiting: number; overdue: number; dueWithinHour: number } | null }): JSX.Element {
  const cards: BeaconValue[] = [
    { label: 'Waiting', value: beacons?.waiting ?? 0, tint: 'mint' },
    { label: 'Overdue', value: beacons?.overdue ?? 0, tint: 'rose' },
    { label: 'Due within the hour', value: beacons?.dueWithinHour ?? 0, tint: 'sky' },
  ];
  return (
    <div className="beacon-stack">
      {cards.map((card, index) => (
        <BeaconCard key={card.label} card={card} index={index} ready={beacons !== null} />
      ))}
    </div>
  );
}

function digitsOf(value: number): string[] {
  return String(value).split('');
}

function BeaconCard({
  card,
  index,
  ready,
}: {
  card: BeaconValue;
  index: number;
  ready: boolean;
}): JSX.Element {
  const [shown, setShown] = useState(0);
  const [motion, setMotion] = useState<MotionName>('idle');
  const [rolling, setRolling] = useState<number[]>([]);
  const counted = useRef(false);
  const target = useRef(card.value);
  const frame = useRef(0);
  const shownRef = useRef(0);

  useEffect(() => {
    if (!ready) return;
    target.current = card.value;
    const reduce = reducedMotion();
    if (!counted.current) {
      counted.current = true;
      if (reduce) {
        shownRef.current = card.value;
        setShown(card.value);
        return;
      }
      setMotion('beacon-count');
      const delay = index * 150;
      const started = performance.now() + delay;
      const step = (): void => {
        const elapsed = performance.now() - started;
        const ratio = Math.max(0, Math.min(1, elapsed / 1600));
        const eased = 1 - Math.pow(1 - ratio, 3);
        const next = Math.round(target.current * eased);
        shownRef.current = next;
        setShown(next);
        if (ratio < 1) {
          frame.current = requestAnimationFrame(step);
          return;
        }
        shownRef.current = target.current;
        setShown(target.current);
        window.setTimeout(() => setMotion('idle'), 1000);
      };
      frame.current = requestAnimationFrame(step);
      return () => cancelAnimationFrame(frame.current);
    }
    if (shownRef.current === card.value) return;
    if (reduce) {
      shownRef.current = card.value;
      setShown(card.value);
      setRolling([]);
      return;
    }
    const before = digitsOf(shownRef.current);
    const after = digitsOf(card.value);
    const changed: number[] = [];
    if (before.length !== after.length) {
      after.forEach((_, position) => changed.push(position));
    } else {
      after.forEach((digit, position) => {
        if (before[position] !== digit) changed.push(position);
      });
    }
    shownRef.current = card.value;
    setShown(card.value);
    setRolling(changed);
    setMotion('beacon-roll');
    const clearRoll = window.setTimeout(() => setRolling([]), 600);
    const clearMotion = window.setTimeout(() => setMotion('idle'), 1600);
    return () => {
      window.clearTimeout(clearRoll);
      window.clearTimeout(clearMotion);
    };
  }, [card.value, ready, index]);

  const attributes =
    motion === 'idle'
      ? motionAttributes('beacon-roll', 'idle')
      : motionAttributes(motion as 'beacon-count' | 'beacon-roll');

  return (
    <div
      role="status"
      aria-live="off"
      aria-label={card.label}
      className={`beacon-card tint-${card.tint}`}
      data-value={card.value}
      {...attributes}
    >
      <span className="beacon-number" aria-hidden="true">
        {digitsOf(shown).map((digit, position) => (
          <span
            key={`${position}-${digit}`}
            className="beacon-digit"
            data-digit={digit}
            data-rolling={rolling.includes(position) ? 'true' : undefined}
          >
            {digit}
          </span>
        ))}
      </span>
      <span className="visually-hidden">{card.value}</span>
      <span className="beacon-caption">{card.label}</span>
    </div>
  );
}
