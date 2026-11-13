import { formatHundredths, numberHundredths } from "./numbers";

export function ordinal(place: number): string {
  const lastTwo = place % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${place}th`;
  return `${place}${["th", "st", "nd", "rd"][place % 10 > 3 ? 0 : place % 10]}`;
}

/** A figure with exactly two decimals, rounded half up. */
export function twoDecimals(value: number): string {
  return formatHundredths(numberHundredths(value));
}

export function utcDate(iso: string): string {
  return iso.slice(0, 10);
}

export function utcMinute(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function resultLine(speed: string, accuracy: string, raw: string, consistency: string): string {
  return `Speed ${speed}, accuracy ${accuracy}%, raw ${raw}, consistency ${consistency}%.`;
}

export const REFUSAL_REASONS: Readonly<Record<string, string>> = {
  wrong_text: "the text does not match this test.",
  impossible_interval: "keystrokes arrived faster than a person can type.",
  duration_mismatch: "the test length does not match its mode.",
  replay_mismatch: "the replay does not match the submitted result.",
  ticket_expired: "this test expired before it was submitted.",
  invalid_log: "the keystroke log is malformed.",
  log_too_long: "the keystroke log is too long.",
  ticket_not_found: "this test was not issued to you.",
};
