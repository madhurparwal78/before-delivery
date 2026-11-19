import type { PenSummary } from '../../shared/api';
import { copy } from '../../shared/copy';
import { h } from '../dom';
import { formatDate } from '../format';
import type { PreviewHost } from '../preview';

export interface RowOptions {
  showOwner?: boolean;
  preview?: PreviewHost;
  trailing?: (pen: PenSummary) => Node[];
}

/** Typeset rows: title in ink, tags in muted ink, tabular updated and like figures. */
export const penRow = (pen: PenSummary, options: RowOptions = {}): HTMLLIElement => {
  const link = h('a', { href: `/pen/${pen.id}`, class: 'row-title', text: pen.title });
  const row = h('li', { class: 'row' }, [
    link,
    options.showOwner ? h('span', { class: 'muted handle', text: pen.owner }) : null,
    h('span', { class: 'muted tags', text: pen.tags.join(' ') }),
    h('span', { class: 'figures' }, [
      h('span', { class: 'tabular', text: copy.versionLabel(pen.head) }),
      h('span', { class: 'muted tabular', text: `Updated ${formatDate(pen.updated_at)}` }),
      h('span', { class: 'muted tabular likes', text: copy.likes(pen.likes) }),
    ]),
    ...(options.trailing ? options.trailing(pen) : []),
  ]);

  if (options.preview && pen.head > 0) {
    const show = (): void => void options.preview!.show({ penId: pen.id }).catch(() => undefined);
    link.addEventListener('focus', show);
    row.addEventListener('mouseenter', show);
  }
  return row;
};

export const penList = (name: string, pens: PenSummary[], options: RowOptions = {}): HTMLElement =>
  h(
    'ul',
    { class: 'rows', 'aria-label': name },
    pens.map((pen) => penRow(pen, options)),
  );

export const panel = (text: string): HTMLElement =>
  h('div', { class: 'panel panel-empty' }, [h('p', { text })]);
