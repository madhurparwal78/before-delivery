import { el } from '../dom';
import { emptyState } from '../components/tile';

export function renderNotFound(): HTMLElement {
  return el(
    'main',
    { class: 'screen' },
    el('h1', {}, 'Return not found'),
    emptyState("This return doesn't exist, or you don't have access to it."),
  );
}
