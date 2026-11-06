import { STATE_WORDS } from '../../shared/constants.js';
import { Icon } from './Icon.jsx';

const GLYPHS = { pending: 'bar', approved: 'check', rejected: 'cross', cancelled: 'slash' };

/** A state reads as a shape, a word and a tone, so losing any one keeps it readable. */
export function StateChip({ state }) {
  return (
    <span className={`chip chip-${state}`}>
      <Icon name={GLYPHS[state]} size={14} />
      {STATE_WORDS[state]}
    </span>
  );
}
