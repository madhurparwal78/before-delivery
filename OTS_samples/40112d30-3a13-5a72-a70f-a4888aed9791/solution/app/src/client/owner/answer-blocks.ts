import type { ResponseView } from '../../shared/types.ts';
import { h } from '../lib/dom.ts';

// One block per stored answer in the edition's order: its label, its text, a note for the owner,
// and `Download <name>` where the answer is a stored file.

export function answerBlocks(view: ResponseView): HTMLElement {
  return h('dl', { class: 'answers' }, view.items.map((item) => {
    const file = view.files.find((candidate) => candidate.key === item.key);
    return h('div', { class: 'answer' },
      h('dt', {}, item.label),
      h('dd', {}, file ? h('a', { href: file.url }, `Download ${file.name}`) : item.text),
      item.note ? h('dd', { class: 'note' }, `Internal note: ${item.note}`) : null);
  }));
}
