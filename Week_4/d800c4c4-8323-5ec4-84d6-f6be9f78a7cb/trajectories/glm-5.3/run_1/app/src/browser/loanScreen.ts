// Loan page: ref, status, recorded fee rules, items, parts, due line, overdue line, photos.

import type { ScreenKit } from './main';
import { el, clear } from './dom';
import { apiJson, ApiFailure } from './apiClient';
import { money, dueLine, overdueLine, loanStatusWord, dateTime } from './format';
import type { Loan } from './types';

export function renderLoanScreen(kit: ScreenKit, loanId: number): () => void {
  const { main, app } = kit;
  clear(main);
  const wrap = el('div', { class: 'single-column' });
  main.append(wrap);

  const timers: ReturnType<typeof setTimeout>[] = [];
  const role = app.role();

  void refresh();

  async function refresh(): Promise<boolean> {
    try {
      const result = await apiJson<{ loan: Loan }>('GET', `/api/loans/${loanId}`);
      renderLoan(result.loan);
      return true;
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 404) {
        renderNotFoundScreen();
      }
      return false;
    }
  }

  function renderNotFoundScreen(): void {
    clear(wrap);
    const nf = el('div', { class: 'not-found' });
    nf.append(el('h1', { text: "We couldn't find that page." }), el('p', {}, el('a', { href: '/', text: 'Back to the pegboard' })));
    wrap.append(nf);
  }

  function renderLoan(loan: Loan): void {
    clear(wrap);
    if (role !== null && role !== 'member' && role !== 'volunteer' && role !== 'coordinator') {
      renderNotFoundScreen();
      return;
    }
    const heading = el('h1', { text: `Loan ${loan.ref}`, class: 'wordmark' });
    const status = el('p', {}, el('span', { class: 'status-chip' }, el('span', { class: `shape shape-${shapeFor(loan.status)}` }), el('span', { text: loanStatusWord(loan.status) })));
    wrap.append(heading, status);

    if (loan.fee_rules !== null) {
      wrap.append(
        el('p', { class: 'mono', text: `Late fee $${(loan.fee_rules.late_fee_cents / 100).toFixed(2)} per open day, damage fee $${(loan.fee_rules.damage_fee_cents / 100).toFixed(2)}` }),
      );
    }

    const itemsTable = el('table', { class: 'ledger' });
    itemsTable.append(
      el('thead', {}, el('tr', {}, el('th', { text: 'Item' }), el('th', { text: 'Grade' }), el('th', { text: 'Cap' }))),
    );
    const body = el('tbody');
    for (const item of loan.items) {
      const row = el('tr', {}, el('td', { text: `${item.name} (${item.tag})` }), el('td', { text: item.grade ?? '' }));
      const capCell = el('td', { class: 'mono' });
      if (loan.fee_rules !== null && loan.status !== 'reserved') {
        const cost = loan.fee_rules.replacement_costs_cents[String(item.id)];
        if (cost !== undefined) capCell.textContent = `Cap ${money(cost)}`;
      }
      row.append(capCell);
      body.append(row);
    }
    itemsTable.append(body);
    wrap.append(itemsTable);

    const partsList = el('ul');
    for (const part of loan.parts) {
      partsList.append(el('li', { text: `${part.name} (${part.state})` }));
    }
    if (loan.missing_parts.length > 0) {
      wrap.append(el('p', { text: `Missing parts: ${loan.missing_parts.join(', ')}` }));
    }

    if (loan.due_date !== null && loan.due_by !== null) {
      const due = el('p', { class: 'due-line', text: dueLine(loan.due_date, loan.due_by) });
      wrap.append(due);
      if (loan.status === 'out' && (loan.open_days_late ?? 0) > 0) {
        wrap.append(el('p', { class: 'overdue-line', text: overdueLine(loan.open_days_late!, loan.late_fee_so_far_cents!) }));
      }
    }

    if (loan.fee_id !== null) {
      wrap.append(el('p', {}, el('a', { href: `/fees/${loan.fee_id}`, text: `View fee ${loan.fee_id}` })));
    }

    if (loan.status !== 'reserved') {
      wrap.append(renderPhotoComparison(loan));
    }
  }

  function shapeFor(status: string): string {
    switch (status) {
      case 'reserved':
        return 'notch';
      case 'pending-photo':
        return 'dotted';
      case 'returned-partial':
        return 'half';
      case 'returned-complete':
        return 'solid';
      default:
        return 'dashed';
    }
  }

  function renderPhotoComparison(loan: Loan): HTMLElement {
    const section = el('section', { class: 'section' });
    section.append(el('h2', { text: 'Photos' }));
    const compare = el('div', { class: 'photo-compare' });
    const checkoutPhoto = loan.photos.find((p) => p.event === 'checkout');
    const checkinPhoto = loan.photos.find((p) => p.event === 'checkin');
    compare.append(photoSlot('Checkout', checkoutPhoto), photoSlot('Check-in', checkinPhoto));
    section.append(compare);
    return section;
  }

  function photoSlot(label: string, photo: Loan['photos'][number] | undefined): HTMLElement {
    const slot = el('div', { class: 'photo-slot' });
    if (photo === undefined) {
      slot.append(el('div', { class: 'photo-empty', text: label === 'Checkout' ? 'No checkout photo — this loan predates photos.' : 'No check-in photo yet.' }));
      return slot;
    }
    const img = el('img', {
      src: photo.url,
      alt: `${label === 'Checkout' ? 'Checkout' : 'Check-in'} photo, captured ${dateTime(photo.captured_at)}`,
    }) as HTMLImageElement;
    slot.append(img);
    slot.append(el('p', { class: 'capture', text: `Captured ${dateTime(photo.captured_at)} · ${photo.byte_size} bytes` }));
    slot.append(el('p', { class: 'fingerprint', text: photo.sha256 }));
    slot.append(el('a', { href: photo.url, target: '_blank', rel: 'noopener', text: 'Open original' }));
    return slot;
  }

  const poll = setInterval(() => void refresh(), 10000);
  timers.push(poll as unknown as ReturnType<typeof setTimeout>);

  return () => {
    for (const timer of timers) clearTimeout(timer);
    clearInterval(poll);
  };
}
