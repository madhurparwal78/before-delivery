// The match feed: one line per server event, in the published copy.

import { RoomEvent, RoomState } from './api';
import { formatLap } from './core';

/** feedLine renders one server event as its match-feed line, or nothing when
 *  the event has no line of its own. */
export function feedLine(event: RoomEvent, state: RoomState): string | null {
  const callsign = (id: unknown): string =>
    state.players.find((player) => player.id === id)?.callsign ?? String(event.callsign ?? '');

  switch (event.type) {
    case 'explosion':
      return String(event.source ?? '').startsWith('grenade:') ? 'Grenade detonated' : null;
    case 'player_down':
      return `${callsign(event.player)} is down`;
    case 'player_revived':
      return `${callsign(event.player)} revived`;
    case 'player_out':
      return `${callsign(event.player)} is out`;
    case 'player_respawned':
      return `${callsign(event.player)} is back`;
    case 'host_changed':
      return `${callsign(event.host)} is now host`;
    case 'wave_cleared':
      return event.wave === 4 ? 'Boss wave cleared' : `Wave ${event.wave} cleared`;
    case 'lap':
      return `Lap ${event.lap}: ${formatLap(event.lap_ms as number)}`;
    case 'wrecked':
      return `Wrecked — resetting at checkpoint ${event.checkpoint}`;
    case 'reset':
      return 'Reset';
    case 'phase':
      return phaseLine(event);
    default:
      return null;
  }
}

function phaseLine(event: RoomEvent): string | null {
  switch (event.phase) {
    case 'intermission': {
      const seconds = Math.floor(Number(event.remaining_ms ?? 0) / 1000);
      const next = Number(event.next_wave ?? 0);
      return next === 4
        ? `Intermission — ${seconds} s to boss wave`
        : `Intermission — ${seconds} s to wave ${next}`;
    }
    case 'boss_wave':
      return 'Boss wave';
    case 'over':
      if (event.result === 'victory') return 'Victory';
      if (event.result === 'defeat') return 'Defeat';
      return null;
    default:
      return null;
  }
}

/** shotRejection renders a refused shot's feed line. */
export function shotRejection(reason: string | null): string | null {
  switch (reason) {
    case 'fire_interval':
      return 'Too fast';
    case 'reloading':
      return 'Reloading';
    case 'empty':
      return 'Empty — reload';
    default:
      return null;
  }
}
