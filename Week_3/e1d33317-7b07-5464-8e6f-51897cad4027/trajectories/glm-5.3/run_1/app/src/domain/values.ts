/** Domain constants and small shared value rules for Fairline. */

export const STAFF_CAP = 64;
export const MEASURE_CAP = 2000;
export const NAME_STAFF_MAX = 40;
export const NAME_INVITE_MAX = 60;
export const TEXT_PLAIN_MAX = 200;
export const OPS_MIN = 1;
export const OPS_MAX = 50;
export const OPS_CATCHUP_LIMIT_MAX = 500;
export const OPS_CATCHUP_LIMIT_DEFAULT = 200;
export const HISTORY_PAGE_MIN = 1;
export const HISTORY_PAGE_MAX = 100;
export const HISTORY_PAGE_DEFAULT = 50;
export const SYSTEMS_MIN = 1;
export const SYSTEMS_MAX = 16;
export const SYSTEMS_DEFAULT = 8;
export const JSON_BODY_MAX = 262144;
export const BANK_BODY_MAX = 8000000;
export const BANK_NAME_MAX = 120;
export const SNAPSHOT_EVERY = 100;
export const THROTTLE_WINDOW_MS = 10000;
export const THROTTLE_MAX = 120;
export const SOCKET_PING_SECONDS = 10;
export const HEARTBEAT_SECONDS = 5;
export const PENDING_SYNC_SECONDS = 10;

export type Clef = 'treble' | 'alto' | 'tenor' | 'bass' | 'percussion';
export type Role = 'composer' | 'copyist' | 'player';
export type CollaboratorStatus = 'invited' | 'active' | 'removed';
export type DurationName = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd';
export type EventKind = 'note' | 'rest';
export type SetField = 'pitch' | 'duration' | 'dots' | 'tie' | 'dynamic' | 'dynamicPlacement' | 'text';
export type DynamicMark = 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'sfz' | 'fp';
export type PartStatus = 'draft' | 'engraving' | 'rendering' | 'ready' | 'pdf_pending';

export interface Pitch {
  step: string;
  alter: number;
  octave: number;
}

/** sounding pitch = written pitch + transpose. */
export interface Transpose {
  diatonic: number;
  chromatic: number;
}

export interface Stamp {
  lamport: number;
  site: string;
}

/** Insert-order rule: greater stamp first, ties by site text, greater first. */
export function compareStampsDesc(a: Stamp, b: Stamp): number {
  if (a.lamport !== b.lamport) return a.lamport > b.lamport ? -1 : 1;
  return a.site === b.site ? 0 : a.site > b.site ? -1 : 1;
}

export function stampKey(stamp: Stamp): string {
  return `${stamp.lamport}@${stamp.site}`;
}

export const DURATION_TICKS: Record<DurationName, number> = {
  whole: 1920,
  half: 960,
  quarter: 480,
  eighth: 240,
  '16th': 120,
  '32nd': 60,
};

export const DURATION_ORDER: DurationName[] = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd'];

export function durationTicks(duration: DurationName, dots: number): number {
  const base = DURATION_TICKS[duration];
  if (dots <= 0) return base;
  return dots === 1 ? base + base / 2 : base * 1.75;
}

export function beatsToTicks(beats: number, beatType: number): number {
  return beats * (1920 / beatType);
}

/** The ticks one measure holds under a time signature. */
export function measureTicks(beats: number, beatType: number): number {
  return beatsToTicks(beats, beatType);
}

export function isClef(value: unknown): value is Clef {
  return typeof value === 'string' && ['treble', 'alto', 'tenor', 'bass', 'percussion'].includes(value);
}

export function isDuration(value: unknown): value is DurationName {
  return typeof value === 'string' && value in DURATION_TICKS;
}

/** User-perceived character count, per the brief's counting rule. */
export function perceivedLength(text: string): number {
  return [...text.trim()].length;
}

export interface TimeSignature {
  measure: number;
  beats: number;
  beatType: number;
}

/** Beat (counted from 1 in the beat unit) for a tick offset inside a measure. */
export function tickToBeat(ticks: number, beatType: number): number {
  const unit = 1920 / beatType;
  const beat = ticks / unit + 1;
  const rounded = Math.round(beat * 1000) / 1000;
  return rounded;
}

export function formatBeat(beat: number): string {
  const s = beat.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
