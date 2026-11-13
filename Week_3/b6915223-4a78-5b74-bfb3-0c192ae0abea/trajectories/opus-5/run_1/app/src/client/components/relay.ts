import { useCallback, useEffect, useRef, useState } from 'react';
import { EVENT_LABELS } from '../../shared/copy.ts';
import type { PointsUpdate } from '../state.tsx';
import type { ShirtBadge } from './Pitch.tsx';

export const PULSE_MS = 180;
export const FLIGHT_MS = 380;
export const ROLL_MS = 600;
export const ROW_MS = 333;
const STATIC_BADGE_MS = 4000;
const BENCH_BADGE_MS = 1500;

export const signed = (delta: number): string => (delta > 0 ? `+${delta}` : String(delta));

export const chipText = (update: PointsUpdate): string => {
  const tag = update.multiplier > 1 ? ` x${update.multiplier}` : '';
  return `${signed(update.team_delta)}${tag}`;
};

export const relayAnnouncement = (update: PointsUpdate, total: number): string => {
  const label = EVENT_LABELS[update.event_type] ?? update.event_type;
  if (!update.counts) return `${update.player_name}: ${label} on your bench, not counted.`;
  if (update.voided) {
    return `${update.player_name}: ${label} removed, ${signed(update.team_delta)} for your team. Gameweek total ${total}.`;
  }
  return `${update.player_name}: ${label}, ${signed(update.team_delta)} for your team. Gameweek total ${total}.`;
};

export interface FlyingChip {
  text: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  key: number;
}

export interface RelayState {
  /** The shirt flashing its amber outline during the pulse stage. */
  pulsingId: string | null;
  pointsOverride: Record<string, number>;
  totalOverride: number | null;
  badges: Record<string, ShirtBadge>;
  flying: FlyingChip | null;
  rolling: boolean;
  movingManagerId: string | null;
}

export interface RelayOptions {
  reducedMotion: boolean;
  managerId: string;
  onRowMove: () => void;
}

/** The four-stage Points relay, one event at a time and never reversing. */
export const useRelay = (options: RelayOptions) => {
  const { reducedMotion, managerId, onRowMove } = options;
  const [state, setState] = useState<RelayState>({
    pulsingId: null,
    pointsOverride: {},
    totalOverride: null,
    badges: {},
    flying: null,
    rolling: false,
    movingManagerId: null,
  });
  const timers = useRef<number[]>([]);
  const running = useRef<PointsUpdate | null>(null);
  const chipKey = useRef(0);

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const later = (ms: number, work: () => void): void => {
    timers.current.push(window.setTimeout(work, ms));
  };

  const settle = useCallback(
    (update: PointsUpdate, dimmed: boolean, badgeMs: number) => {
      setState((current) => ({
        ...current,
        pulsingId: null,
        pointsOverride: { ...current.pointsOverride, [update.player_id]: update.player_team_points },
        totalOverride: update.gameweek_total,
        badges: { ...current.badges, [update.player_id]: { text: chipText(update), dimmed } },
        flying: null,
        rolling: false,
        movingManagerId: null,
      }));
      later(badgeMs, () =>
        setState((current) => {
          const badges = { ...current.badges };
          delete badges[update.player_id];
          return { ...current, badges };
        }),
      );
      onRowMove();
    },
    [onRowMove],
  );

  const play = useCallback(
    (update: PointsUpdate) => {
      const previous = running.current;
      clearTimers();
      if (previous !== null) {
        running.current = null;
        settle(update, !update.counts, STATIC_BADGE_MS);
        return;
      }
      if (reducedMotion) {
        settle(update, !update.counts, update.counts ? STATIC_BADGE_MS : BENCH_BADGE_MS);
        return;
      }
      if (!update.counts) {
        setState((current) => ({
          ...current,
          pointsOverride: {
            ...current.pointsOverride,
            [update.player_id]: update.player_team_points,
          },
          badges: { ...current.badges, [update.player_id]: { text: chipText(update), dimmed: true } },
        }));
        later(BENCH_BADGE_MS, () =>
          setState((current) => {
            const badges = { ...current.badges };
            delete badges[update.player_id];
            return { ...current, badges };
          }),
        );
        return;
      }

      running.current = update;
      chipKey.current += 1;
      const key = chipKey.current;

      const shirt = document
        .querySelector<HTMLElement>(`[data-player-id="${update.player_id}"]`)
        ?.getBoundingClientRect();
      const total = document
        .querySelector<HTMLElement>('[data-gameweek-total]')
        ?.getBoundingClientRect();

      setState((current) => ({
        ...current,
        pulsingId: update.player_id,
        pointsOverride: {
          ...current.pointsOverride,
          [update.player_id]: update.player_team_points,
        },
        flying:
          shirt === undefined || total === undefined
            ? null
            : {
                key,
                text: chipText(update),
                from: { x: shirt.left + shirt.width / 2, y: shirt.top + shirt.height / 2 },
                to: { x: total.left + total.width / 2, y: total.top + total.height / 2 },
              },
      }));

      later(PULSE_MS, () => {
        setState((current) => ({ ...current, pulsingId: null }));
      });
      later(PULSE_MS + FLIGHT_MS, () => {
        setState((current) => ({
          ...current,
          flying: null,
          totalOverride: update.gameweek_total,
          rolling: true,
        }));
      });
      later(PULSE_MS + FLIGHT_MS + ROLL_MS, () => {
        setState((current) => ({ ...current, rolling: false, movingManagerId: managerId }));
        onRowMove();
      });
      later(PULSE_MS + FLIGHT_MS + ROLL_MS + ROW_MS, () => {
        running.current = null;
        setState((current) => ({ ...current, movingManagerId: null }));
      });
    },
    [clearTimers, managerId, onRowMove, reducedMotion, settle],
  );

  const reset = useCallback(() => {
    clearTimers();
    running.current = null;
    setState({
      pulsingId: null,
      pointsOverride: {},
      totalOverride: null,
      badges: {},
      flying: null,
      rolling: false,
      movingManagerId: null,
    });
  }, [clearTimers]);

  return { state, play, reset };
};
