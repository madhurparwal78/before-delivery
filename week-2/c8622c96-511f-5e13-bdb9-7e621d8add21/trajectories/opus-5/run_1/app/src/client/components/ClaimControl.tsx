import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clock, Lock } from 'lucide-react';

const COMMIT_MS = 900;
const RETRACT_MS = 250;
const TOUCH_ALLOWANCE_PX = 10;
const RING_RADIUS = 66;

export type ClaimRingState = 'idle' | 'won' | 'held' | 'pending';

export interface ClaimControlProps {
  reducedMotion: boolean;
  /** The claim stamp text from the server's answer, shown in "Claim status". */
  statusText: string;
  ringState: ClaimRingState;
  sending: boolean;
  onCommit: () => void;
  children: React.ReactNode;
}

/** The grease-pencil hold: the ring is driven by elapsed hold time, never by an animation. */
export function ClaimControl({
  reducedMotion,
  statusText,
  ringState,
  sending,
  onCommit,
  children,
}: ClaimControlProps): React.ReactElement {
  const [progress, setProgress] = useState(0);
  const [stepTwo, setStepTwo] = useState(false);
  const holdStart = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const beat = useRef<number | null>(null);
  const committed = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const confirm = useRef<HTMLButtonElement | null>(null);

  const stopTimers = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (beat.current !== null) window.clearInterval(beat.current);
    frame.current = null;
    beat.current = null;
  }, []);

  const retract = useCallback(() => {
    stopTimers();
    holdStart.current = null;
    origin.current = null;
    const from = progress;
    if (from <= 0) {
      setProgress(0);
      return;
    }
    const started = Date.now();
    const step = (): void => {
      const elapsed = Date.now() - started;
      const value = Math.max(0, from * (1 - elapsed / RETRACT_MS));
      setProgress(value);
      if (value > 0) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [progress, stopTimers]);

  const commit = useCallback(() => {
    if (committed.current) return;
    committed.current = true;
    stopTimers();
    holdStart.current = null;
    origin.current = null;
    setProgress(100);
    onCommit();
  }, [onCommit, stopTimers]);

  const tick = useCallback(() => {
    const started = holdStart.current;
    if (started === null) return;
    const elapsed = Date.now() - started;
    setProgress(Math.min(100, (elapsed / COMMIT_MS) * 100));
    if (elapsed >= COMMIT_MS) commit();
  }, [commit]);

  const startHold = useCallback(
    (point: { x: number; y: number } | null) => {
      if (sending || holdStart.current !== null) return;
      committed.current = false;
      holdStart.current = Date.now();
      origin.current = point;
      setProgress(0);
      const loop = (): void => {
        tick();
        if (holdStart.current !== null) frame.current = requestAnimationFrame(loop);
      };
      frame.current = requestAnimationFrame(loop);
      beat.current = window.setInterval(() => tick(), 16);
    },
    [sending, tick],
  );

  const cancelHold = useCallback(() => {
    if (holdStart.current === null) return;
    retract();
  }, [retract]);

  useEffect(() => {
    if (holdStart.current === null) return;
    const onTouchStart = (event: TouchEvent): void => {
      if (event.touches.length > 1) cancelHold();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelHold();
    };
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [cancelHold, progress]);

  useEffect(() => stopTimers, [stopTimers]);

  useEffect(() => {
    if (ringState === 'idle' && !sending && holdStart.current === null && !stepTwo) setProgress(0);
  }, [ringState, sending, stepTwo]);

  const ringProgress = ringState === 'idle' ? progress : 100;
  const circumference = 2 * Math.PI * RING_RADIUS;
  const drawn = (ringProgress / 100) * circumference;
  const resultIcon = !reducedMotion
    ? null
    : ringState === 'won' ? (
      <Check size={14} aria-hidden="true" />
    ) : ringState === 'held' ? (
      <Lock size={14} aria-hidden="true" />
    ) : ringState === 'pending' ? (
      <Clock size={14} aria-hidden="true" />
    ) : null;

  return (
    <div className="claim-area">
      <div className="print-stack">
        {children}
        {reducedMotion ? null : (
          <svg className={`ring${ringState === 'won' ? ' won' : ''}`} viewBox="0 0 144 144" aria-hidden="true">
            <circle
              cx="72"
              cy="72"
              r={RING_RADIUS}
              strokeDasharray={`${drawn} ${circumference}`}
              transform="rotate(-90 72 72)"
              opacity={ringProgress > 0 ? 1 : 0}
            />
          </svg>
        )}
      </div>
      {reducedMotion && stepTwo ? (
        <div className="row">
          <button
            type="button"
            ref={confirm}
            onClick={() => {
              setStepTwo(false);
              committed.current = false;
              commit();
            }}
          >
            Confirm claim
          </button>
          <button
            type="button"
            onClick={() => {
              setStepTwo(false);
              button.current?.focus();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setStepTwo(false);
                button.current?.focus();
              }
            }}
          >
            Cancel claim
          </button>
          <span className="mono">Step 2 of 2</span>
        </div>
      ) : (
        <button
          type="button"
          className="claim-button"
          ref={button}
          disabled={sending}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            if (reducedMotion) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            startHold({ x: event.clientX, y: event.clientY });
          }}
          onPointerMove={(event) => {
            if (reducedMotion || holdStart.current === null) return;
            const from = origin.current;
            if (!from) return;
            const distance = Math.hypot(event.clientX - from.x, event.clientY - from.y);
            if (event.pointerType === 'touch') {
              if (distance > TOUCH_ALLOWANCE_PX) cancelHold();
              return;
            }
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            ) {
              cancelHold();
            }
          }}
          onPointerUp={() => {
            if (reducedMotion) return;
            cancelHold();
          }}
          onPointerCancel={() => cancelHold()}
          onLostPointerCapture={() => cancelHold()}
          onKeyDown={(event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return;
            event.preventDefault();
            if (reducedMotion) {
              setStepTwo(true);
              window.setTimeout(() => confirm.current?.focus(), 0);
              return;
            }
            if (event.repeat) return;
            startHold(null);
          }}
          onKeyUp={(event) => {
            if (reducedMotion) return;
            if (event.key === ' ' || event.key === 'Enter') cancelHold();
          }}
          onClick={(event) => {
            if (!reducedMotion) return;
            event.preventDefault();
            setStepTwo(true);
            window.setTimeout(() => confirm.current?.focus(), 0);
          }}
        >
          Claim exclusive window
        </button>
      )}
      <div
        className="claim-progress"
        role="progressbar"
        aria-label="Claim progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
      >
        <div style={{ width: `${progress}%` }} />
      </div>
      <span
        className={`stamp result ${ringState === 'won' ? 'won' : ringState === 'idle' ? '' : ringState}`}
        role="status"
        aria-label="Claim status"
      >
        {resultIcon}
        {statusText}
      </span>
    </div>
  );
}
