// Account: membership panel, loans, holds and fees. The pending check polls until active.

import type { ScreenKit } from './main';
import { el, clear } from './dom';
import { apiJson, ApiFailure } from './apiClient';
import { money, dueLine, overdueLine, holdStatusWord } from './format';
import type { Fee, Hold, Loan, Me } from './types';
import { setPending, clearPending } from './ui';

export function renderAccountScreen(kit: ScreenKit): () => void {
  const { main, app } = kit;
  clear(main);
  const wrap = el('div', { class: 'single-column' });
  const announce = el('div', { role: 'status', 'aria-label': 'Account updates', 'aria-live': 'polite', class: 'status-line' });

  const timers: ReturnType<typeof setTimeout>[] = [];
  let pendingCheckActive = false;
  let membershipHeadingFocused = false;
  let holdReadyAnnounced = new Set<number>();

  const membershipSection = el('section', { class: 'section' });
  const loansSection = el('section', { class: 'section' });
  const holdsSection = el('section', { class: 'section' });
  const feesSection = el('section', { class: 'section' });

  wrap.append(announce, membershipSection, loansSection, holdsSection, feesSection);
  main.append(wrap);

  const role = app.role();
  if (role !== 'member') {
    // Wrong role: stay on the URL and show Not found.
    clear(main);
    const nf = el('div', { class: 'not-found' });
    nf.append(el('h1', { text: "We couldn't find that page." }), el('p', {}, el('a', { href: '/', text: 'Back to the pegboard' })));
    main.append(nf);
    return () => {};
  }

  let lastMembershipStatus: string | null = null;
  let lastHolds: Hold[] = [];

  async function refresh(): Promise<void> {
    const [me, loans, holds, fees] = await Promise.all([
      apiJson<Me>('GET', '/api/me'),
      apiJson<{ loans: Loan[] }>('GET', '/api/loans'),
      apiJson<{ holds: Hold[] }>('GET', '/api/holds'),
      apiJson<{ fees: Fee[] }>('GET', '/api/fees'),
    ]);
    app.me = me;
    renderMembership(me);
    renderLoans(loans.loans);
    renderHolds(holds.holds);
    renderFees(fees.fees);

    // The single pending-to-active change announcement.
    const status = me.membership === null ? null : me.membership.status;
    if (lastMembershipStatus === 'pending-payment' && status === 'active') {
      announce.textContent = 'Your membership is active.';
      pendingCheckActive = false;
    }
    lastMembershipStatus = status;

    // Hold-ready announcements, once per hold per page.
    const freshReady = holds.holds.filter((h) => h.status === 'ready' && !holdReadyAnnounced.has(h.id));
    if (freshReady.length > 0 && lastHolds.some((h) => h.status === 'queued')) {
      const sentences: string[] = [];
      for (const hold of freshReady) {
        const item = app.board?.items.find((i) => i.id === hold.item_id);
        sentences.push(`Your hold on ${item?.name ?? 'a tool'} is ready.`);
        holdReadyAnnounced.add(hold.id);
      }
      announce.textContent = sentences.sort().join(' ');
    }
    for (const hold of holds.holds) {
      if (hold.status === 'ready') holdReadyAnnounced.add(hold.id);
    }
    lastHolds = holds.holds;
  }

  function renderMembership(me: Me): void {
    clear(membershipSection);
    const heading = el('h2', { text: 'Your membership' });
    heading.setAttribute('tabindex', '-1');
    membershipSection.append(heading);
    if (me.membership === null) {
      membershipSection.append(el('p', { text: 'No membership.' }));
      return;
    }
    const statusWord = me.membership.status === 'pending-payment' ? 'pending payment' : me.membership.status;
    const statusChip = el('span', { class: 'status-chip' }, el('span', { class: 'shape shape-dashed' }), el('span', { text: statusWord }));
    const line = el('p', {}, statusChip, el('span', { text: ` ${me.membership.tier}` }));
    membershipSection.append(line);
    if (me.membership.active_until !== null) {
      membershipSection.append(el('p', { class: 'mono', text: `Active until ${me.membership.active_until}` }));
    }
    if (me.membership.status === 'active' && !me.membership.ends_at_term) {
      const cancel = el('button', { text: 'Cancel at end of term' }) as HTMLButtonElement;
      membershipSection.append(cancel);
      cancel.addEventListener('click', () => openCancelDialog(cancel, heading));
    }
  }

  function openCancelDialog(opener: HTMLButtonElement, heading: HTMLElement): void {
    const dialog = el('dialog', { 'aria-label': 'Cancel membership' }) as HTMLDialogElement;
    const confirm = el('button', { class: 'primary', text: 'Confirm cancel' }) as HTMLButtonElement;
    const keep = el('button', { text: 'Keep membership' }) as HTMLButtonElement;
    dialog.append(
      el('h2', { text: 'Cancel membership' }),
      el('p', { text: 'Your membership will end at the end of the term you have paid for.' }),
      el('div', { class: 'row' }, confirm),
      el('div', { class: 'row' }, keep),
    );
    main.append(dialog);
    dialog.showModal();

    const focusFirst = () => confirm.focus();
    focusFirst();

    const close = () => {
      dialog.close();
      dialog.remove();
      opener.focus();
    };
    keep.addEventListener('click', close);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });

    confirm.addEventListener('click', () => void doCancel(confirm, dialog, heading));
  }

  async function doCancel(button: HTMLButtonElement, dialog: HTMLDialogElement, heading: HTMLElement): Promise<void> {
    setPending(button, 'Cancelling...');
    try {
      const result = await apiJson<{ membership: { active_until: string | null } }>('POST', '/api/membership/cancel');
      dialog.close();
      dialog.remove();
      announce.textContent = `Your membership ends on ${result.membership.active_until ?? ''}.`;
      await refresh();
      heading.focus();
    } catch (err) {
      clearPending(button);
      if (err instanceof ApiFailure) {
        announce.textContent = err.error;
        if (err.status === 401) {
          dialog.close();
          dialog.remove();
          window.location.href = `/signin?next=${encodeURIComponent('/account')}`;
        }
      }
    }
  }

  function renderLoans(loans: Loan[]): void {
    clear(loansSection);
    loansSection.append(el('h2', { text: 'Your loans' }));
    const table = el('table', { class: 'ledger', 'aria-label': 'Your loans' });
    const head = el('thead', {}, el('tr', {}, el('th', { text: 'Loan' }), el('th', { text: 'Items' }), el('th', { text: 'Due' })));
    const body = el('tbody');
    for (const loan of loans) {
      const row = el('tr');
      const refLink = el('a', { href: `/loans/${loan.id}`, text: loan.ref });
      row.append(el('td', {}, refLink));
      row.append(el('td', { text: loan.items.map((i) => i.name).join(', ') }));
      const dueCell = el('td', { class: 'mono' });
      if (loan.due_date !== null && loan.due_by !== null) {
        dueCell.append(el('div', { text: dueLine(loan.due_date, loan.due_by) }));
        if (loan.status === 'out' && (loan.open_days_late ?? 0) > 0) {
          dueCell.append(el('div', { class: 'overdue-line', text: overdueLine(loan.open_days_late!, loan.late_fee_so_far_cents!) }));
        }
      } else {
        dueCell.textContent = 'Reserved';
      }
      row.append(dueCell);
      body.append(row);
    }
    table.append(head, body);
    loansSection.append(table);
  }

  function renderHolds(holds: Hold[]): void {
    clear(holdsSection);
    holdsSection.append(el('h2', { text: 'Your holds' }));
    const table = el('table', { class: 'ledger', 'aria-label': 'Your holds' });
    const head = el('thead', {}, el('tr', {}, el('th', { text: 'Tool' }), el('th', { text: 'Status' }), el('th', { text: '' })));
    const body = el('tbody');
    for (const hold of holds) {
      const item = app.board?.items.find((i) => i.id === hold.item_id);
      const row = el('tr');
      row.append(el('td', { text: `${item?.name ?? ''} (${item?.tag ?? ''})` }));
      const statusText = holdStatusWord(hold.status) + (hold.status === 'queued' && hold.position !== null ? ` (position ${hold.position})` : '');
      row.append(el('td', { text: statusText }));
      const actionCell = el('td');
      if (hold.status === 'queued' || hold.status === 'ready') {
        const button = el('button', { text: `Cancel hold ${item?.name ?? ''}` }) as HTMLButtonElement;
        button.addEventListener('click', () => void cancelHold(button, hold.id));
        actionCell.append(button);
      }
      row.append(actionCell);
      body.append(row);
    }
    table.append(head, body);
    holdsSection.append(table);
  }

  async function cancelHold(button: HTMLButtonElement, holdId: number): Promise<void> {
    setPending(button, 'Cancelling...');
    try {
      await apiJson('DELETE', `/api/holds/${holdId}`);
      announce.textContent = 'Hold cancelled.';
      await refresh();
    } catch (err) {
      clearPending(button);
      if (err instanceof ApiFailure) announce.textContent = err.error;
    }
  }

  function renderFees(fees: Fee[]): void {
    clear(feesSection);
    feesSection.append(el('h2', { text: 'Your fees' }));
    const table = el('table', { class: 'ledger', 'aria-label': 'Your fees' });
    const head = el('thead', {}, el('tr', {}, el('th', { text: 'Fee' }), el('th', { text: 'Loan' }), el('th', { text: 'Total' }), el('th', { text: 'Status' })));
    const body = el('tbody');
    for (const fee of fees) {
      const row = el('tr');
      row.append(el('td', {}, el('a', { href: `/fees/${fee.id}`, text: `Fee ${fee.id}` })));
      row.append(el('td', { text: fee.loan_ref }));
      row.append(el('td', { class: 'mono', text: money(fee.total_cents) }));
      const word = fee.status === 'waived-by-coordinator' ? 'waived' : fee.status;
      row.append(el('td', {}, el('span', { class: 'status-chip' }, el('span', { class: `shape shape-stamp${fee.status === 'settled' ? '' : fee.status === 'waived-by-coordinator' ? ' struck' : ' open'}` }), el('span', { text: word }))));
      body.append(row);
    }
    table.append(head, body);
    feesSection.append(table);
  }

  void refresh().then(() => {
    const status = app.me?.membership?.status;
    if (status === 'pending-payment') startPendingCheck();
  });

  function startPendingCheck(): void {
    pendingCheckActive = true;
    const tick = async () => {
      if (!pendingCheckActive) return;
      try {
        await refresh();
      } catch {
        // keep polling
      }
      const status = app.me?.membership?.status;
      if (status !== 'active') timers.push(setTimeout(tick, 3000));
    };
    timers.push(setTimeout(tick, 3000));
  }

  void membershipHeadingFocused;
  return () => {
    pendingCheckActive = false;
    for (const timer of timers) clearTimeout(timer);
  };
}
