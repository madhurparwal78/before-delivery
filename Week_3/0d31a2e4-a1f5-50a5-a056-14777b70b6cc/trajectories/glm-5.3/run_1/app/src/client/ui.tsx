import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { hueFor } from "../shared/domain.js";

/** Lucide outline icons drawn inline, in ink. */
export function Icon({ name, size = 18 }: { name: string; size?: number }): JSX.Element {
  const paths: Record<string, ReactNode> = {
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    x: (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    ),
    message: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    mic: (
      <>
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <path d="M12 19v3" />
      </>
    ),
    micOff: (
      <>
        <path d="M2 2l20 20" />
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
        <path d="M15 9.34V5a3 3 0 0 0-5.94-.6" />
        <path d="M17 16.95A7 7 0 0 1 5 12v-2" />
        <path d="M12 19v3" />
      </>
    ),
    micWave: (
      <>
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <path d="M12 19v3" />
        <path d="M22 8v8" />
      </>
    ),
    userPlus: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M19 8v6" />
        <path d="M22 11h-6" />
      </>
    ),
    crown: (
      <>
        <path d="m2 6 4 12h12l4-12-6 3-4-7-4 7Z" />
      </>
    ),
    flag: (
      <>
        <path d="M4 22V4" />
        <path d="M4 4c6-2 10 2 16 0v10c-6 2-10-2-16 0" />
      </>
    ),
    arrowUp: (
      <>
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
      </>
    ),
    arrowLeft: (
      <>
        <path d="M19 12H5" />
        <path d="m12 19-7-7 7-7" />
      </>
    ),
    arrowRight: (
      <>
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </>
    ),
    check: <path d="M20 6 9 17l-5-5" />,
    ban: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="m4.9 4.9 14.2 14.2" />
      </>
    ),
    play: <path d="m6 4 14 8-14 8Z" />,
    pause: (
      <>
        <path d="M6 4h3v16H6z" />
        <path d="M15 4h3v16h-3z" />
      </>
    ),
    camera: (
      <>
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
        <circle cx="12" cy="13" r="3" />
      </>
    ),
    chevronLeft: <path d="m15 18-6-6 6-6" />,
    chevronRight: <path d="m9 18 6-6-6-6" />,
    panelRight: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M15 3v18" />
      </>
    ),
    logOut: (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5" />
        <path d="M21 12H9" />
      </>
    )
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name] ?? null}
    </svg>
  );
}

/** A procedural bean: a rounded jelly body with two eyes, in the player's hue. */
export function Bean({
  userId,
  size = 28,
  bob = false,
  bobDelay = 0
}: {
  userId: number;
  size?: number;
  bob?: boolean;
  bobDelay?: number;
}): JSX.Element {
  const hue = hueFor(userId);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={bob ? "lobby-bob" : undefined}
      style={bob ? { animationDelay: `${bobDelay}s` } : undefined}
      data-hue={hue}
      role="img"
      aria-label="bean"
      focusable="false"
    >
      <ellipse cx="16" cy="17" rx="12.5" ry="13" fill={`hsl(${hue} 72% 62%)`} stroke="#241b4e" strokeWidth="1.6" />
      <ellipse cx="12.4" cy="15" rx="2.1" ry="2.7" fill="#241b4e" />
      <ellipse cx="19.6" cy="15" rx="2.1" ry="2.7" fill="#241b4e" />
      <path d="M13 21c1.8 1.4 4.2 1.4 6 0" stroke="#241b4e" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}



/** A dialog panel that traps focus and returns it on close. */
export function PanelDialog({
  label,
  onClose,
  side = "right",
  children
}: {
  label: string;
  onClose: () => void;
  side?: "right" | "full";
  children: ReactNode;
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = ref.current;
    if (node) {
      const focusables = node.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      (focusables[0] ?? node).focus();
      setReady(true);
    }
    // Closing returns focus to the control that opened the panel.
    return () => {
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const node = ref.current;
      if (!node) return;
      const items = Array.from(
        node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter((el) => !el.hasAttribute("disabled"));
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
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  void ready;

  return (
    <div className="dialog-backdrop" data-side={side} onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="dialog-panel"
        tabIndex={-1}
      >
        <div className="dialog-head">
          <h2>{label}</h2>
          <button type="button" className="btn btn-small" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label: string }): JSX.Element {
  return (
    <span className="mono" aria-live="off">
      {label}
    </span>
  );
}

/** Seconds left on a countdown, ticking once a second. */
export function useCountdown(endsAt: number | null): [number, () => void] {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
  );
  useEffect(() => {
    if (endsAt === null) return;
    const timer = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    }, 250);
    return () => clearInterval(timer);
  }, [endsAt]);
  return [secondsLeft, () => setSecondsLeft(0)];
}

/** Wraps an async action with a pending flag; the returned copy sets it while it runs. */
export function usePending(): [boolean, <T extends () => Promise<void>>(fn: T) => () => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const wrap = <T extends () => Promise<void>>(fn: T): (() => Promise<void>) => {
    return async () => {
      setBusy(true);
      try {
        await fn();
      } finally {
        setBusy(false);
      }
    };
  };
  return [busy, wrap];
}
