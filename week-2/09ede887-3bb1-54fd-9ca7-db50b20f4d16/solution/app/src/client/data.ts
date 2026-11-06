import type { Session, Speaker, Stage } from '../shared/api';
import { apiPath, request } from './api';

// Reference data the pages share, read once per load.

export const FORMATS = [
  ['demo-qa', 'Demo + Q&A'],
  ['fireside', 'Fireside'],
  ['game', 'Game'],
  ['keynote', 'Keynote'],
  ['panel', 'Panel'],
  ['workshop', 'Workshop'],
] as const;

export const DAY_TABS: Record<1 | 2, string> = { 1: 'Day 1 - Sat, Oct 31', 2: 'Day 2 - Sun, Nov 1' };

// An instant inside each day, used to name the venue offset when a filtered day lists nothing.
export const DAY_NOON: Record<1 | 2, string> = { 1: '2026-10-31T16:00:00Z', 2: '2026-11-01T16:00:00Z' };

let stages: Stage[] | null = null;
let speakers: Speaker[] | null = null;

export function knownStages(): Stage[] | null {
  return stages;
}

export async function loadStages(): Promise<Stage[] | null> {
  if (stages) return stages;
  const result = await request<Stage[]>(apiPath('/stages'));
  if (result.ok) stages = result.data;
  return stages;
}

// Speakers are re-read on every call so a saved bio shows on the next read.
export async function loadSpeakers(): Promise<Speaker[] | null> {
  const result = await request<Speaker[]>(apiPath('/speakers'));
  if (result.ok) speakers = result.data;
  return result.ok ? result.data : speakers;
}

export async function loadSessions(token: string | null): Promise<Session[] | null> {
  const result = await request<Session[]>(apiPath('/sessions'), { token });
  return result.ok ? result.data : null;
}
