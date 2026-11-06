// The stylesheet of theme tokens and motion timings, generated from their single homes in src/shared.
import { ARRIVAL_MARK_MS, FADE_MS, PRESS_MS, QUIRE_CURVE_CSS } from '../shared/motion.ts';
import { tokenCss } from '../shared/tokens.ts';

export const TOKENS_CSS = [
  `:root, :root[data-theme="paper"] { ${tokenCss('paper')} }`,
  `:root[data-theme="lamplight"] { ${tokenCss('lamplight')} }`,
  `:root { --curve: ${QUIRE_CURVE_CSS}; --press-ms: ${PRESS_MS}ms; --fade-ms: ${FADE_MS}ms; --arrival-ms: ${ARRIVAL_MARK_MS}ms; }`,
].join('\n');
