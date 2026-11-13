import type { Format } from '../shared/types';

const INK = 'var(--ink)';

/** A tall single-handled cup: single elimination. */
const cup = `
<svg viewBox="0 0 200 320" fill="none" stroke="${INK}" stroke-width="7" stroke-linejoin="round">
  <path d="M60 30 H140 L132 150 Q132 196 100 196 Q68 196 68 150 Z" fill="var(--object-fill)"/>
  <path d="M140 52 Q182 56 178 96 Q174 132 136 134"/>
  <path d="M100 196 V250"/>
  <path d="M62 290 H138 Q148 290 148 300 H52 Q52 290 62 290 Z" fill="var(--object-fill)"/>
  <path d="M74 250 H126 L132 290 H68 Z" fill="var(--object-fill)"/>
</svg>`;

/** A two-handled loving cup: double elimination. */
const lovingCup = `
<svg viewBox="0 0 240 320" fill="none" stroke="${INK}" stroke-width="7" stroke-linejoin="round">
  <path d="M74 40 H166 L156 160 Q156 206 120 206 Q84 206 84 160 Z" fill="var(--object-fill)"/>
  <path d="M166 62 Q214 66 210 108 Q206 146 162 148"/>
  <path d="M74 62 Q26 66 30 108 Q34 146 78 148"/>
  <path d="M120 206 V252"/>
  <path d="M92 252 H148 L154 292 H86 Z" fill="var(--object-fill)"/>
  <path d="M80 292 H160 Q170 292 170 302 H70 Q70 292 80 292 Z" fill="var(--object-fill)"/>
</svg>`;

/** A ring medal: round robin. */
const medal = `
<svg viewBox="0 0 220 320" fill="none" stroke="${INK}" stroke-width="7" stroke-linejoin="round">
  <path d="M70 24 L104 120" />
  <path d="M150 24 L116 120" />
  <circle cx="110" cy="206" r="86" fill="var(--object-fill)"/>
  <circle cx="110" cy="206" r="44"/>
</svg>`;

/** A stacked trio of counters: Swiss. */
const counters = `
<svg viewBox="0 0 260 320" fill="none" stroke="${INK}" stroke-width="7" stroke-linejoin="round">
  <ellipse cx="130" cy="246" rx="98" ry="38" fill="var(--object-fill)"/>
  <ellipse cx="130" cy="246" rx="44" ry="17"/>
  <ellipse cx="108" cy="166" rx="84" ry="33" fill="var(--object-fill)"/>
  <ellipse cx="108" cy="166" rx="38" ry="15"/>
  <ellipse cx="146" cy="92" rx="70" ry="28" fill="var(--object-fill)"/>
  <ellipse cx="146" cy="92" rx="32" ry="13"/>
</svg>`;

export const FORMAT_OBJECTS: Record<Format, { markup: string; label: string; fill: string; fact: string }> = {
  single_elimination: {
    markup: cup,
    label: 'Single elimination cup',
    fill: 'lilac',
    fact: 'One loss and you are out: the shortest night in the room.',
  },
  double_elimination: {
    markup: lovingCup,
    label: 'Double elimination loving cup',
    fill: 'lemon',
    fact: 'Everybody gets a second life, and the losers side can still take the cup.',
  },
  round_robin: {
    markup: medal,
    label: 'Round robin medal',
    fill: 'mint',
    fact: 'Everyone plays everyone once, so the table settles the argument.',
  },
  swiss: {
    markup: counters,
    label: 'Swiss counters',
    fill: 'lilac',
    fact: 'Equal points meet equal points, round after round, with no rematches.',
  },
};

export const trophyFor = (format: Format): string => FORMAT_OBJECTS[format].markup;
