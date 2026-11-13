// The outcome word of an event log row, with its tone.
import { html } from '../../lib/html.js';

const TONE = {
  Applied: 'ok',
  Replayed: 'ok',
  Dropped: 'warn',
  Suppressed: 'warn',
  Refused: 'bad',
  'Dead-lettered': 'bad',
};

export function OutcomeWord({ outcome }) {
  return html`<span class=${`tone tone-${TONE[outcome] ?? 'quiet'}`}>${outcome}</span>`;
}
