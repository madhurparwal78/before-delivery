import type { CycleSummary, LedgerPage, Me, Movement } from '../../shared/types.ts';
import { request } from '../api.ts';
import { copy } from '../copy.ts';
import { clear, el, isBusy, setBusy, setText } from '../dom.ts';
import { LiveRegion } from '../live.ts';
import { formatDollars } from '../../shared/money.ts';
import { homeFor, type Page, type Shell } from './page.ts';

export function createSignInPage(onSignedIn: (me: Me) => void): Page {
  const field = el('input', { type: 'text', id: 'access-code', class: 'code-input', 'aria-label': 'Access code' }) as HTMLInputElement;
  const error = el('p', { class: 'field-error', id: 'access-code-error' });
  const button = el('button', { type: 'button', class: 'primary', text: 'Sign in' }) as HTMLButtonElement;
  const form = el('form', { class: 'sign-in-panel' }, [
    el('h1', { text: 'Tally Split' }),
    el('label', { for: 'access-code', class: 'label', text: 'ACCESS CODE' }),
    field,
    error,
    button,
  ]);
  const element = el('main', { class: 'screen sign-in' }, [form]);

  async function submit(): Promise<void> {
    if (isBusy(button)) return;
    setBusy(button, true, { busy: 'Signing in...', idle: 'Sign in' });
    try {
      const reply = await request<Me>('POST', '/api/session', { body: { code: field.value } });
      setBusy(button, false, { busy: 'Signing in...', idle: 'Sign in' });
      if (reply.status === 200) {
        setText(error, '');
        field.removeAttribute('aria-describedby');
        onSignedIn(reply.body);
        return;
      }
      setText(error, copy.signInError);
      field.setAttribute('aria-describedby', 'access-code-error');
    } catch {
      setBusy(button, false, { busy: 'Signing in...', idle: 'Sign in' });
      setText(error, copy.signInError);
      field.setAttribute('aria-describedby', 'access-code-error');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    void submit();
  });

  return {
    element,
    start() {
      field.focus();
    },
    destroy() {
      /* nothing to tidy */
    },
  };
}

export function createNotFoundPage(shell: Shell): Page {
  const element = el('main', { class: 'screen not-found' }, [
    el('h1', { text: 'Page not found' }),
    el('a', { href: homeFor(shell.me.role), class: 'text-link', text: 'Back to your home' }),
  ]);
  return {
    element,
    start() {
      /* static screen */
    },
    destroy() {
      /* nothing to tidy */
    },
  };
}

export function createMemberHomePage(shell: Shell): Page {
  const openList = el('ul', { class: 'cycle-list', 'aria-label': 'Open cycles' });
  const emptyMessage = el('p', { class: 'empty-cycle', text: copy.emptyCycle, hidden: true });
  const laterList = el('ul', { class: 'cycle-list', 'aria-label': 'Your cycles in progress' });
  const element = el('main', { class: 'screen member-home' }, [
    el('h1', { text: shell.club.name }),
    el('h2', { class: 'section-heading', text: 'OPEN CYCLES' }),
    openList,
    emptyMessage,
    el('h2', { class: 'section-heading', text: 'IN PROGRESS' }),
    laterList,
  ]);
  let timer: number | null = null;
  let shown = '';

  async function load(): Promise<void> {
    const reply = await request<{ cycles: CycleSummary[] }>('GET', '/api/cycles');
    if (!reply.ok) return;
    const cycles = reply.body.cycles;
    const signature = cycles.map((cycle) => `${cycle.id}:${cycle.status}:${cycle.name}:${cycle.cutoff_display}`).join('|');
    if (signature === shown) return;
    shown = signature;
    const open = cycles.filter((cycle) => cycle.status === 'open');
    const later = cycles.filter((cycle) => ['sealing', 'ordered', 'received', 'breakdown'].includes(cycle.status));
    clear(openList);
    for (const cycle of open) {
      openList.append(
        el('li', {}, [
          el('a', { href: `/cycles/${cycle.id}`, class: 'cycle-link', text: cycle.name }),
          el('span', { class: 'cycle-cutoff', text: cycle.cutoff_display ? `CUTOFF ${cycle.cutoff_display}` : '' }),
        ]),
      );
    }
    openList.hidden = open.length === 0;
    emptyMessage.hidden = open.length > 0;
    clear(laterList);
    for (const cycle of later) {
      laterList.append(
        el('li', {}, [
          el('a', { href: `/cycles/${cycle.id}`, class: 'cycle-link', text: cycle.name }),
          el('span', { class: 'cycle-status', text: cycle.status.toUpperCase() }),
        ]),
      );
    }
  }

  return {
    element,
    start() {
      void load();
      timer = window.setInterval(() => void load(), 10_000);
    },
    destroy() {
      if (timer !== null) window.clearInterval(timer);
    },
  };
}

export function createCreditHistoryPage(shell: Shell): Page {
  const creditUpdates = new LiveRegion('Credit updates');
  const balance = el('span', { class: 'money' });
  const held = el('span', { class: 'money' });
  const spendable = el('span', { class: 'money' });
  const rows = el('tbody');
  const table = el('table', { class: 'ledger-table', 'aria-label': 'Credit history', tabindex: '-1' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'DATE' }),
        el('th', { scope: 'col', text: 'KIND' }),
        el('th', { scope: 'col', text: 'MEMO' }),
        el('th', { scope: 'col', text: 'AMOUNT' }),
      ]),
    ]),
    rows,
  ]);
  const olderButton = el('button', { type: 'button', text: 'Show older movements', hidden: true }) as HTMLButtonElement;
  const element = el('main', { class: 'screen credit-history' }, [
    el('h1', { text: 'Credit history' }),
    el('section', { class: 'credit-panel', role: 'region', 'aria-label': 'Credit' }, [
      el('div', { class: 'credit-figure' }, [el('span', { class: 'label', text: 'BALANCE' }), balance]),
      el('div', { class: 'credit-figure' }, [el('span', { class: 'label', text: 'HELD' }), held]),
      el('div', { class: 'credit-figure' }, [el('span', { class: 'label', text: 'SPENDABLE' }), spendable]),
    ]),
    table,
    olderButton,
    creditUpdates.element,
  ]);

  let nextBefore: string | null = null;
  let shown = 0;
  let total = 0;
  const householdCode = shell.me.household_code ?? '';

  function addRows(movements: Movement[]): void {
    for (const movement of movements) {
      const own = movement.legs.find((leg) => leg.account === `household:${householdCode}`);
      const amount = own?.amount_cents ?? 0;
      rows.append(
        el('tr', {}, [
          el('td', { text: movement.created_at.replace('T', ' ').replace('Z', '') }),
          el('td', { text: movement.kind }),
          el('td', { text: movement.memo }),
          el('td', { class: 'money', text: `${amount < 0 ? '-' : ''}$${formatDollars(Math.abs(amount))}` }),
        ]),
      );
    }
    shown += movements.length;
  }

  async function load(cursor: string | null): Promise<void> {
    const query = new URLSearchParams({ limit: '20' });
    if (cursor) query.set('before', cursor);
    const reply = await request<LedgerPage>('GET', `/api/households/${householdCode}/ledger?${query.toString()}`);
    if (!reply.ok) {
      creditUpdates.say(copy.movementsError);
      return;
    }
    const page = reply.body;
    total = page.total_movements;
    setText(balance, `$${formatDollars(page.balance_cents)}`);
    setText(held, `$${formatDollars(page.held_cents)}`);
    setText(spendable, `$${formatDollars(page.spendable_cents)}`);
    addRows(page.movements);
    nextBefore = page.next_before;
    olderButton.hidden = nextBefore === null;
    if (cursor !== null) {
      creditUpdates.say(copy.showingMovements(shown, total));
      if (nextBefore === null) table.focus();
    }
  }

  olderButton.addEventListener('click', () => {
    if (isBusy(olderButton)) return;
    setBusy(olderButton, true, { busy: 'Loading...', idle: 'Show older movements' });
    void load(nextBefore).finally(() => {
      setBusy(olderButton, false, { busy: 'Loading...', idle: 'Show older movements' });
    });
  });

  return {
    element,
    start() {
      void load(null);
    },
    destroy() {
      /* nothing to tidy */
    },
  };
}
