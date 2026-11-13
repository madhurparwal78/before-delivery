import type { ApiFailure } from './api';

export const copy = {
  signingIn: 'Signing in…',
  creatingAccount: 'Creating your account…',
  invalidCredentials: "That email and password don't match.",
  emailTaken: 'An account already uses that email.',
  creatingDeck: 'Creating deck…',
  deckCreated: 'Deck created',
  openingRoom: 'Opening room…',
  emptyDeck: 'Add a question before opening a room.',
  saving: 'Saving…',
  saved: 'Saved',
  versionConflict: 'A newer version was saved elsewhere. Reload to see it.',
  uploadingPicture: 'Uploading picture…',
  pictureAttached: 'Picture attached',
  unsupportedType: "That file isn't a PNG, JPEG or WebP picture.",
  imageTooLarge: 'That picture is too large for a question.',
  emptyFile: 'That file is empty.',
  imageStoreUnavailable: 'Picture storage is down. The question is saved without a picture.',
  removingPicture: 'Removing picture…',
  pictureRemoved: 'Picture removed',
  joining: 'Joining…',
  roomNotFound: 'No live room has that PIN.',
  nicknameTaken: 'That nickname is taken in this room.',
  roomFull: 'This room is full.',
  roomClosed: 'This night has reached the podium. Joining is closed.',
  sending: 'Sending…',
  lockedIn: 'Locked in',
  alreadyAnswered: 'Already answered — your first answer stands.',
  lockedEarly: 'Too late — the quizmaster locked this question.',
  clientSuperseded: 'This seat is now open on another screen.',
  roomEnded: 'The night is over. Thanks for playing.',
  timesUp: "Time's up",
  answersAreIn: 'Answers are in',
  leaderboardOnScreen: 'Leaderboard is on the big screen',
  podiumTime: 'Podium time — watch the big screen',
  stepUnavailable: "That step isn't available right now.",
  idleEnded: 'Night ended because the room sat empty.',
  reconnecting: 'Reconnecting…',
  backOnLive: 'Back on the live link',
  backupLink: 'Backup link: live updates are down. Answers still count.',
  pictureUnavailable: 'Picture unavailable',
  loadingNights: 'Loading nights…',
  noNights: 'No nights yet.',
  endDialogBody: "Everyone's seat closes and the night moves to Past nights.",
  correctAnswerSuffix: ' ✓ Correct answer',
  somethingWentWrong: 'Something went wrong. Try again.',
} as const;

function lateMessage(remainingMs: number | null): string {
  if (remainingMs !== null && remainingMs < 0) {
    return `Too late — the server got it ${Math.abs(remainingMs)} ms after the bell.`;
  }
  return copy.lockedEarly;
}

export function answerFailureMessage(failure: ApiFailure): string {
  if (failure.code === 'window_closed') return lateMessage(failure.remainingMs);
  if (failure.code === 'already_answered') return copy.alreadyAnswered;
  if (failure.code === 'client_superseded') return copy.clientSuperseded;
  if (failure.code === 'room_ended') return copy.roomEnded;
  return copy.somethingWentWrong;
}

export function pictureFailureMessage(failure: ApiFailure): string {
  if (failure.code === 'unsupported_type') return copy.unsupportedType;
  if (failure.code === 'image_too_large') return copy.imageTooLarge;
  if (failure.code === 'empty_file') return copy.emptyFile;
  if (failure.code === 'image_store_unavailable') return copy.imageStoreUnavailable;
  if (failure.code === 'validation_failed') return copy.somethingWentWrong;
  return copy.somethingWentWrong;
}

export function joinFailureMessage(failure: ApiFailure): string {
  if (failure.code === 'room_not_found') return copy.roomNotFound;
  if (failure.code === 'nickname_taken') return copy.nicknameTaken;
  if (failure.code === 'room_full') return copy.roomFull;
  if (failure.code === 'room_closed') return copy.roomClosed;
  if (failure.code === 'validation_failed') return '';
  return copy.somethingWentWrong;
}

export function saveFailureMessage(failure: ApiFailure): string {
  if (failure.code === 'version_conflict') return copy.versionConflict;
  if (failure.code === 'validation_failed') return '';
  return copy.somethingWentWrong;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatNightDate(endedAt: number): string {
  const date = new Date(endedAt);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

export function tallyMark(position: number): string {
  return '|'.repeat(position + 1);
}

export function sharePercent(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.floor((count / total) * 100 + 0.5);
}
