// The four counters and the state word, shown the same way everywhere.
import { el } from '../dom.js';

export function counterTexts(counters) {
  return [
    `Detected ${counters.detected}`,
    `Aligned ${counters.aligned}`,
    `Unexposed ${counters.unexposed}`,
    `Unmatched notes ${counters.unmatched_notes}`,
  ];
}

export function counterList(counters, extra = {}) {
  return el(
    'div',
    { class: 'counters figures', ...extra },
    counterTexts(counters).map((text) => el('span', { text })),
  );
}

export function stateWord(state) {
  return state.charAt(0).toUpperCase() + state.slice(1);
}
