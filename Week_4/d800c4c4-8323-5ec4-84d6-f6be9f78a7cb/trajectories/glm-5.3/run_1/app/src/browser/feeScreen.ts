// Fee page: lines, total, status, pay, waiver request and decision, photo comparison.

import type { ScreenKit } from './main';
import { el, clear } from './dom';
import { apiJson, ApiFailure } from './apiClient';
import { money, dateTime } from './format';
import type { Fee, Photo } from './types';
import { renderProblems, setPending, clearPending } from './ui';

export function renderFeeScreen(kit: ScreenKit, feeId: number): () => void {
  const { main, app } = kit;
  clear(main);
  const wrap = el('div', { class: 'single-column' });
  main.append(wrap);

  const timers: ReturnType<typeof setTimeout>[] = [];
  const role = app.role();
  let fee: Fee | null = null;
  let photos: Photo[] = [];
  let waiverAnnounced = false;

  void refresh();

  async function refresh(): Promise<void> {
    try {
      const result = await apiJson<{ fee: Fee; photos: Photo[] }>('GET', `/api/fees/${feeId}`);
      const wasRaised = fee !== null && fee.status === 'raised';
      fee = result.fee;
      photos = result.photos;
      render();
      if (wasRaised && fee.status === 'waived-by-coordinator' && role === 'member' && !waiverAnnounced) {
        waiverAnnounced = true;
        announceWaived();
      }
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 404) renderNotFound();
    }
  }

  const announce = el('div', { role: 'status', 'aria-label': 'Account updates', 'aria-live': 'polite', class: 'status-line' });

  function announceWaived(): void {
    announce.textContent = `Fee ${feeId} was waived.`;
    const heading = wrap.querySelector('h1');
    if (heading instanceof HTMLElement) heading.focus();
  }

  function renderNotFound(): void {
    clear(wrap);
    const nf = el('div', { class: 'not-found' });
    nf.append(el('h1', { text: "We couldn't find that page." }), el('p', {}, el('a', { href: '/', text: 'Back to the pegboard' })));
    wrap.append(nf);
  }

  function render(): void {
    if (fee === null) return;
    clear(wrap);
    const heading = el('h1', { text: `Fee ${fee.id}`, class: 'wordmark' });
    heading.setAttribute('tabindex', '-1');
    const statusChip = el('span', { class: 'status-chip' }, el('span', { class: `shape shape-stamp${fee.status === 'settled' ? '' : fee.status === 'waived-by-coordinator' ? ' struck' : ' open'}` }), el('span', { text: fee.status === 'waived-by-coordinator' ? 'waived' : fee.status }));
    wrap.append(announce, heading, el('p', {}, statusChip));

    const linesTable = el('table', { class: 'ledger', 'aria-label': 'Fee lines' });
    linesTable.setAttribute('tabindex', '-1');
    linesTable.append(el('thead', {}, el('tr', {}, el('th', { text: 'Description' }), el('th', { text: 'Amount' }))));
    const body = el('tbody');
    for (const line of fee.lines) {
      body.append(el('tr', {}, el('td', { text: line.description }), el('td', { class: 'mono', text: money(line.amount_cents) })));
    }
    body.append(el('tr', {}, el('td', { text: 'Total' }), el('td', { class: 'mono', text: money(fee.total_cents) })));
    linesTable.append(body);
    wrap.append(linesTable);

    if (fee.waiver !== null) {
      const waiverP = el('p', { text: `Waiver ${fee.waiver.status}: ${fee.waiver.reason}` });
      wrap.append(waiverP);
    }

    if (role === 'member' && fee.status === 'raised') {
      const pay = el('button', { class: 'primary', text: `Pay ${money(fee.total_cents)}` }) as HTMLButtonElement;
      pay.addEventListener('click', () => void doPay(pay));
      wrap.append(pay);
      if (fee.waiver === null || fee.waiver.status === 'declined') {
        const waiver = el('button', { text: 'Request a waiver' }) as HTMLButtonElement;
        waiver.addEventListener('click', () => openWaiverDialog(waiver, pay));
        wrap.append(waiver);
      }
    }
    if (role === 'coordinator' && fee.status === 'raised' && fee.waiver !== null && fee.waiver.status === 'requested') {
      const approve = el('button', { class: 'primary', text: 'Approve waiver' }) as HTMLButtonElement;
      const decline = el('button', { text: 'Decline waiver' }) as HTMLButtonElement;
      approve.addEventListener('click', () => void decide(approve, 'approve'));
      decline.addEventListener('click', () => void decide(decline, 'decline'));
      wrap.append(approve, decline);
    }

    wrap.append(renderPhotoComparison(photos));
  }

  async function doPay(button: HTMLButtonElement): Promise<void> {
    setPending(button, 'Paying...');
    try {
      await apiJson('POST', `/api/fees/${feeId}/pay`);
      announce.textContent = 'Fee settled.';
      await refresh();
      const table = wrap.querySelector('table');
      if (table instanceof HTMLElement) table.focus();
    } catch (err) {
      clearPending(button);
      if (err instanceof ApiFailure) announce.textContent = err.error;
      button.focus();
    }
  }

  async function decide(button: HTMLButtonElement, decision: 'approve' | 'decline'): Promise<void> {
    setPending(button, 'Saving...');
    try {
      await apiJson('POST', `/api/fees/${feeId}/waiver-decision`, { decision });
      announce.textContent = decision === 'approve' ? 'Fee waived.' : 'Waiver declined.';
      await refresh();
      const table = wrap.querySelector('table');
      if (table instanceof HTMLElement) table.focus();
    } catch (err) {
      clearPending(button);
      if (err instanceof ApiFailure) announce.textContent = err.error;
      button.focus();
    }
  }

  function openWaiverDialog(opener: HTMLButtonElement, payButton: HTMLButtonElement): void {
    const dialog = el('dialog', { 'aria-label': 'Request a waiver' }) as HTMLDialogElement;
    const reason = el('textarea', { id: 'waiver-reason', rows: '4' }) as HTMLTextAreaElement;
    const send = el('button', { class: 'primary', text: 'Send request' }) as HTMLButtonElement;
    const problems = el('div');
    dialog.append(
      el('h2', { text: 'Request a waiver' }),
      el('label', { for: 'waiver-reason', text: 'Reason' }),
      reason,
      problems,
      el('div', { class: 'row' }, send),
    );
    main.append(dialog);
    dialog.showModal();
    reason.focus();

    const close = () => {
      dialog.close();
      dialog.remove();
    };
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
      opener.focus();
    });

    send.addEventListener('click', () => void sendRequest(send, dialog, payButton, reason));
  }

  async function sendRequest(button: HTMLButtonElement, dialog: HTMLDialogElement, payButton: HTMLButtonElement, reason: HTMLTextAreaElement): Promise<void> {
    setPending(button, 'Sending...');
    try {
      await apiJson('POST', `/api/fees/${feeId}/waiver-request`, { reason: reason.value });
      dialog.close();
      dialog.remove();
      announce.textContent = 'Waiver requested. The coordinator will decide.';
      await refresh();
      payButton.focus();
    } catch (err) {
      clearPending(button);
      if (err instanceof ApiFailure) {
        if (err.status === 422) {
          renderProblems(document.createElement('span'), err.fields ?? {}, () => null);
          reason.after(el('p', { class: 'field-error', text: err.fields?.['reason'] ?? 'Check the highlighted fields.' }));
          reason.focus();
        } else {
          announce.textContent = err.error;
          reason.focus();
        }
      }
    }
  }

  function renderPhotoComparison(photos: Photo[]): HTMLElement {
    const section = el('section', { class: 'section' });
    section.append(el('h2', { text: 'Photos' }));
    const compare = el('div', { class: 'photo-compare' });
    const checkoutPhoto = photos.find((p) => p.event === 'checkout');
    const checkinPhoto = photos.find((p) => p.event === 'checkin');
    compare.append(photoSlot('Checkout', checkoutPhoto), photoSlot('Check-in', checkinPhoto));
    section.append(compare);
    return section;
  }

  function photoSlot(label: string, photo: Photo | undefined): HTMLElement {
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
