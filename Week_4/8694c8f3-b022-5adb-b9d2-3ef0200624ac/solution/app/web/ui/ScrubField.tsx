import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

interface ScrubFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  decimals?: number;
  /** BPM moves by 0.1 whatever Shift says. */
  fixedStep?: number;
  disabled?: boolean;
  error?: string | undefined;
  normalize?: (value: number) => number;
  onPreview?: (value: number) => void;
  onCommit: (value: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  onCancel?: () => void;
}

const IDLE_COMMIT_MS = 2000;
const DRAG_START_PX = 3;

export function ScrubField(props: ScrubFieldProps) {
  const { label, value, min, max, decimals = 3, fixedStep, disabled, error, normalize } = props;
  const [current, setCurrent] = useState(value);
  const [draft, setDraftState] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const setDraft = (next: string | null): void => {
    draftRef.current = next;
    setDraftState(next);
  };
  const [scrubbing, setScrubbing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const live = useRef({ current: value, dirty: false, base: value, focusValue: value, timer: 0, press: null as null | { x: number; start: number; moved: boolean } });
  const props$ = useRef(props);
  props$.current = props;

  useEffect(() => {
    if (!live.current.dirty && live.current.press === null) {
      live.current.current = value;
      live.current.base = value;
      setCurrent(value);
    }
  }, [value]);

  const clamp = (raw: number): number => {
    const bounded = Math.min(Math.max(raw, min), max);
    const rounded = Math.round(bounded * 10_000) / 10_000;
    return normalize ? normalize(rounded) : rounded;
  };

  const setLive = (next: number): void => {
    live.current.current = next;
    live.current.dirty = true;
    setCurrent(next);
  };

  const commit = (): void => {
    window.clearTimeout(live.current.timer);
    let next = live.current.current;
    if (draftRef.current !== null) {
      const parsed = Number.parseFloat(draftRef.current.replace(",", "."));
      next = Number.isFinite(parsed) ? clamp(parsed) : live.current.base;
    }
    setDraft(null);
    setCurrent(next);
    live.current.current = next;
    const changed = live.current.dirty && next !== live.current.base;
    live.current.dirty = false;
    if (changed) {
      live.current.base = next;
      props$.current.onCommit(next);
    } else {
      props$.current.onPreview?.(live.current.base);
    }
  };

  const schedule = (): void => {
    window.clearTimeout(live.current.timer);
    live.current.timer = window.setTimeout(commit, IDLE_COMMIT_MS);
  };

  const stepFor = (shift: boolean): number => fixedStep ?? (shift ? 0.01 : 0.1);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (disabled) return;
    const forward = event.key === "ArrowUp" || event.key === "ArrowRight";
    const backward = event.key === "ArrowDown" || event.key === "ArrowLeft";
    if (forward || backward) {
      event.preventDefault();
      const typed = draftRef.current === null ? Number.NaN : Number.parseFloat(draftRef.current);
      const base = Number.isFinite(typed) ? typed : live.current.current;
      const next = clamp(base + (forward ? 1 : -1) * stepFor(event.shiftKey));
      setDraft(null);
      setLive(next);
      props$.current.onPreview?.(next);
      schedule();
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape" && (live.current.dirty || draftRef.current !== null)) {
      event.preventDefault();
      event.stopPropagation();
      window.clearTimeout(live.current.timer);
      live.current.dirty = false;
      live.current.current = live.current.focusValue;
      setDraft(null);
      setCurrent(live.current.focusValue);
      props$.current.onPreview?.(live.current.focusValue);
      props$.current.onCancel?.();
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLInputElement>): void => {
    if (disabled || event.button !== 0) return;
    if (document.activeElement === input.current && draftRef.current !== null) return;
    event.preventDefault();
    input.current?.setPointerCapture(event.pointerId);
    live.current.press = { x: event.clientX, start: live.current.current, moved: false };
  };

  const onPointerMove = (event: PointerEvent<HTMLInputElement>): void => {
    const press = live.current.press;
    if (!press) return;
    const delta = event.clientX - press.x;
    if (!press.moved && Math.abs(delta) < DRAG_START_PX) return;
    if (!press.moved) {
      press.moved = true;
      setScrubbing(true);
      props$.current.onScrubStart?.();
    }
    const next = clamp(press.start + delta * stepFor(event.shiftKey));
    setDraft(null);
    setLive(next);
    props$.current.onPreview?.(next);
  };

  const onPointerUp = (event: PointerEvent<HTMLInputElement>): void => {
    const press = live.current.press;
    live.current.press = null;
    if (!press) return;
    if (input.current?.hasPointerCapture(event.pointerId)) input.current.releasePointerCapture(event.pointerId);
    if (press.moved) {
      setScrubbing(false);
      commit();
      props$.current.onScrubEnd?.();
    } else {
      input.current?.focus();
      input.current?.select();
    }
  };

  const shown = draft ?? current.toFixed(decimals);
  return (
    <div className="scrub-cell">
      <input
        ref={input}
        type="text"
        role="spinbutton"
        inputMode="decimal"
        aria-label={label}
        aria-valuenow={current}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-invalid={error ? true : undefined}
        className="scrub"
        data-scrubbing={scrubbing ? "true" : undefined}
        value={shown}
        readOnly={disabled}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => {
          live.current.focusValue = live.current.current;
        }}
        onChange={(event) => {
          if (disabled) return;
          live.current.dirty = true;
          setDraft(event.target.value);
          schedule();
        }}
        onBlur={() => {
          if (live.current.dirty || draftRef.current !== null) commit();
        }}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {error ? <div className="field-error">{error}</div> : null}
    </div>
  );
}
