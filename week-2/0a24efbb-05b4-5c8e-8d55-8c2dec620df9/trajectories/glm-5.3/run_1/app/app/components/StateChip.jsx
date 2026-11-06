import { STATE_GLYPH, STATE_LABEL } from './icons.jsx';

export function StateChip({ state, animate }) {
  const Glyph = STATE_GLYPH[state] || STATE_GLYPH.pending;
  return (
    <span className={`chip chip-${state}${animate ? ' chip-settle' : ''}`}>
      <Glyph className="chip-glyph" />
      <span>{STATE_LABEL[state] || state}</span>
    </span>
  );
}
