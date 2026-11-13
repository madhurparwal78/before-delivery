import type { ConfigJson, PlayerSettings } from '../shared/types';

export interface Player {
  id: string;
  display_name: string;
}

export const app: {
  config: ConfigJson;
  player: Player | null;
  settings: PlayerSettings;
} = {
  config: {
    heartbeat_ms: 5000,
    presence_grace_ms: 15000,
    upload_max_bytes: 65536,
    max_grid: 25,
    max_players: 8,
    live_rate: 30,
    toast_ms: 4000,
    replay_step_ms: 500,
  },
  player: null,
  settings: { skip_filled: true, jump_next_clue: false, autocheck: false },
};

const timers: number[] = [];

/** Every client timer is a page timer, so a paused page clock controls it. */
export function pageInterval(run: () => void, ms: number): void {
  timers.push(window.setInterval(run, ms));
}

export function clearPageTimers(): void {
  for (const timer of timers) window.clearInterval(timer);
  timers.length = 0;
}

export type LayoutMode = 'phone' | 'tablet' | 'desk';

export function layoutMode(): LayoutMode {
  const width = window.innerWidth;
  if (width < 768) return 'phone';
  return width < 1200 ? 'tablet' : 'desk';
}
