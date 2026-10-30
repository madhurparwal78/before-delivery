export interface PlanRitual {
  id: string;
  title: string;
  minutes: number;
}

export type ReminderState = 'on' | 'paused';

/** The published plan shape, shared by the API and the browser. */
export interface Plan {
  id: string;
  email: string;
  bedtime: string;
  time_zone: string;
  rituals: PlanRitual[];
  total_minutes: number;
  note: string;
  reminders: ReminderState;
  version: number;
  starts_at_local: string;
  next_reminder_at: string | null;
  share_url: string | null;
}

export interface SharedPlan {
  bedtime: string;
  time_zone: string;
  rituals: PlanRitual[];
  total_minutes: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    current?: Plan;
  };
}

/** Counts characters as a reader sees them, so one emoji or accented letter counts as 1. */
export function countCharacters(text: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let count = 0;
  for (const _ of segmenter.segment(text)) count += 1;
  return count;
}

/** The hour starts 60 minutes before bedtime on the wall clock, wrapping past midnight. */
export function startsAtLocal(bedtime: string): string {
  const [hours, minutes] = bedtime.split(':').map((part) => Number(part));
  const total = (hours! * 60 + minutes! - 60 + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
