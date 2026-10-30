// The Hatch Seam: when a refresh (or a claim answer) shows a seat moving between open and held, the screen holds
// back the new state and reveals it in the brief's order — sweep, label, numeral, then count and check —
// or the reverse when a seat reopens. Motion only ever follows a server answer.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { coveredCount } from "./labels";

const SWEEP_MS = 480;
const COUNT_MS = 340;
export const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface SeamLane {
  held: boolean;
  label: string;
  /** The capsule or card the lane belongs to. */
  group: string;
}

export interface SeamSnapshot {
  lanes: Map<string, SeamLane>;
  /** Covered seats per group, as shown in the covered-count text and check glyph. */
  covered: Map<string, number>;
  /** Uncovered minutes per language row (board only). */
  numerals: Map<string, number>;
}

export interface SeamChange {
  key: string;
  group: string;
  toHeld: boolean;
}

type LaneMode = "open" | "held" | "sweep-in" | "sweep-out";

export interface LaneShown {
  mode: LaneMode;
  label: string;
}

interface SeatLike {
  seat: number;
  status: string;
  interpreter_initials?: string | null;
}

/** A lane's label: `open`, or the holder's initials (`taken` when the view does not name the holder). */
export function laneLabel(seat: SeatLike): string {
  if (seat.status === "open") return "open";
  return seat.interpreter_initials ?? "taken";
}

/** The lanes and covered counts of a list of assignments (capsules or cards), keyed `<number>#<seat>`. */
export function laneSnapshot(
  groups: ReadonlyArray<{ number: string; seats: ReadonlyArray<SeatLike> }>,
  numerals: Map<string, number> = new Map(),
): SeamSnapshot {
  const lanes = new Map<string, SeamLane>();
  const covered = new Map<string, number>();
  for (const group of groups) {
    covered.set(group.number, coveredCount(group.seats));
    for (const seat of group.seats) {
      lanes.set(`${group.number}#${seat.seat}`, { held: seat.status !== "open", label: laneLabel(seat), group: group.number });
    }
  }
  return { lanes, covered, numerals };
}

function changesBetween(before: SeamSnapshot, after: SeamSnapshot): SeamChange[] {
  const changes: SeamChange[] = [];
  for (const [key, lane] of after.lanes) {
    const was = before.lanes.get(key);
    if (was && was.held !== lane.held) changes.push({ key, group: lane.group, toHeld: lane.held });
  }
  return changes;
}

function without<T>(map: Map<string, T>, keys: Iterable<string>): Map<string, T> {
  const next = new Map(map);
  for (const key of keys) next.delete(key);
  return next;
}

function withEntries<T>(map: Map<string, T>, entries: Iterable<[string, T]>): Map<string, T> {
  const next = new Map(map);
  for (const [key, value] of entries) next.set(key, value);
  return next;
}

/**
 * Track a surface's server snapshot and play the Hatch Seam for every lane that changed since the last one.
 * `scope` resets the baseline without motion (a new week, a new list). `onSettled` runs once the shown state
 * matches the server, in both motion modes.
 */
export function useHatchSeam(
  snapshot: SeamSnapshot | null,
  scope: string,
  onSettled?: (changes: SeamChange[], snapshot: SeamSnapshot) => void,
) {
  const [lanes, setLanes] = useState<Map<string, LaneShown>>(new Map());
  const [covered, setCovered] = useState<Map<string, number>>(new Map());
  const [numerals, setNumerals] = useState<Map<string, number>>(new Map());
  const fills = useRef(new Map<string, HTMLElement>());
  const previous = useRef<{ scope: string; snapshot: SeamSnapshot } | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const settled = useRef(onSettled);
  settled.current = onSettled;

  const sweep = useCallback(async (keys: string[], direction: "in" | "out") => {
    const frames = direction === "in" ? ["scaleX(0)", "scaleX(1)"] : ["scaleX(1)", "scaleX(0)"];
    await Promise.all(
      keys.map(async (key) => {
        const fill = fills.current.get(key);
        if (!fill) return;
        const animation = fill.animate(
          frames.map((transform) => ({ transform })),
          { duration: SWEEP_MS, easing: EASE, fill: "forwards" },
        );
        await animation.finished.catch(() => undefined);
      }),
    );
  }, []);

  const count = useCallback((from: Map<string, number>, to: Map<string, number>, languages: string[]) => {
    if (languages.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let start: number | null = null;
      const step = (now: number) => {
        start ??= now;
        const t = Math.min(1, (now - start) / COUNT_MS);
        const eased = 1 - (1 - t) ** 3;
        if (t < 1) {
          setNumerals((shown) =>
            withEntries(
              shown,
              languages.map((code) => {
                const a = from.get(code) ?? 0;
                const b = to.get(code) ?? 0;
                return [code, Math.round(a + (b - a) * eased)];
              }),
            ),
          );
          requestAnimationFrame(step);
        } else {
          flushSync(() => setNumerals((shown) => without(shown, languages)));
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }, []);

  const play = useCallback(
    async (before: SeamSnapshot, after: SeamSnapshot, changes: SeamChange[]) => {
      const forward = changes.filter((c) => c.toHeld);
      const backward = changes.filter((c) => !c.toHeld);
      const languages = [...after.numerals.keys()].filter((code) => after.numerals.get(code) !== before.numerals.get(code));
      if (backward.length > 0) {
        flushSync(() => setCovered((shown) => without(shown, backward.map((c) => c.group))));
        await count(before.numerals, after.numerals, languages);
        flushSync(() =>
          setLanes((shown) => withEntries(shown, backward.map((c) => [c.key, { mode: "sweep-out", label: "open" }]))),
        );
        await sweep(backward.map((c) => c.key), "out");
        flushSync(() => setLanes((shown) => without(shown, backward.map((c) => c.key))));
      }
      if (forward.length > 0) {
        flushSync(() =>
          setLanes((shown) => withEntries(shown, forward.map((c) => [c.key, { mode: "sweep-in", label: "open" }]))),
        );
        await sweep(forward.map((c) => c.key), "in");
        flushSync(() => setLanes((shown) => without(shown, forward.map((c) => c.key))));
        if (backward.length === 0) await count(before.numerals, after.numerals, languages);
        flushSync(() => setCovered((shown) => without(shown, forward.map((c) => c.group))));
      }
      settled.current?.(changes, after);
    },
    [count, sweep],
  );

  useLayoutEffect(() => {
    if (!snapshot) return;
    const last = previous.current;
    previous.current = { scope, snapshot };
    if (!last || last.scope !== scope) {
      setLanes(new Map());
      setCovered(new Map());
      setNumerals(new Map());
      return;
    }
    const changes = changesBetween(last.snapshot, snapshot);
    if (changes.length === 0) return;
    if (reducedMotion()) {
      settled.current?.(changes, snapshot);
      return;
    }
    // Hold back what changed so the first paint still shows the previous state; `play` releases it in order.
    const before = last.snapshot;
    setLanes((shown) =>
      withEntries(
        shown,
        changes.map((c) => {
          const was = before.lanes.get(c.key);
          return [c.key, { mode: was?.held ? "held" : "open", label: was?.label ?? "open" }] as [string, LaneShown];
        }),
      ),
    );
    setCovered((shown) => withEntries(shown, changes.map((c) => [c.group, before.covered.get(c.group) ?? 0])));
    setNumerals((shown) =>
      withEntries(
        shown,
        [...snapshot.numerals.keys()]
          .filter((code) => snapshot.numerals.get(code) !== before.numerals.get(code))
          .map((code) => [code, before.numerals.get(code) ?? 0]),
      ),
    );
    queue.current = queue.current.then(() => play(before, snapshot, changes));
  }, [snapshot, scope, play]);

  return {
    lane(key: string, actual: { held: boolean; label: string }): LaneShown {
      return lanes.get(key) ?? { mode: actual.held ? "held" : "open", label: actual.label };
    },
    covered(group: string, actual: number): number {
      return covered.get(group) ?? actual;
    },
    numeral(code: string, actual: number): number {
      return numerals.get(code) ?? actual;
    },
    fillRef(key: string) {
      return (element: HTMLElement | null) => {
        if (element) fills.current.set(key, element);
        else fills.current.delete(key);
      };
    },
  };
}
