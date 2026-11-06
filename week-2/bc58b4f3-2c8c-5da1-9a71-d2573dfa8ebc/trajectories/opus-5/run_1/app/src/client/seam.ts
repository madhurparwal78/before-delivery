import { useEffect, useRef, useState } from 'react';

export const SWEEP_MS = 500;
export const COUNT_MS = 330;

export interface SeamSeat {
  /** Stable identity, `<number>:<seat>`. */
  key: string;
  held: boolean;
  label: string;
  groupKey: string | null;
  capsuleKey: string;
  announceSubject: string;
}

export interface SeamSnapshot {
  seats: SeamSeat[];
  groups: Array<{ key: string; uncoveredMinutes: number }>;
  capsules: Array<{ key: string; covered: number; seats: number }>;
}

export interface SeamDisplay {
  fill: Record<string, number>;
  label: Record<string, string>;
  animating: Record<string, boolean>;
  uncovered: Record<string, number>;
  covered: Record<string, number>;
}

const EMPTY: SeamDisplay = { fill: {}, label: {}, animating: {}, uncovered: {}, covered: {} };

function finalDisplay(snapshot: SeamSnapshot): SeamDisplay {
  const display: SeamDisplay = { fill: {}, label: {}, animating: {}, uncovered: {}, covered: {} };
  for (const seat of snapshot.seats) {
    display.fill[seat.key] = seat.held ? 1 : 0;
    display.label[seat.key] = seat.label;
    display.animating[seat.key] = false;
  }
  for (const group of snapshot.groups) {
    display.uncovered[group.key] = group.uncoveredMinutes;
  }
  for (const capsule of snapshot.capsules) {
    display.covered[capsule.key] = capsule.covered;
  }
  return display;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function formatSpoken(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  return `${hours} h ${String(totalMinutes % 60).padStart(2, '0')} m`;
}

/**
 * Plays the Hatch Seam: a server-confirmed seat change sweeps its lane, then switches the
 * lane label, then counts the gutter numeral, then settles the capsule's coverage mark.
 */
export function useHatchSeam(snapshot: SeamSnapshot | null): {
  display: SeamDisplay;
  announcement: string;
} {
  const [display, setDisplay] = useState<SeamDisplay>(EMPTY);
  const [announcement, setAnnouncement] = useState('');
  const timers = useRef<number[]>([]);
  const frames = useRef<number[]>([]);
  const previous = useRef<SeamSnapshot | null>(null);
  const displayRef = useRef<SeamDisplay>(EMPTY);

  useEffect(
    () => () => {
      for (const timer of timers.current) {
        window.clearTimeout(timer);
      }
      for (const frame of frames.current) {
        window.cancelAnimationFrame(frame);
      }
    },
    [],
  );

  useEffect(() => {
    if (snapshot === null) {
      return;
    }
    const target = finalDisplay(snapshot);
    const before = previous.current;
    previous.current = snapshot;

    const patch = (change: Partial<SeamDisplay>): void => {
      setDisplay((current) => {
        const next: SeamDisplay = {
          fill: { ...current.fill, ...change.fill },
          label: { ...current.label, ...change.label },
          animating: { ...current.animating, ...change.animating },
          uncovered: { ...current.uncovered, ...change.uncovered },
          covered: { ...current.covered, ...change.covered },
        };
        displayRef.current = next;
        return next;
      });
    };

    const changed = before === null
      ? []
      : snapshot.seats.filter((seat) => {
          const was = before.seats.find((candidate) => candidate.key === seat.key);
          return was !== undefined && was.held !== seat.held;
        });

    if (changed.length > 0) {
      const sentences = changed.map((seat) => {
        const minutes = seat.groupKey === null ? null : (target.uncovered[seat.groupKey] ?? 0);
        const tail = minutes === null ? '' : `, ${formatSpoken(minutes)} uncovered this week`;
        return seat.held
          ? `${seat.announceSubject} covered by ${seat.label}${tail}`
          : `${seat.announceSubject} open${tail}`;
      });
      setAnnouncement(sentences.join(' '));
    }

    if (before === null || changed.length === 0 || prefersReducedMotion()) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    // Everything the seam does not step through settles at once.
    const steady: SeamDisplay = { fill: {}, label: {}, animating: {}, uncovered: {}, covered: {} };
    const changedGroups = new Set(changed.map((seat) => seat.groupKey));
    const changedCapsules = new Set(changed.map((seat) => seat.capsuleKey));
    for (const seat of snapshot.seats) {
      if (!changed.some((candidate) => candidate.key === seat.key)) {
        steady.fill[seat.key] = target.fill[seat.key] ?? 0;
        steady.label[seat.key] = target.label[seat.key] ?? '';
      }
    }
    for (const group of snapshot.groups) {
      if (!changedGroups.has(group.key)) {
        steady.uncovered[group.key] = group.uncoveredMinutes;
      }
    }
    for (const capsule of snapshot.capsules) {
      if (!changedCapsules.has(capsule.key)) {
        steady.covered[capsule.key] = capsule.covered;
      }
    }
    patch({ fill: steady.fill, label: steady.label, uncovered: steady.uncovered, covered: steady.covered });

    const countGroup = (groupKey: string, to: number, delay: number): void => {
      const start = () => {
        const from = displayRef.current.uncovered[groupKey] ?? to;
        if (from === to) {
          patch({ uncovered: { [groupKey]: to } });
          return;
        }
        const began = performance.now();
        const step = (now: number): void => {
          const progress = Math.min(1, (now - began) / COUNT_MS);
          const value = progress >= 1 ? to : Math.round(from + (to - from) * progress);
          patch({ uncovered: { [groupKey]: value } });
          if (progress < 1) {
            frames.current.push(window.requestAnimationFrame(step));
          }
        };
        frames.current.push(window.requestAnimationFrame(step));
      };
      timers.current.push(window.setTimeout(start, delay));
    };

    const after = (delay: number, run: () => void): void => {
      timers.current.push(window.setTimeout(run, delay));
    };

    for (const seat of changed) {
      if (seat.held) {
        patch({ animating: { [seat.key]: true }, fill: { [seat.key]: 1 } });
        after(SWEEP_MS, () => patch({ label: { [seat.key]: seat.label } }));
        if (seat.groupKey !== null) {
          countGroup(seat.groupKey, target.uncovered[seat.groupKey] ?? 0, SWEEP_MS);
        }
        after(SWEEP_MS + COUNT_MS, () =>
          patch({ covered: { [seat.capsuleKey]: target.covered[seat.capsuleKey] ?? 0 } }),
        );
      } else {
        patch({ covered: { [seat.capsuleKey]: target.covered[seat.capsuleKey] ?? 0 } });
        if (seat.groupKey !== null) {
          countGroup(seat.groupKey, target.uncovered[seat.groupKey] ?? 0, 0);
        }
        after(COUNT_MS, () =>
          patch({ animating: { [seat.key]: true }, label: { [seat.key]: seat.label }, fill: { [seat.key]: 0 } }),
        );
      }
    }
  }, [snapshot]);

  return { display, announcement };
}
