import { request } from '../api.js';
import type { LedgerEntry, LedgerKind } from '../../shared/api.js';
import { localTime, money } from '../format.js';
import type { Screen } from '../shell.js';
import { clear, element } from '../ui/dom.js';

const KIND_WORDS: Record<LedgerKind, string> = {
  deposit_hold: 'Deposit hold',
  deposit_release: 'Deposit release',
  damage_charge: 'Damage charge',
  extra_damage: 'Extra damage',
  late_fee: 'Late fee',
};

export function ledgerScreen(): Screen {
  const held = element('p', { class: 'mono' }, ['Deposits held now: \u2026']);
  const body = element('tbody');
  const table = element('table', { 'aria-label': 'Deposit ledger' }, [
    element('thead', {}, [
      element('tr', {}, [
        element('th', { scope: 'col' }, ['Loan']),
        element('th', { scope: 'col' }, ['Item']),
        element('th', { scope: 'col' }, ['Kind']),
        element('th', { scope: 'col' }, ['Amount']),
        element('th', { scope: 'col' }, ['Recorded']),
      ]),
    ]),
    body,
  ]);

  const node = element('div', {}, [
    element('h1', {}, ['Deposit ledger']),
    held,
    element('div', { class: 'box' }, [table]),
  ]);

  void (async () => {
    const answer = await request<{ entries: LedgerEntry[]; deposits_held_cents: number }>(
      '/api/ledger',
    );
    held.textContent = `Deposits held now: ${money(answer.deposits_held_cents)}`;
    clear(body);
    for (const entry of answer.entries) {
      body.appendChild(
        element('tr', {}, [
          element('td', {}, [entry.loan_id]),
          element('td', {}, [entry.item.name]),
          element('td', {}, [KIND_WORDS[entry.kind]]),
          element('td', {}, [money(entry.amount_cents)]),
          element('td', {}, [localTime(entry.created_at)]),
        ]),
      );
    }
    if (answer.entries.length === 0) {
      body.appendChild(element('tr', {}, [element('td', { colspan: '5' }, ['No entries yet'])]));
    }
  })();

  return { node };
}
