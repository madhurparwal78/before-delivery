import { ApiFailure, request } from '../api.js';
import type { CounterStatus, Hold, HoldsPage, Item, Loan, LoansPage } from '../../shared/api.js';
import { addDays } from '../../domain/calendar.js';
import { FIELD_COPY } from '../../shared/errors.js';
import {
  instantFromLocalInput,
  loanWord,
  localTime,
  openDay,
  shortDate,
  todayLocal,
} from '../format.js';
import { dropKey, keyFor, retainKey } from '../keys.js';
import { navigate, type Screen } from '../shell.js';
import {
  announce,
  clear,
  element,
  labelledField,
  liveRegion,
  markPending,
  region,
  setFieldError,
  sweep,
} from '../ui/dom.js';
import { statusChip } from '../ui/chips.js';

const REFRESH_MS = 10_000;
const MAX_LOAN_DAYS = 7;

interface UnitOption {
  readonly id: string;
  readonly label: string;
}

export function counterScreen(): Screen {
  const banner = element('div', {
    class: 'banner quiet',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Counter services',
  });
  const result = liveRegion('Counter result');

  const prepareList = element('ul', { class: 'rows' });
  const readyList = element('ul', { class: 'rows' });
  const outList = element('ul', { class: 'rows' });

  const prepareRegion = region('Holds to prepare', [
    element('h2', {}, ['Holds to prepare']),
    prepareList,
  ]);
  const readyRegion = region('Ready for pickup', [
    element('h2', {}, ['Ready for pickup']),
    readyList,
  ]);
  const outRegion = region('Out on loan', [element('h2', {}, ['Out on loan']), outList]);
  for (const section of [prepareRegion, readyRegion, outRegion]) section.classList.add('col-third');

  const member = element('select', { id: 'walk-in-member' });
  const unit = element('select', { id: 'walk-in-unit' });
  const dueDate = element('input', { id: 'walk-in-due', type: 'date' });
  const checkedOutAt = element('input', { id: 'walk-in-checked-out', type: 'datetime-local' });
  const lend = element('button', { type: 'button', class: 'primary' });
  lend.textContent = 'Lend now';

  const walkInRegion = region('Walk-in loan', [
    element('h2', {}, ['Walk-in loan']),
    labelledField('Member', member, 'walk-in-member-error'),
    labelledField('Unit', unit, 'walk-in-unit-error'),
    labelledField('Due date', dueDate, 'walk-in-due-error'),
    labelledField('Checked out at', checkedOutAt, 'walk-in-checked-out-error'),
    lend,
  ]);
  walkInRegion.classList.add('span-12');

  const node = element('div', {}, [
    element('h1', {}, ['Counter']),
    banner,
    result,
    element('div', { class: 'grid' }, [prepareRegion, readyRegion, outRegion, walkInRegion]),
  ]);

  let billingUp = true;
  let depositByItem = new Map<string, number>();
  let timer: number | null = null;
  let movedRowId: string | null = null;

  function rowName(record: { item: { name: string }; unit: { label: string } }): string {
    return `${record.item.name}, unit ${record.unit.label}`;
  }

  function prepareRow(hold: Hold): HTMLElement {
    const row = element('li', { 'data-id': hold.id }, [
      element('span', { class: 'row-name' }, [rowName(hold)]),
      element('span', { class: 'row-meta' }, [hold.member.name]),
      element('span', { class: 'row-meta' }, [
        `${shortDate(hold.start_date)} \u2013 ${shortDate(hold.end_date)}`,
      ]),
      element('span', { class: 'spacer' }),
    ]);
    const button = element('button', { type: 'button' });
    button.textContent = 'Mark ready';
    button.addEventListener('click', () => {
      const pending = markPending(button, 'Marking ready\u2026');
      void request<{ hold: Hold }>(`/api/holds/${hold.id}/ready`, { method: 'POST', body: {} })
        .then((answer) => {
          announce(
            'Counter result',
            `Marked ready. Pickup notice queued for ${answer.hold.member.name}.`,
          );
          movedRowId = answer.hold.id;
        })
        .catch((error: unknown) => {
          announce('Counter result', error instanceof ApiFailure ? error.message : 'Not found.');
        })
        .finally(() => {
          pending.release();
          void refresh();
        });
    });
    row.appendChild(button);
    return row;
  }

  function readyRow(hold: Hold): HTMLElement {
    const deposit = depositByItem.get(hold.item.id) ?? 0;
    const blocked = !billingUp && deposit > 0;
    const row = element('li', { 'data-id': hold.id }, [
      element('span', { class: 'row-name' }, [rowName(hold)]),
      element('span', { class: 'row-meta' }, [hold.member.name]),
      element('span', { class: 'row-meta' }, [
        `${shortDate(hold.start_date)} \u2013 ${shortDate(hold.end_date)}`,
      ]),
      hold.pickup_deadline === null
        ? null
        : element('span', { class: 'row-meta' }, [`Pick up by ${localTime(hold.pickup_deadline)}`]),
      blocked ? element('span', { class: 'row-meta' }, ['Blocked: billing offline']) : null,
      element('span', { class: 'spacer' }),
    ]);
    const button = element('button', { type: 'button', class: 'primary', disabled: blocked });
    button.textContent = 'Check out';
    button.addEventListener('click', () => {
      const action = `checkout:${hold.id}`;
      const pending = markPending(button, 'Lending\u2026');
      void request<{ loan: Loan }>('/api/loans', {
        method: 'POST',
        idempotencyKey: keyFor(action),
        body: { hold_id: hold.id },
      })
        .then((answer) => {
          dropKey(action);
          announce(
            'Counter result',
            `Lent to ${answer.loan.member.name}. Due ${localTime(answer.loan.due_at)}.`,
          );
          movedRowId = answer.loan.id;
        })
        .catch((error: unknown) => {
          const failure = error instanceof ApiFailure ? error : null;
          if (failure?.code === 'billing_unavailable') retainKey(action);
          else dropKey(action);
          announce('Counter result', failure?.message ?? 'Not found.');
        })
        .finally(() => {
          pending.release();
          void refresh();
        });
    });
    row.appendChild(button);
    return row;
  }

  function outRow(loan: Loan): HTMLElement {
    return element('li', { 'data-id': loan.id }, [
      element('a', { class: 'row-name', href: `/loans/${loan.id}` }, [rowName(loan)]),
      element('span', { class: 'row-meta' }, [loan.member.name]),
      element('span', { class: 'row-meta' }, [`Due ${localTime(loan.due_at)}`]),
      statusChip(loanWord(loan.status)),
    ]);
  }

  function paintList(list: HTMLElement, rows: readonly HTMLElement[], emptyCopy: string): void {
    clear(list);
    if (rows.length === 0) {
      list.appendChild(element('li', { class: 'empty' }, [emptyCopy]));
      return;
    }
    for (const row of rows) list.appendChild(row);
  }

  async function refresh(): Promise<void> {
    const [statusAnswer, items, requestedPage, readyPage, outPage, overduePage] = await Promise.all([
      request<CounterStatus>('/api/counter/status'),
      request<{ items: Item[] }>('/api/items'),
      request<HoldsPage>('/api/holds?status=requested&limit=50'),
      request<HoldsPage>('/api/holds?status=ready&limit=50'),
      request<LoansPage>('/api/loans?status=out&limit=50'),
      request<LoansPage>('/api/loans?status=overdue&limit=50'),
    ]);
    billingUp = statusAnswer.billing === 'up';
    depositByItem = new Map(items.items.map((entry) => [entry.id, entry.deposit_cents]));
    const lines: string[] = [];
    if (statusAnswer.billing === 'down') {
      lines.push('Billing offline \u2014 deposit items are blocked. Items without a deposit still lend.');
    }
    if (statusAnswer.photo_storage === 'down') {
      lines.push('Photo storage offline \u2014 add photos later.');
    }
    clear(banner);
    for (const line of lines) banner.appendChild(element('div', { class: 'banner-line' }, [line]));
    banner.classList.toggle('quiet', lines.length === 0);

    const out = [...outPage.loans, ...overduePage.loans].sort((left, right) =>
      left.due_at < right.due_at ? -1 : 1,
    );

    paintList(prepareList, requestedPage.holds.map(prepareRow), 'No holds to prepare');
    paintList(readyList, readyPage.holds.map(readyRow), 'Nothing ready for pickup');
    paintList(outList, out.map(outRow), 'Nothing out on loan');

    if (movedRowId !== null) {
      const arrived = node.querySelector<HTMLElement>(`li[data-id="${movedRowId}"]`);
      if (arrived !== null) sweep(arrived);
      movedRowId = null;
    }
  }

  async function loadOptions(): Promise<void> {
    const [members, items] = await Promise.all([
      request<{ members: Array<{ id: string; name: string }> }>('/api/members'),
      request<{ items: Item[] }>('/api/items'),
    ]);
    clear(member);
    for (const entry of members.members) {
      member.appendChild(element('option', { value: entry.id }, [entry.name]));
    }
    clear(unit);
    const unitOptions = await Promise.all(
      items.items.map(async (entry) => {
        const lanes = await request<{ lanes: Array<{ unit_id: string; label: string }> }>(
          `/api/items/${entry.id}/lanes`,
        );
        return {
          itemName: entry.name,
          units: lanes.lanes.map<UnitOption>((lane) => ({ id: lane.unit_id, label: lane.label })),
        };
      }),
    );
    for (const entry of unitOptions) {
      for (const option of entry.units) {
        unit.appendChild(
          element('option', { value: option.id }, [`${entry.itemName} \u00b7 ${option.label}`]),
        );
      }
    }
  }

  lend.addEventListener('click', () => {
    setFieldError('walk-in-due-error', 'walk-in-due', null);
    setFieldError('walk-in-checked-out-error', 'walk-in-checked-out', null);
    const body: Record<string, unknown> = {
      member_id: member.value,
      unit_id: unit.value,
      due_date: dueDate.value,
    };
    let checkoutDate = todayLocal();
    if (checkedOutAt.value !== '') {
      const instant = instantFromLocalInput(checkedOutAt.value);
      if (instant === null) {
        setFieldError('walk-in-checked-out-error', 'walk-in-checked-out', FIELD_COPY.checked_out_at);
        announce('Counter result', 'Check the highlighted fields.');
        return;
      }
      body['checked_out_at'] = instant;
      checkoutDate = checkedOutAt.value.slice(0, 10);
    }
    if (
      dueDate.value === '' ||
      !openDay(dueDate.value) ||
      dueDate.value < checkoutDate ||
      dueDate.value > addDays(checkoutDate, MAX_LOAN_DAYS)
    ) {
      setFieldError('walk-in-due-error', 'walk-in-due', FIELD_COPY.due_date_walk_in);
      announce('Counter result', 'Check the highlighted fields.');
      return;
    }
    const action = `lend:${member.value}:${unit.value}:${dueDate.value}:${checkedOutAt.value}`;
    const pending = markPending(lend, 'Lending\u2026');
    void request<{ loan: Loan }>('/api/loans', {
      method: 'POST',
      idempotencyKey: keyFor(action),
      body,
    })
      .then(async (answer) => {
        dropKey(action);
        announce(
          'Counter result',
          `Lent to ${answer.loan.member.name}. Due ${localTime(answer.loan.due_at)}.`,
        );
        movedRowId = answer.loan.id;
        pending.release();
        await refresh();
        const link = node.querySelector<HTMLElement>(`li[data-id="${answer.loan.id}"] a`);
        link?.focus();
      })
      .catch((error: unknown) => {
        pending.release();
        const failure = error instanceof ApiFailure ? error : null;
        if (failure?.code === 'billing_unavailable') retainKey(action);
        else dropKey(action);
        announce('Counter result', failure?.message ?? 'Not found.');
        for (const [field, copy] of Object.entries(failure?.fields ?? {})) {
          if (field === 'due_date') setFieldError('walk-in-due-error', 'walk-in-due', copy);
          if (field === 'checked_out_at') {
            setFieldError('walk-in-checked-out-error', 'walk-in-checked-out', copy);
          }
          if (field === 'member_id') setFieldError('walk-in-member-error', 'walk-in-member', copy);
          if (field === 'unit_id') setFieldError('walk-in-unit-error', 'walk-in-unit', copy);
        }
      });
  });

  outList.addEventListener('click', (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLAnchorElement)) return;
    event.preventDefault();
    navigate(target.pathname);
  });

  return {
    node,
    start(): void {
      void loadOptions();
      void refresh();
      timer = window.setInterval(() => void refresh(), REFRESH_MS);
    },
    stop(): void {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    },
  };
}
