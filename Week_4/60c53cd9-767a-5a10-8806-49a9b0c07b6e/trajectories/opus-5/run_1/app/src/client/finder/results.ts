/** The Results pane: price-ordered rows, the live count, paging and the empty state. */

import { clear, el } from '../dom';
import { money, unitFacts } from '../display';
import { STATUS_LABELS, type DisplayStatus } from '../../shared/labels';
import type { PublicUnit } from '../../shared/types';

export interface RowStatus {
  status: DisplayStatus;
  syncing: boolean;
}

export interface ResultsOptions {
  onPin: (code: string, row: HTMLElement) => void;
  onShowMore: () => void;
}

export class ResultsPane {
  readonly node: HTMLElement;
  private readonly count: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly showMore: HTMLButtonElement;
  private readonly rows = new Map<string, { item: HTMLElement; button: HTMLButtonElement; unit: PublicUnit }>();
  private current: string | null = null;

  constructor(private readonly options: ResultsOptions) {
    this.count = el('p', { class: 'result-count', role: 'status', 'aria-live': 'polite', 'aria-label': 'Result count' });
    this.list = el('ul', { class: 'homes', role: 'list', 'aria-label': 'Homes' });
    this.empty = el('div', { class: 'empty-state', hidden: true }, [
      el('p', { class: 'giant-crop', text: 'NOTHING HERE' }),
      el('p', { class: 'empty-hint', text: 'No homes match these filters. Clear a filter to see more.' }),
    ]);
    this.showMore = el('button', {
      type: 'button',
      class: 'action action-quiet show-more',
      text: 'Show more homes',
      hidden: true,
      onclick: () => this.options.onShowMore(),
    }) as HTMLButtonElement;
    this.node = el('section', { class: 'results-pane', role: 'region', 'aria-label': 'Results' }, [
      this.count,
      this.empty,
      this.list,
      this.showMore,
    ]);
  }

  setBusy(busy: boolean): void {
    this.node.setAttribute('aria-busy', String(busy));
  }

  setCount(total: number): void {
    this.count.textContent = total === 1 ? '1 home matches' : `${total} homes match`;
  }

  setPage(hits: PublicUnit[], total: number, nextCursor: string | null): void {
    clear(this.list);
    this.rows.clear();
    this.current = null;
    for (const unit of hits) this.addRow(unit);
    this.setCount(total);
    this.empty.hidden = total !== 0;
    this.list.hidden = total === 0;
    this.showMore.hidden = nextCursor === null;
    this.showMore.disabled = false;
  }

  /** Appends a page, updating rows already listed instead of repeating them. */
  appendPage(hits: PublicUnit[], total: number, nextCursor: string | null): HTMLElement[] {
    const appended: HTMLElement[] = [];
    for (const unit of hits) {
      const existing = this.rows.get(unit.code);
      if (existing) {
        existing.unit = unit;
        this.paintRow(unit.code);
        continue;
      }
      appended.push(this.addRow(unit));
    }
    this.setCount(total);
    this.showMore.hidden = nextCursor === null;
    this.showMore.disabled = false;
    return appended;
  }

  private addRow(unit: PublicUnit): HTMLElement {
    const button = el('button', { type: 'button', class: 'home-row' }) as HTMLButtonElement;
    const item = el('li', { class: 'home-item' }, [button]);
    button.addEventListener('click', () => this.options.onPin(unit.code, button));
    this.rows.set(unit.code, { item, button, unit });
    this.list.append(item);
    this.paintRow(unit.code);
    return item;
  }

  private paintRow(code: string): void {
    const row = this.rows.get(code);
    if (!row) return;
    const unit = row.unit;
    const status = (row.button.dataset.status as DisplayStatus) ?? unit.status;
    const syncing = row.button.dataset.syncing === 'true' || unit.syncing;
    clear(row.button);
    row.button.append(
      el('span', { class: 'row-code', text: unit.code }),
      el('span', { class: 'row-status', text: STATUS_LABELS[status] }),
      ...(syncing ? [el('span', { class: 'tag-syncing', text: 'Syncing' })] : []),
      el('span', { class: 'row-price', text: `$${money(unit.price)}` }),
      ...unitFacts(unit).map((fact) => el('span', { class: 'row-fact', text: fact })),
    );
  }

  /** Background re-reads update statuses and Syncing tags in place. */
  updateStatuses(lookup: (code: string) => RowStatus | null): void {
    for (const [code, row] of this.rows) {
      const next = lookup(code);
      if (!next) continue;
      row.button.dataset.status = next.status;
      row.button.dataset.syncing = String(next.syncing);
      this.paintRow(code);
    }
  }

  updateUnit(unit: PublicUnit): void {
    const row = this.rows.get(unit.code);
    if (!row) return;
    row.unit = unit;
    this.paintRow(unit.code);
  }

  setCurrent(code: string | null, scrollIntoView: boolean): void {
    if (this.current === code) {
      if (code && scrollIntoView) this.scrollTo(code);
      return;
    }
    this.current = code;
    for (const [rowCode, row] of this.rows) {
      const isCurrent = rowCode === code;
      row.item.toggleAttribute('aria-current', false);
      if (isCurrent) {
        row.item.setAttribute('aria-current', 'true');
        row.button.setAttribute('aria-current', 'true');
      } else {
        row.item.removeAttribute('aria-current');
        row.button.removeAttribute('aria-current');
      }
    }
    if (code && scrollIntoView) this.scrollTo(code);
  }

  private scrollTo(code: string): void {
    const row = this.rows.get(code);
    if (!row) return;
    const list = this.list;
    const itemTop = row.item.offsetTop;
    const itemBottom = itemTop + row.item.offsetHeight;
    if (itemTop < list.scrollTop || itemBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = itemTop - list.clientHeight / 2 + row.item.offsetHeight / 2;
    }
  }

  codes(): string[] {
    return [...this.rows.keys()];
  }

  unitFor(code: string): PublicUnit | null {
    return this.rows.get(code)?.unit ?? null;
  }

  rowButton(code: string): HTMLButtonElement | null {
    return this.rows.get(code)?.button ?? null;
  }

  setShowMoreBusy(busy: boolean): void {
    this.showMore.disabled = busy;
  }

  showMoreVisible(): boolean {
    return !this.showMore.hidden;
  }
}
