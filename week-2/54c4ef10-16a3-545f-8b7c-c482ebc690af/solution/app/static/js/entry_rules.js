// The shooting-log field rules, checked in the browser before anything is sent (same copy as the server).
import { APERTURES, LIMITS, MESSAGES, RANGES } from './domain.js';
import { parseEv, parseShutter } from './exposure.js';
import { characters } from './format.js';

/** Messages by field for a set of raw field values; an empty object when every field passes. */
export function entryProblems({ counter, aperture, shutter, metered_ev: ev, note }) {
  const problems = {};
  const number = counter.trim() === '' ? NaN : Number(counter);
  if (!(Number.isInteger(number) && number >= RANGES.counter[0] && number <= RANGES.counter[1])) problems.counter = MESSAGES.counter;
  if (!APERTURES.includes(aperture)) problems.aperture = MESSAGES.aperture;
  if (parseShutter(shutter.trim()) === null) problems.shutter = MESSAGES.shutter;
  if (parseEv(ev) === null) problems.metered_ev = MESSAGES.metered_ev;
  if (characters(note) > LIMITS.note) problems.note = MESSAGES.note;
  return problems;
}

/** The request body for a set of raw field values. */
export function entryBody({ counter, aperture, shutter, metered_ev: ev, note, misfire }) {
  return { counter: Number(counter), aperture, shutter: shutter.trim(), metered_ev: Number(ev), note: note.trim(), misfire };
}
