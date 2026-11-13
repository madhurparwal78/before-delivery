/** Every published string, character for character. */

import type { ChainFigures } from './types.js';

export function mmss(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function mss(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** `YYYY-MM-DD HH:MM` in UTC. */
export function utcStamp(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  );
}

export const figures = {
  solved: (stats: ChainFigures) => `${stats.solved} of ${stats.total} solved`,
  run: (stats: ChainFigures) => `Longest run ${stats.longestRun}`,
  props: (stats: ChainFigures) => (stats.props === 1 ? '1 prop' : `${stats.props} props`),
  card: (stats: ChainFigures) =>
    `${figures.solved(stats)} · ${figures.run(stats)} · ${figures.props(stats)}`,
};

export const copy = {
  uploadPending: (fileName: string) => `Uploading ${fileName}...`,
  uploadSuccess: (propName: string) => `${propName} is in the library.`,
  uploadFailure: 'Upload failed. Nothing was added.',
  freezePending: 'Freezing version...',
  freezeSuccess: (number: number) => `Version ${number} frozen.`,
  freezeFailure: 'Freeze failed. Nothing was saved. Try again.',
  propHeld: (displayName: string) => `${displayName} is holding this prop.`,
  nodeHeld: (displayName: string) => `${displayName} is holding this node.`,
  staleVersion: 'Someone saved a newer change. Your view has been refreshed.',
  roomBusy: 'Another playtest is running in this room.',
  playtestRunning: 'This room is in a playtest. Edits resume when it ends.',
  playtestStarted: 'Playtest running.',
  linkCopied: 'Link copied.',
  linkRegenerated: 'New link made. The old link no longer works.',
  linkRevoked: 'Link revoked.',
  inviteSent: (email: string) => `Invite sent to ${email}.`,
  inviteQueued: (email: string) => `Invite to ${email} is queued.`,
  inviteFailed: (email: string) => `Invite to ${email} failed.`,
  placementDeleted: (label: string, displayName: string) =>
    `${label} was deleted by ${displayName}. Your change was not saved.`,
  tookOver: (label: string) => `You now hold ${label}.`,
  takenOver: (displayName: string, label: string) => `${displayName} took over ${label}.`,
  undoDone: (field: string, label: string) => `Undid your ${field} change on ${label}.`,
  undoDeleted: (label: string, displayName: string) =>
    `Can't undo: ${label} was deleted by ${displayName}.`,
  nothingToUndo: 'Nothing to undo.',
  sceneMovedAbove: (moved: string, passed: string) => `Moved ${moved} above ${passed}.`,
  sceneMovedBelow: (moved: string, passed: string) => `Moved ${moved} below ${passed}.`,
  restoreDone: (number: number, revision: number) => `Restored v${number} as change ${revision}.`,

  connectionSaved: 'All changes saved.',
  connectionSaving: 'Saving...',
  connectionOffline: (n: number) =>
    n === 1 ? 'Offline. 1 change waiting to save.' : `Offline. ${n} changes waiting to save.`,

  propLockedDialog: (holder: string, label: string) => `${holder} is editing ${label}.`,
  needsLive: 'Needs the live service.',

  liveDown: 'Live editing is paused. Solo editing still works.',
  storageDown: "Prop storage is unavailable. Uploads and freezing resume when it's back.",

  playtestEnded: 'Playtest ended',
  outcomeEscaped: (seconds: number) => `Escaped in ${mmss(seconds)}`,
  outcomeTimedOut: 'Out of time',
  outcomeStopped: (seconds: number) => `Stopped at ${mmss(seconds)}`,
  lobby: 'Waiting for the game master to start.',
  scheduled: (startsAt: string) => `This playtest starts ${utcStamp(startsAt)} UTC.`,
  hintReceived: (text: string) => `Hint: ${text}`,
  solveSuccess: (title: string) => `${title} solved.`,
  wrongAnswer: "That's not it.",
  prerequisitesUnsolved: 'Something else has to happen first.',

  nextHintIn: (seconds: number) => `Next hint in ${mss(seconds)}`,
  hintReady: 'Hint ready',

  inviteExpired: 'This playtest invite has expired.',
  linkInvalid: "This link isn't valid.",
  supersededPack: (number: number) => `This version has been superseded by version ${number}.`,
  emptyLibrary: 'No props yet. Upload a glTF file to start the library.',
  emptyRoom: 'This room is empty. Add a primitive or place a prop.',
  noWebgl: '3D view unavailable on this device. Showing the floor plan.',
  signInFailure: "That email and password don't match.",
  emailTaken: 'That email already has a bench.',

  debriefEmail: (status: string) => `Debrief email: ${status}`,
  emailStatusWord: (status: 'sent' | 'queued' | 'failed') =>
    status === 'sent' ? 'Sent' : status === 'queued' ? 'Queued' : 'Failed',
  versionStateWord: (state: 'frozen' | 'superseded') =>
    state === 'frozen' ? 'Frozen' : 'Superseded',
};

export const commandNames = [
  'Start playtest',
  'Freeze version...',
  'Restore version...',
  'Open Versions',
  'Open Prop library',
  'Open Trigger graph',
  'Keyboard shortcuts',
] as const;

export type CommandName = (typeof commandNames)[number];
