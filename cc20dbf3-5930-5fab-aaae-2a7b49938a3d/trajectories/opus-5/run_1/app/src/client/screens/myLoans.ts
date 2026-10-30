import { ApiFailure, request } from '../api.js';
import type { Hold, HoldsPage, Loan, LoansPage } from '../../shared/api.js';
import { holdWord, loanWord, localTime, shortDate } from '../format.js';
import type { Screen } from '../shell.js';
import { announce, clear, element, liveRegion, markPending, region, sweep } from '../ui/dom.js';
import { statusChip } from '../ui/chips.js';

const PAGE_SIZE = 20;
const REFRESH_MS = 15_000;

function holdSort(left: Hold, right: Hold): number {
  if (left.created_at !== right.created_at) return left.created_at < right.created_at ? 1 : -1;
  return left.id < right.id ? 1 : -1;
}

function loanSort(left: Loan, right: Loan): number {
  if (left.checked_out_at !== right.checked_out_at) {
    return left.checked_out_at < right.checked_out_at ? 1 : -1;
  }
  return left.id < right.id ? 1 : -1;
}

export function myLoansScreen(): Screen {
  const status = liveRegion('My loans status');
  const holdList = element('ul', { class: 'rows' });
  const loanList = element('ul', { class: 'rows' });

  const moreHolds = element('button', { type: 'button', class: 'wide', hidden: true });
  moreHolds.textContent = 'Show more holds';
  const moreLoans = element('button', { type: 'button', class: 'wide', hidden: true });
  moreLoans.textContent = 'Show more loans';

  const holdsRegion = region('Holds', [element('h2', {}, ['Holds']), holdList, moreHolds]);
  const loansRegion = region('Loans', [element('h2', {}, ['Loans']), loanList, moreLoans]);
  holdsRegion.classList.add('span-5');
  loansRegion.classList.add('span-7');

  const node = element('div', {}, [
    element('h1', {}, ['My loans']),
    status,
    element('div', { class: 'grid' }, [holdsRegion, loansRegion]),
  ]);

  let holds: Hold[] = [];
  let loans: Loan[] = [];
  let holdCursor: string | null = null;
  let loanCursor: string | null = null;
  let timer: number | null = null;

  function holdRow(hold: Hold): HTMLElement {
    const word = holdWord(hold.status);
    const row = element('li', {
      'data-id': hold.id,
      'aria-label': `${hold.item.name}, unit ${hold.unit.label}, ${word}, ${hold.start_date} to ${hold.end_date}`,
    });
    row.appendChild(
      element('span', { class: 'row-name' }, [`${hold.item.name}, unit ${hold.unit.label}`]),
    );
    row.appendChild(statusChip(word));
    row.appendChild(
      element('span', { class: 'row-meta' }, [
        `${shortDate(hold.start_date)} \u2013 ${shortDate(hold.end_date)}`,
      ]),
    );
    if (hold.status === 'ready' && hold.pickup_deadline !== null) {
      row.appendChild(
        element('span', { class: 'row-meta' }, [`Pick up by ${localTime(hold.pickup_deadline)}`]),
      );
    }
    if (hold.status === 'requested' || hold.status === 'ready') {
      row.appendChild(element('span', { class: 'spacer' }));
      const cancel = element('button', { type: 'button' });
      cancel.textContent = 'Cancel hold';
      cancel.addEventListener('click', () => void cancelHold(hold, cancel));
      row.appendChild(cancel);
    }
    return row;
  }

  function loanRow(loan: Loan): HTMLElement {
    const word = loanWord(loan.status);
    const row = element('li', { 'data-id': loan.id }, [
      element('a', { class: 'row-name', href: `/loans/${loan.id}` }, [
        `${loan.item.name}, unit ${loan.unit.label}`,
      ]),
      statusChip(word),
      element('span', { class: 'row-meta' }, [`Due ${localTime(loan.due_at)}`]),
    ]);
    return row;
  }

  function paintHolds(): void {
    clear(holdList);
    if (holds.length === 0) holdList.appendChild(element('li', { class: 'empty' }, ['No holds yet']));
    else for (const hold of holds) holdList.appendChild(holdRow(hold));
    moreHolds.hidden = holdCursor === null;
  }

  function paintLoans(): void {
    clear(loanList);
    if (loans.length === 0) loanList.appendChild(element('li', { class: 'empty' }, ['No loans yet']));
    else for (const loan of loans) loanList.appendChild(loanRow(loan));
    moreLoans.hidden = loanCursor === null;
  }

  /** Rows are merged by id: listed rows update in place, new rows slot into order. */
  function merge<T extends { id: string }>(
    existing: readonly T[],
    incoming: readonly T[],
    compare: (left: T, right: T) => number,
  ): T[] {
    const byId = new Map(existing.map((record) => [record.id, record]));
    for (const record of incoming) byId.set(record.id, record);
    return [...byId.values()].sort(compare);
  }

  async function readFirstPages(): Promise<void> {
    const [holdPage, loanPage] = await Promise.all([
      request<HoldsPage>(`/api/holds?limit=${PAGE_SIZE}`),
      request<LoansPage>(`/api/loans?limit=${PAGE_SIZE}`),
    ]);
    holds = merge(holds, holdPage.holds, holdSort);
    loans = merge(loans, loanPage.loans, loanSort);
    if (holdCursor === null) holdCursor = holdPage.next_cursor;
    if (loanCursor === null) loanCursor = loanPage.next_cursor;
    paintHolds();
    paintLoans();
  }

  async function refresh(): Promise<void> {
    const [holdPage, loanPage] = await Promise.all([
      request<HoldsPage>(`/api/holds?limit=${PAGE_SIZE}`),
      request<LoansPage>(`/api/loans?limit=${PAGE_SIZE}`),
    ]);
    holds = merge(holds, holdPage.holds, holdSort);
    loans = merge(loans, loanPage.loans, loanSort);
    paintHolds();
    paintLoans();
  }

  moreHolds.addEventListener('click', () => {
    if (holdCursor === null) return;
    const pending = markPending(moreHolds, 'Loading more\u2026');
    const previous = holds.length;
    void request<HoldsPage>(`/api/holds?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(holdCursor)}`)
      .then((page) => {
        holds = merge(holds, page.holds, holdSort);
        holdCursor = page.next_cursor;
        pending.release();
        paintHolds();
        const added = holdList.children[previous];
        if (added instanceof HTMLElement) {
          added.tabIndex = -1;
          added.focus();
          sweep(added);
        }
        announce('My loans status', `Showing ${holds.length} holds.`);
      })
      .catch((error: unknown) => {
        pending.release();
        announce('My loans status', error instanceof ApiFailure ? error.message : 'Not found.');
      });
  });

  moreLoans.addEventListener('click', () => {
    if (loanCursor === null) return;
    const pending = markPending(moreLoans, 'Loading more\u2026');
    const previous = loans.length;
    void request<LoansPage>(`/api/loans?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(loanCursor)}`)
      .then((page) => {
        loans = merge(loans, page.loans, loanSort);
        loanCursor = page.next_cursor;
        pending.release();
        paintLoans();
        const added = loanList.children[previous];
        if (added instanceof HTMLElement) {
          const link = added.querySelector('a');
          if (link instanceof HTMLElement) link.focus();
          sweep(added);
        }
        announce('My loans status', `Showing ${loans.length} loans.`);
      })
      .catch((error: unknown) => {
        pending.release();
        announce('My loans status', error instanceof ApiFailure ? error.message : 'Not found.');
      });
  });

  /** The row changes only after the server answers; a refusal shows its real state. */
  async function cancelHold(hold: Hold, button: HTMLButtonElement): Promise<void> {
    const pending = markPending(button, 'Cancelling\u2026');
    try {
      const answer = await request<{ hold: Hold }>(`/api/holds/${hold.id}/cancel`, {
        method: 'POST',
        body: {},
      });
      holds = merge(holds, [answer.hold], holdSort);
      paintHolds();
      announce('My loans status', 'Hold cancelled.');
    } catch (error) {
      pending.release();
      announce('My loans status', error instanceof ApiFailure ? error.message : 'Not found.');
      try {
        const current = await request<{ hold: Hold }>(`/api/holds/${hold.id}`);
        holds = merge(holds, [current.hold], holdSort);
        paintHolds();
      } catch {
        /* the hold could not be re-read; the next refresh updates the row */
      }
    }
  }

  return {
    node,
    start(): void {
      void readFirstPages();
      timer = window.setInterval(() => void refresh(), REFRESH_MS);
    },
    stop(): void {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    },
  };
}
