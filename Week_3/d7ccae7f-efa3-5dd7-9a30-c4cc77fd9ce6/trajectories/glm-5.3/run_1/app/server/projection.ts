import type { RoomState } from './domain.ts';

const TRANSITIONS: Record<string, RoomState> = {
  'lobby:open_question': 'question_open',
  'leaderboard:open_question': 'question_open',
  'question_open:lock': 'locked',
  'locked:reveal': 'reveal',
  'reveal:show_leaderboard': 'leaderboard',
  'leaderboard:show_podium': 'podium',
  'podium:end': 'ended',
};

export function transitionFor(state: RoomState, command: string): RoomState | null {
  return TRANSITIONS[`${state}:${command}`] ?? null;
}

export function noMoreQuestions(
  state: RoomState,
  command: string,
  questionIndex: number | null,
  questionCount: number,
): boolean {
  return (
    state === 'leaderboard' &&
    command === 'open_question' &&
    (questionIndex === null || questionIndex >= questionCount)
  );
}
