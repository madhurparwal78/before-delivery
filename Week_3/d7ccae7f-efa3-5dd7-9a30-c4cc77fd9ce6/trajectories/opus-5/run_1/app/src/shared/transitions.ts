import type { HostCommand, RoomState } from './protocol.js';

export interface RoomPosition {
  state: RoomState;
  questionIndex: number | null;
  questionCount: number;
}

export type Transition =
  | { ok: true; to: RoomState; questionIndex: number | null }
  | { ok: false; reason: 'illegal_transition' | 'no_more_questions' };

const COMMANDS: HostCommand[] = [
  'open_question',
  'lock',
  'reveal',
  'show_leaderboard',
  'show_podium',
  'end',
];

export function isHostCommand(value: unknown): value is HostCommand {
  return typeof value === 'string' && COMMANDS.some((command) => command === value);
}

/** The only legal room transitions. Every state change is decided here. */
export function applyCommand(position: RoomPosition, command: HostCommand): Transition {
  const { state, questionIndex, questionCount } = position;
  switch (command) {
    case 'open_question':
      if (state === 'lobby') return { ok: true, to: 'question_open', questionIndex: 1 };
      if (state === 'leaderboard') {
        const next = (questionIndex ?? 0) + 1;
        if (next > questionCount) return { ok: false, reason: 'no_more_questions' };
        return { ok: true, to: 'question_open', questionIndex: next };
      }
      return { ok: false, reason: 'illegal_transition' };
    case 'lock':
      return state === 'question_open'
        ? { ok: true, to: 'locked', questionIndex }
        : { ok: false, reason: 'illegal_transition' };
    case 'reveal':
      return state === 'locked'
        ? { ok: true, to: 'reveal', questionIndex }
        : { ok: false, reason: 'illegal_transition' };
    case 'show_leaderboard':
      return state === 'reveal'
        ? { ok: true, to: 'leaderboard', questionIndex }
        : { ok: false, reason: 'illegal_transition' };
    case 'show_podium':
      return state === 'leaderboard'
        ? { ok: true, to: 'podium', questionIndex }
        : { ok: false, reason: 'illegal_transition' };
    case 'end':
      return state === 'podium'
        ? { ok: true, to: 'ended', questionIndex }
        : { ok: false, reason: 'illegal_transition' };
  }
}

export function commandIsLegal(position: RoomPosition, command: HostCommand): boolean {
  return applyCommand(position, command).ok;
}
