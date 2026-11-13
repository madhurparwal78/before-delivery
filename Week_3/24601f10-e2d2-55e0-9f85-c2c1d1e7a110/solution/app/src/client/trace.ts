import { useSyncExternalStore } from 'react';
import type { Dependent } from '../shared/api.js';
import { MOTION, reducedMotion, tween } from './motion.js';

export type Shutter = 'open' | 'half' | 'closed';
interface Segment { id: string; from: string; to: string; progress: number }

interface TraceState {
  shutters: ReadonlyMap<string, Shutter>;
  willReset: ReadonlySet<string>;
  segments: readonly Segment[];
  reached: readonly Dependent[];
}

const EMPTY: TraceState = { shutters: new Map(), willReset: new Set(), segments: [], reached: [] };

// Shutter trace choreography: a timeline of page timers and animation frames, so a paused page clock holds it.
export class TraceController {
  private state: TraceState = EMPTY;
  private readonly listeners = new Set<() => void>();
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private cancels: Array<() => void> = [];

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): TraceState => this.state;

  private set(patch: Partial<TraceState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private after(ms: number, work: () => void): void {
    this.timers.push(setTimeout(work, ms));
  }

  private halt(): void {
    this.timers.forEach(clearTimeout);
    this.cancels.forEach((cancel) => cancel());
    this.timers = [];
    this.cancels = [];
  }

  private shutter(id: string, value: Shutter): void {
    this.set({ shutters: new Map(this.state.shutters).set(id, value) });
  }

  private progress(id: string, value: number): void {
    this.set({ segments: this.state.segments.map((s) => (s.id === id ? { ...s, progress: value } : s)) });
  }

  // The path draws from the edited card to each dependent in reset order: a segment takes 320 ms, cards are reached at
  // least 90 ms apart, and each card half-closes its slats as the path arrives.
  play(edited: string, dependents: Dependent[], feederOf: (dependent: Dependent, reached: string[]) => string): void {
    this.halt();
    if (reducedMotion()) {
      this.state = { shutters: new Map(), willReset: new Set(dependents.map((d) => d.match_id)), segments: [], reached: dependents };
      this.listeners.forEach((listener) => listener());
      return;
    }
    this.state = EMPTY;
    const reachAt = new Map<string, number>([[edited, 0]]);
    let previousStart = -MOTION.stagger;
    const reachedIds: string[] = [edited];
    dependents.forEach((dependent, index) => {
      const feeder = feederOf(dependent, reachedIds);
      const start = Math.max(reachAt.get(feeder) ?? 0, previousStart + MOTION.stagger);
      const reach = start + MOTION.segment;
      reachAt.set(dependent.match_id, reach);
      reachedIds.push(dependent.match_id);
      previousStart = start;
      const segment: Segment = { id: dependent.match_id, from: feeder, to: dependent.match_id, progress: 0 };
      this.after(start, () => {
        this.set({ segments: [...this.state.segments, segment] });
        this.cancels.push(tween(MOTION.segment, (p) => this.progress(segment.id, p)));
      });
      this.after(reach, () => {
        this.shutter(dependent.match_id, 'half');
        this.set({ reached: dependents.slice(0, index + 1) });
        document.querySelector(`[data-match-id="${dependent.match_id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    });
  }

  // Cancel, or a changed score: the slats reopen card by card in reverse order, 90 ms apart, and the path retracts.
  reverse(done?: () => void): void {
    this.halt();
    const reached = [...this.state.reached].reverse();
    if (reducedMotion() || !reached.length) {
      this.state = EMPTY;
      this.listeners.forEach((listener) => listener());
      done?.();
      return;
    }
    reached.forEach((dependent, index) => {
      this.after(index * MOTION.stagger, () => {
        this.shutter(dependent.match_id, 'open');
        this.set({ reached: this.state.reached.filter((d) => d.match_id !== dependent.match_id) });
        this.cancels.push(tween(MOTION.slat, (p) => this.progress(dependent.match_id, 1 - p)));
      });
    });
    this.after((reached.length - 1) * MOTION.stagger + MOTION.slat, () => {
      this.state = EMPTY;
      this.listeners.forEach((listener) => listener());
      done?.();
    });
  }

  // Confirm edit: the slats close fully, then the cards take their new state.
  commit(): void {
    this.halt();
    const shutters = new Map<string, Shutter>();
    this.state.reached.forEach((d) => shutters.set(d.match_id, 'closed'));
    this.set({ shutters, segments: [], willReset: new Set() });
    this.after(MOTION.slat, () => {
      this.state = EMPTY;
      this.listeners.forEach((listener) => listener());
    });
  }

  // Other screens receive the reset in the same order and play the slat close on their own cards.
  playRemote(ids: string[]): void {
    if (reducedMotion()) return;
    ids.forEach((id, index) => {
      this.after(index * MOTION.stagger, () => this.shutter(id, 'half'));
      this.after(index * MOTION.stagger + MOTION.slat, () => this.shutter(id, 'closed'));
    });
    this.after((ids.length - 1) * MOTION.stagger + MOTION.slat * 2, () => this.set({ shutters: new Map() }));
  }

  clear(): void {
    this.halt();
    this.state = EMPTY;
    this.listeners.forEach((listener) => listener());
  }
}

export const useTrace = (controller: TraceController): TraceState =>
  useSyncExternalStore(controller.subscribe, controller.getSnapshot);

export function resetCountText(count: number, confirmed: number): string {
  if (count === 0) return 'No later matches will reset.';
  if (count === 1) return confirmed === 1 ? '1 match will reset, it is confirmed' : '1 match will reset, it is not confirmed';
  return `${count} matches will reset, ${confirmed} of them confirmed`;
}
