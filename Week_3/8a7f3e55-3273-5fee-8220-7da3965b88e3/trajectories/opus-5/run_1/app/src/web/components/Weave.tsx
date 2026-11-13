import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Coverage, RotationEntry, RotationPlan } from '../../shared/api.js';
import { agencyTimeOf } from '../format.js';
import { useReducedMotion } from '../hooks.js';

const ENTRY_STAGGER_MS = 40;
const ENTRY_DURATION_MS = 250;
const COUNT_DURATION_MS = 330;
const SETTLE_DURATION_MS = 330;

type Motion = 'none' | 'enter' | 'collapse' | 'settle';

function planSignature(plan: RotationPlan): string {
  return [
    plan.mode,
    ...plan.turns.map(
      (entry) =>
        `${entry.kind}|${entry.holder_initials ?? ''}|${entry.start}|${entry.end}|${entry.label ?? ''}`,
    ),
  ].join('~');
}

function holderSet(plan: RotationPlan): Set<string> {
  return new Set(
    plan.turns
      .filter((entry) => entry.kind === 'turn' && entry.holder_initials !== null)
      .map((entry) => entry.holder_initials as string),
  );
}

function minutesOf(entry: RotationEntry): number {
  return (Date.parse(entry.end) - Date.parse(entry.start)) / 60_000;
}

function splitCoverageText(text: string): { prefix: string; percent: number } {
  const match = /^(.*\u00b7 )(\d+)% covered$/u.exec(text);
  if (match === null) return { prefix: '', percent: 0 };
  return { prefix: match[1] ?? '', percent: Number(match[2]) };
}

interface DepartedEntry extends RotationEntry {
  veilSeat: number | null;
  veilInitials: string | null;
  veilDelayMs: number;
}

function withDeparted(previous: RotationPlan, gone: Set<string>): DepartedEntry[] {
  const departedIndexes = previous.turns
    .filter((entry) => entry.holder_initials !== null && gone.has(entry.holder_initials))
    .map((entry) => entry.index);
  const last = departedIndexes.length - 1;
  return previous.turns.map((entry) => {
    const position = departedIndexes.indexOf(entry.index);
    if (position < 0) {
      return { ...entry, veilSeat: null, veilInitials: null, veilDelayMs: 0 };
    }
    return {
      ...entry,
      kind: 'gap',
      seat: null,
      holder_name: null,
      holder_initials: null,
      label: 'relief needed',
      veilSeat: entry.seat,
      veilInitials: entry.holder_initials,
      veilDelayMs: (last - position) * ENTRY_STAGGER_MS,
    };
  });
}

function CoverageFigure({ text }: { text: string }): ReactNode {
  const reducedMotion = useReducedMotion();
  const host = useRef<HTMLSpanElement | null>(null);
  const drawn = useRef(splitCoverageText(text));
  const [shown, setShown] = useState(() => splitCoverageText(text));

  useEffect(() => {
    const target = splitCoverageText(text);
    const previous = drawn.current;
    drawn.current = target;
    if (previous.percent === target.percent || reducedMotion || host.current === null) {
      setShown(target);
      return;
    }
    setShown({ prefix: previous.prefix, percent: previous.percent });
    const animation = host.current.animate(
      [
        { '--coverage-count': previous.percent },
        { '--coverage-count': target.percent },
      ] as unknown as Keyframe[],
      { duration: COUNT_DURATION_MS, easing: 'cubic-bezier(0.33, 0, 0.2, 1)' },
    );
    let live = true;
    const step = (): void => {
      if (!live) return;
      const progress = animation.effect?.getComputedTiming().progress ?? null;
      if (progress === null || animation.playState !== 'running') {
        setShown(target);
        return;
      }
      const value = Math.round(
        previous.percent + (target.percent - previous.percent) * progress,
      );
      setShown({ prefix: previous.prefix, percent: value });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return () => {
      live = false;
    };
  }, [text, reducedMotion]);

  return (
    <span className="mono" role="status" aria-label="Coverage" ref={host}>
      {`${shown.prefix}${shown.percent}% covered`}
    </span>
  );
}

function entryStyle(entry: RotationEntry, index: number, delayMs: number): CSSProperties {
  return {
    flexGrow: minutesOf(entry),
    flexBasis: 0,
    ['--entry-index' as string]: index,
    ['--veil-delay' as string]: delayMs,
  };
}

export function RotationWeave({
  plan,
  coverage,
  bookingId,
}: {
  plan: RotationPlan;
  coverage: Coverage;
  bookingId: string;
}): ReactNode {
  const reducedMotion = useReducedMotion();
  const [drawn, setDrawn] = useState<RotationPlan>(plan);
  const [motion, setMotion] = useState<Motion>('none');
  const [departed, setDeparted] = useState<DepartedEntry[] | null>(null);
  const signature = useRef(`${bookingId}:${planSignature(plan)}`);
  const settleTimer = useRef<number | null>(null);

  useEffect(() => {
    const next = `${bookingId}:${planSignature(plan)}`;
    if (next === signature.current) return;
    const previous = drawn;
    signature.current = next;

    const gone = new Set(
      [...holderSet(previous)].filter((initials) => !holderSet(plan).has(initials)),
    );
    const holderLeft = gone.size > 0 && coverage.percent < 100;

    if (reducedMotion) {
      setDeparted(null);
      setDrawn(plan);
      setMotion('none');
      return;
    }

    if (holderLeft && previous.turns.length > 0) {
      const frames = withDeparted(previous, gone);
      const longest = Math.max(...frames.map((frame) => frame.veilDelayMs), 0);
      setDeparted(frames);
      setMotion('collapse');
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => {
        setDeparted(null);
        setDrawn(plan);
        setMotion('settle');
      }, longest + ENTRY_DURATION_MS);
      return;
    }

    setDeparted(null);
    setDrawn(plan);
    setMotion('enter');
  }, [plan, bookingId, drawn, coverage.percent, reducedMotion]);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (motion !== 'settle') return;
    const timer = window.setTimeout(() => setMotion('none'), SETTLE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [motion]);

  const entries: DepartedEntry[] =
    departed ??
    drawn.turns.map((entry) => ({
      ...entry,
      veilSeat: null,
      veilInitials: null,
      veilDelayMs: 0,
    }));
  const turnCount = plan.turns.filter((entry) => entry.kind === 'turn').length;

  return (
    <div className="weave-wrap">
      <div className="weave" role="img" aria-label="Rotation weave" data-mode={drawn.mode} data-motion={motion}>
        {entries.map((entry, index) => (
          <div
            key={`${signature.current}:${entry.index}`}
            className="weave-entry"
            data-turn-index={entry.index}
            data-kind={entry.kind}
            data-holder={entry.holder_initials ?? ''}
            data-seat={entry.seat ?? ''}
            data-start={agencyTimeOf(entry.start)}
            data-end={agencyTimeOf(entry.end)}
            style={entryStyle(entry, index, entry.veilDelayMs)}
          >
            {entry.kind === 'turn' ? (
              <span className="turn-initials">{entry.holder_initials}</span>
            ) : (
              <span className="gap-label">{entry.label}</span>
            )}
            {entry.veilInitials === null ? null : (
              <span className="veil" data-seat={entry.veilSeat ?? ''}>
                <span className="turn-initials">{entry.veilInitials}</span>
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="coverage-line">
        <CoverageFigure text={plan.coverage_text} />
      </p>
      <ol className="plain-list" role="list" aria-label="Rotation plan">
        {plan.turns.map((entry) => (
          <li key={entry.index} className="mono">
            {entry.kind === 'turn'
              ? `Turn ${plan.turns.filter((other) => other.kind === 'turn' && other.index < entry.index).length + 1} of ${turnCount}: ${entry.holder_name ?? ''}, ${agencyTimeOf(entry.start)}\u2013${agencyTimeOf(entry.end)}`
              : `Gap: ${entry.label ?? ''}, ${agencyTimeOf(entry.start)}\u2013${agencyTimeOf(entry.end)}`}
          </li>
        ))}
      </ol>
    </div>
  );
}
