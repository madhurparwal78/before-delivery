import type { Extra } from '../../shared/wire.js';

export type KeyAction =
  | { type: 'digit'; value: number }
  | { type: 'extra'; extra: Exclude<Extra, 'none'> }
  | { type: 'wicket' }
  | { type: 'undo' }
  | { type: 'retire' }
  | { type: 'escape' };

const EXTRA_KEYS: Record<string, Exclude<Extra, 'none'>> = { d: 'wide', n: 'no-ball', b: 'bye', l: 'leg-bye' };

/** The scoring key a keydown is, or null: 0-6, D N B L, W, U, R and Escape, letters in either case. */
export const actionOf = (event: KeyboardEvent): KeyAction | null => {
  if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return null;
  const key = event.key.toLowerCase();
  if (/^[0-6]$/.test(key)) return { type: 'digit', value: Number(key) };
  const extra = EXTRA_KEYS[key];
  if (extra) return { type: 'extra', extra };
  if (key === 'w') return { type: 'wicket' };
  if (key === 'u') return { type: 'undo' };
  if (key === 'r') return { type: 'retire' };
  if (key === 'escape') return { type: 'escape' };
  return null;
};

/** Keys typed into a text field, a select or an open dialog belong to that control, not to the pad. */
export const belongsToControl = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.closest('input, textarea, select, [contenteditable="true"], dialog[open]') !== null);
