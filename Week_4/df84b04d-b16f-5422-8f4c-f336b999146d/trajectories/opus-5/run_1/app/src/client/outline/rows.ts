import { formatDate } from '../../shared/dates.js';
import { splitRuns } from '../../shared/tags.js';
import type { Bullet } from '../../shared/types.js';
import { displayText } from '../../shared/types.js';
import { clear, el } from '../dom.js';
import { nodeName, type Node } from './model.js';

/** Writes a row's text: the stored text while editing, chips when at rest. */
export function renderRowText(target: HTMLElement, bullet: Bullet, raw: boolean): void {
  clear(target);
  if (bullet.placeholder) {
    target.append(document.createTextNode('This bullet was deleted.'));
    return;
  }
  if (raw) {
    target.append(document.createTextNode(bullet.text));
    return;
  }
  for (const run of splitRuns(bullet.text)) {
    if (run.kind === 'plain') {
      target.append(document.createTextNode(run.value));
      continue;
    }
    const label = run.kind === 'date' ? formatDate(run.value) : run.value;
    target.append(el('span', { class: `chip chip-${run.kind}` }, [label]));
  }
}

export interface RowParts {
  item: HTMLLIElement;
  row: HTMLElement;
  text: HTMLElement;
  group: HTMLUListElement;
}

/** Builds one treeitem with its dot, disclosure, text and group of children. */
export function renderRow(node: Node, searchState: 'match' | 'context' | null): RowParts {
  const bullet = node.bullet;
  const name = nodeName(bullet);
  const short = displayText(bullet);
  const item = el('li', {
    role: 'treeitem',
    class: 'row-item',
    tabindex: '-1',
    'aria-label': name,
    'aria-level': node.level,
    'aria-selected': 'false',
    'data-bullet-id': bullet.id,
    'data-key': node.key,
    'data-depth': bullet.depth,
    'data-collapsed': bullet.collapsed ? 'true' : 'false',
    'data-completed': bullet.completed ? 'true' : 'false'
  });
  if (bullet.childCount > 0) item.setAttribute('aria-expanded', bullet.collapsed ? 'false' : 'true');
  if (bullet.mirrorOf !== null) item.setAttribute('data-mirror-of', bullet.mirrorOf);
  if (searchState !== null) item.setAttribute('data-search', searchState);

  const disclosure = el('button', {
    type: 'button',
    class: 'disclosure',
    'aria-label': `Toggle children of ${short}`,
    'aria-expanded': bullet.collapsed ? 'false' : 'true'
  });
  disclosure.append(
    el('span', { class: 'chevron', 'aria-hidden': 'true' })
  );

  const dot = el('a', {
    class: 'bullet-dot',
    href: `/b/${bullet.id}`,
    'aria-label': `Zoom into ${short}`
  });

  const text = el('div', {
    role: 'textbox',
    class: 'bullet-text',
    'aria-label': 'Bullet text',
    contenteditable: bullet.placeholder ? 'false' : 'plaintext-only',
    spellcheck: 'false'
  });
  if (bullet.placeholder) text.setAttribute('aria-readonly', 'true');
  renderRowText(text, bullet, false);

  const row = el('div', { class: 'row' }, [
    bullet.childCount > 0 ? disclosure : el('span', { class: 'disclosure-space', 'aria-hidden': 'true' }),
    dot,
    text
  ]);
  if (bullet.childCount > 0) row.classList.add('has-children');
  const group = el('ul', { role: 'group', class: 'children' });
  item.append(row, group);
  return { item, row, text, group };
}
