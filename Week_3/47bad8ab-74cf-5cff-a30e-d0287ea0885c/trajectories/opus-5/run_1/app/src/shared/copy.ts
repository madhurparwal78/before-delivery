import { directionLabel, type Direction } from './grid';
import { formatDate, formatTime, joinList, revealedPhrase, squareCountPhrase } from './text';
import type { OpScope } from './types';

export const copy = {
  heroInk: 'Solve one grid with friends in other rooms, each with your own colour.',
  heroBrass: 'Upload a puzzle in plain text and send the link.',
  displayNameInvalid: 'Enter a name between 1 and 24 characters.',
  inProgress: (n: number): string => `In progress with ${n}`,
  noPuzzlesMatch: 'No puzzles match these filters.',
  nothingUploaded: 'Nothing uploaded yet.',
  uploadPending: 'Checking your puzzle',
  uploadReady: (title: string): string => `Puzzle ready: ${title}`,
  uploadProblems: (n: number): string =>
    n === 1 ? 'This puzzle has 1 problem.' : `This puzzle has ${n} problems.`,
  uploadTooLarge: (limit: number): string => `This file is larger than ${limit} bytes.`,
  storageOutageUpload:
    'Puzzle storage is unreachable right now. Your text is still here; try again in a moment.',
  storageOutage: 'Puzzle storage is unreachable right now. Try again in a moment.',
  storageOutageBuilder:
    'Puzzle storage is unreachable right now. Your grid is still here; try again in a moment.',
  linkCopied: 'Link copied',
  linkTurnedOff: 'Link turned off',
  linkReplaced: 'New link ready',
  deadLinkOff: 'This game link was turned off.',
  deadLinkReplaced: 'This game link was replaced. Ask the host for the new one.',
  unknownGame: 'This game does not exist or is not shared with you.',
  gameFull: 'Game is full.',
  alreadySolved: 'This puzzle is already solved.',
  squareLocked: 'That square is locked.',
  rateLimited: 'Slow down a little.',
  connectionLost: 'Connection lost. Reconnecting.',
  clueChanged: (number: number, direction: Direction, text: string, length: number): string =>
    `${number} ${directionLabel(direction)}: ${text}. ${length} letters.`,
  linkedTo: (refs: { number: number; direction: Direction }[]): string =>
    `Linked to ${joinList(refs.map((r) => `${r.number} ${directionLabel(r.direction)}`))}.`,
  checkResult: (wrong: number, scope: OpScope): string =>
    wrong === 0 ? `No errors in this ${scope}` : `${wrong} wrong in this ${scope}`,
  revealResult: revealedPhrase,
  clearResult: (cleared: number): string =>
    cleared === 0 ? 'Nothing to clear' : `Cleared ${squareCountPhrase(cleared)}`,
  playerJoined: (name: string): string => `${name} joined`,
  playerLeft: (name: string): string => `${name} left`,
  solvedAnnouncement: (elapsedMs: number): string => `Puzzle solved in ${formatTime(elapsedMs)}`,
  solvedHeading: (elapsedMs: number): string => `Solved in ${formatTime(elapsedMs)}`,
  solvedLine: (revealed: number): string =>
    revealed > 0 ? revealedPhrase(revealed) : 'No squares revealed',
  historyRow: (title: string, elapsedMs: number, solvedAt: string): string =>
    `${title} · ${formatTime(elapsedMs)} · ${formatDate(solvedAt)}`,
  recordPending: 'Solve record pending',
  historyEmpty: 'No finished games yet.',
  replayStep: (k: number, n: number): string => `Step ${k} of ${n}`,
  pageNotFound: 'Page not found.',
  clearPuzzleQuestion: 'Clear every unlocked square?',
  teamScores: (a: number, b: number): string => `Team 1 ${a} · Team 2 ${b}`,
  raceNotStarted: 'The race has not started.',
  raceOverHeading: (a: number, b: number): string => {
    if (a > b) return `Team 1 wins ${a} to ${b}`;
    if (b > a) return `Team 2 wins ${b} to ${a}`;
    return `Tie at ${a}`;
  },
  raceScoreRow: (name: string, team: 1 | 2, score: number): string =>
    `${name} · Team ${team} · ${score}`,
  solveStatsRow: (name: string, letters: number, revealed: number): string =>
    `${name} · ${letters} letters · ${revealed} revealed`,
  replayStart: 'Start',
  replayCell: (name: string, value: string, pencil: boolean, row: number, col: number): string => {
    if (value === '') return `${name} cleared row ${row + 1}, column ${col + 1}`;
    const verb = pencil ? 'pencilled' : 'wrote';
    return `${name} ${verb} ${value} in row ${row + 1}, column ${col + 1}`;
  },
  replayCheck: (name: string, scope: OpScope, wrong: number): string =>
    `${name} checked the ${scope}: ${wrong} wrong`,
  replayReveal: (name: string, scope: OpScope, count: number): string =>
    `${name} revealed the ${scope}: ${squareCountPhrase(count)}`,
  replayClear: (name: string, scope: OpScope, count: number): string =>
    `${name} cleared the ${scope}: ${squareCountPhrase(count)}`,
  builderReady: 'Ready to save',
  builderProblems: (n: number): string => (n === 1 ? '1 problem' : `${n} problems`),
  builderSaved: (title: string): string => `Saved: ${title}`,
};
