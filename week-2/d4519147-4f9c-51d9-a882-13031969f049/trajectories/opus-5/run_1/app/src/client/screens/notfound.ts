import { COPY } from '../../shared/copy';
import { el } from '../dom';

export function renderNotFound(root: HTMLElement, kind: 'diagram' | 'page'): void {
  const heading = kind === 'diagram' ? COPY.diagramNotFoundHeading : COPY.pageNotFoundHeading;
  const text = kind === 'diagram' ? COPY.diagramNotFoundText : COPY.pageNotFoundText;
  root.replaceChildren(
    el('div', { class: 'page' }, [el('h1', { text: heading }), el('p', { text })]),
  );
}
