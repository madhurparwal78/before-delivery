import { ApiError, type SquadPlayer } from './api';
import { formatMillions } from '../shared/format';
import { POSITION_LABELS, type Position } from '../shared/domain';
import type { Screen } from './screens';

export function shortName(name: string): string {
  const parts = name.split(' ');
  const given = parts[0];
  const family = parts.slice(1).join(' ');
  if (family === '') return given;
  return family;
}

export function shirtLabel(player: SquadPlayer, live: boolean): string {
  const suffix = player.captain ? ', captain' : player.vice_captain ? ', vice-captain' : '';
  const figure = live ? `${player.team_points}` : formatMillions(player.price_tenths);
  return `${player.name}, ${POSITION_LABELS[player.position]}, ${figure} points${suffix}`;
}

export function playersQuery(screen: Screen): string {
  if (screen.name !== 'transfers') return '';
  const params = new URLSearchParams();
  if (screen.position !== 'All') params.set('position', screen.position);
  if (screen.club !== 'All') params.set('club', screen.club);
  if (screen.maxPrice !== 'Any') params.set('max_price', screen.maxPrice);
  params.set('sort', screen.sort);
  return `?${params.toString()}`;
}

export function deadlineCopy(error: ApiError): string | null {
  if (error.status === 409 && (error.body.error === 'gameweek_locked' || error.body.error === 'deadline_passed')) {
    return error.body.message ?? null;
  }
  return null;
}

export function rulesMessages(error: ApiError): { code: string; message: string }[] {
  return error.body.rules ?? [];
}

export function fieldMessages(error: ApiError): Record<string, string> {
  return error.body.fields ?? {};
}
