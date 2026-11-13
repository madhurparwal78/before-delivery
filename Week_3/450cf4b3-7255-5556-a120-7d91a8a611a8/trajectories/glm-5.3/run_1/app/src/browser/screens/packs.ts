import { api, state, el, clear, durationText, dollars, longDateFromKey } from '../lib.js';
import { announce } from '../live.js';
import { readKitchen, buildHeader, removeHeader, startClockText } from '../header.js';

// Hour packs: three buy buttons with one purchase attempt per press, the
// password dialog for larger packs, panels with ledger tables and receipt
// delivery lines.

interface PackJson {
  id: string; hours: number; purchasedMinutes: number; balanceMinutes: number;
  heldMinutes: number; availableMinutes: number; priceCents: number; status: string;
  invoiceId: string | null; purchasedAt: string;
  receiptEmail: { status: string; sentAt: string | null };
  refundableCents?: number; refundedCents?: number | null;
  entries?: Array<{ id: number; movementId: string; movement: string; side: string; minutes: number; bookingId: string | null; createdAt: string }>;
}

interface Attempt {
  key: string;
  hours: 10 | 20 | 40;
}

let openAttempt: Attempt | null = null;
let zone = 'UTC';

export function renderPacks(app: HTMLElement): () => void {
  const timers: number[] = [];
  let destroyed = false;

  const boot = async () => {
    const kitchen = await readKitchen();
    if (!kitchen || destroyed) return;
    zone = kitchen.timeZone;

    // Restore an open attempt for this user from the tab's session storage.
    const stored = sessionStorage.getItem(`purchase-attempt-${state.me!.id}`);
    openAttempt = stored ? JSON.parse(stored) as Attempt : null;

    removeHeader();
    buildHeader({ role: state.me!.role, displayName: state.me!.displayName });
    const stopClock = startClockText({ clockText: document.querySelector('.clock-text') as HTMLElement, menuButton: null, menuPanel: null }, zone);

    const buyRow = el('div', { class: 'buy-row' });
    const outcome = el('p', { class: 'buy-outcome', 'aria-live': 'off' });
    const panels = el('div', { class: 'pack-panels' });

    let pending = false;
    let resumed = false;

    const buyButtons: Record<string, HTMLButtonElement> = {};

    const press = async (hours: 10 | 20 | 40) => {
      if (pending) return;
      if (openAttempt === null || openAttempt.hours !== hours) {
        openAttempt = { key: `purchase-${state.me!.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, hours };
        sessionStorage.setItem(`purchase-attempt-${state.me!.id}`, JSON.stringify(openAttempt));
      }
      const attempt = openAttempt;
      pending = true;
      setButtonsDisabled(true);
      if (resumed) {
        outcome.textContent = '';
        resumed = false;
      }
      const r = await api('POST', '/api/packs', { body: { hours }, idempotencyKey: attempt.key });
      pending = false;
      if (r.sentUnder !== state.sessionId || destroyed) return;
      if (r.status === 201 && r.ok) {
        openAttempt = null;
        sessionStorage.removeItem(`purchase-attempt-${state.me!.id}`);
        const email = state.me!.email;
        const copy = `Pack added: ${hours} hours. Receipt on its way to ${email}.`;
        outcome.textContent = copy;
        announce(copy);
        setButtonsDisabled(false);
        await load();
        return;
      }
      const fail = r.fail;
      if (fail && fail.status === 403 && fail.body?.error === 'reauth_required') {
        setButtonsDisabled(false);
        openPasswordDialog(async () => {
          pending = true;
          setButtonsDisabled(true);
          const r2 = await api('POST', '/api/packs', { body: { hours }, idempotencyKey: attempt.key });
          pending = false;
          if (r2.sentUnder !== state.sessionId || destroyed) return;
          if (r2.status === 201 && r2.ok) {
            openAttempt = null;
            sessionStorage.removeItem(`purchase-attempt-${state.me!.id}`);
            const copy = `Pack added: ${hours} hours. Receipt on its way to ${state.me!.email}.`;
            outcome.textContent = copy;
            announce(copy);
          } else if (r2.fail && (r2.fail.status === 503)) {
            const copy = r2.fail.body?.error === 'purchase_pending'
              ? 'Payment taken, but your hours aren\'t on file yet. Press the same button again to finish; you won\'t be charged again.'
              : 'Billing is unreachable. You were not charged and no hours were added.';
            outcome.textContent = copy;
            announce(copy);
          } else {
            const copy = "Couldn't reach the kitchen. Press the same button again to finish this purchase; you won't be charged twice.";
            outcome.textContent = copy;
            announce(copy);
          }
          setButtonsDisabled(false);
          await load();
        }, () => {
          const copy = `Purchase not sent. Confirm your password to buy a ${hours}-hour pack.`;
          outcome.textContent = copy;
          announce(copy);
          openAttempt = null;
          sessionStorage.removeItem(`purchase-attempt-${state.me!.id}`);
        });
        return;
      }
      if (fail && fail.status === 503 && fail.body?.error === 'purchase_pending') {
        const copy = "Payment taken, but your hours aren't on file yet. Press the same button again to finish; you won't be charged again.";
        outcome.textContent = copy;
        announce(copy);
        setButtonsDisabled(false);
        return;
      }
      if (fail && fail.status === 409 && fail.body?.error === 'idempotency_in_progress') {
        const copy = "Your earlier press is still being recorded. Press the same button again in a moment; you won't be charged twice.";
        outcome.textContent = copy;
        announce(copy);
        setButtonsDisabled(false);
        return;
      }
      if (fail && fail.status === 503) {
        const copy = 'Billing is unreachable. You were not charged and no hours were added.';
        outcome.textContent = copy;
        announce(copy);
        setButtonsDisabled(false);
        return;
      }
      // Network failure or anything else: the attempt stays open.
      const copy = "Couldn't reach the kitchen. Press the same button again to finish this purchase; you won't be charged twice.";
      outcome.textContent = copy;
      announce(copy);
      setButtonsDisabled(false);
    };

    const setButtonsDisabled = (disabled: boolean) => {
      for (const btn of Object.values(buyButtons)) {
        if (disabled) btn.setAttribute('aria-disabled', 'true');
        else btn.removeAttribute('aria-disabled');
      }
    };

    for (const hours of [10, 20, 40] as const) {
      const btn = el('button', { class: 'btn btn-primary buy-button' }, `Buy ${hours}-hour pack`) as HTMLButtonElement;
      btn.addEventListener('click', () => void press(hours));
      buyButtons[String(hours)] = btn;
      buyRow.appendChild(btn);
    }

    const load = async () => {
      const r = await api('GET', '/api/packs');
      if (destroyed || r.status !== 200 || !r.ok) return;
      if (r.sentUnder !== state.sessionId) return;
      const data = r.ok as { packs: PackJson[] };
      clear(panels);
      data.packs.forEach((pack, index) => {
        panels.appendChild(packPanel(pack, index + 1));
      });
    };

    const packPanel = (pack: PackJson, number: number): HTMLElement => {
      const heading = el('h2', { class: 'pack-heading' }, `${pack.hours}-hour pack #${number}`);
      const balance = el('p', { class: 'pack-balance' },
        `${durationText(pack.balanceMinutes)} left of ${durationText(pack.purchasedMinutes)}`
        + (pack.heldMinutes > 0 ? ` · ${durationText(pack.heldMinutes)} on hold` : ''));
      const receipt = el('p', { class: 'pack-receipt' }, receiptLine(pack));
      const panel = el('section', { class: 'pack-panel', 'data-pack-id': pack.id }, heading, balance, receipt);
      if (pack.status === 'refunded' && pack.refundedCents !== null && pack.refundedCents !== undefined) {
        panel.appendChild(el('p', { class: 'pack-refunded' }, `Refunded $${dollars(pack.refundedCents)}`));
      }
      const table = el('table', { 'aria-label': `Ledger ${pack.hours}-hour pack #${number} ${longDateFromKey(dateKeyOf(pack.purchasedAt), zone)}`, class: 'ledger-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'When'), el('th', {}, 'Movement'), el('th', {}, 'Hours'), el('th', {}, 'Booking'))),
      ) as HTMLTableElement;
      const body = el('tbody', {});
      if (pack.entries) {
        for (const entry of pack.entries.filter((e) => e.side === 'pack')) {
          body.appendChild(el('tr', {},
            el('td', {}, timeOf(entry.createdAt)),
            el('td', {}, movementLabel(entry.movement)),
            el('td', {}, String(Math.abs(entry.minutes))),
            el('td', {}, entry.bookingId ?? ''),
          ));
        }
      }
      table.appendChild(body);
      panel.appendChild(table);
      return panel;
    };

    app.append(
      el('h1', { class: 'screen-heading' }, 'Hour packs'),
      el('div', { class: 'screen-body' }, buyRow, outcome, panels),
    );

    if (openAttempt) {
      const copy = `Your last purchase didn't finish. Press Buy ${openAttempt.hours}-hour pack again to finish it; you won't be charged twice.`;
      outcome.textContent = copy;
      announce(copy);
      resumed = true;
    }

    await load();
    timers.push(window.setInterval(() => { void load(); }, 10_000));

    return () => {
      destroyed = true;
      stopClock();
      for (const t of timers) clearInterval(t);
      removeHeader();
    };
  };

  let cleanupFn: (() => void) | null = null;
  void boot().then((fn) => { cleanupFn = fn ?? null; });
  return () => {
    destroyed = true;
    cleanupFn?.();
  };
}

function receiptLine(pack: PackJson): string {
  if (pack.receiptEmail.status === 'sent' && pack.receiptEmail.sentAt) {
    return `Receipt email: Sent ${longDateFromKey(dateKeyOf(pack.receiptEmail.sentAt), zone)} ${timeOf(pack.receiptEmail.sentAt)}`;
  }
  return 'Receipt email: Queued';
}

function dateKeyOf(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/\//g, '-');
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

function movementLabel(m: string): string {
  if (m === 'purchase') return 'Purchase';
  if (m === 'booking_debit') return 'Booking';
  if (m === 'cancellation_credit') return 'Cancellation credit';
  if (m === 'move_adjustment') return 'Move';
  return 'Refund';
}

export function openPasswordDialog(
  onConfirm: () => Promise<void> | void,
  onClose: () => void,
): void {
  const host = document.getElementById('app') as HTMLElement;
  const dialog = el('div', { role: 'dialog', 'aria-label': 'Confirm your password', class: 'modal' });
  const field = el('input', { type: 'password', 'aria-label': 'Password', class: 'dialog-input' }) as HTMLInputElement;
  const error = el('p', { class: 'field-error', hidden: '' });
  field.setAttribute('aria-describedby', '');
  const confirmBtn = el('button', { class: 'btn btn-primary' }, 'Confirm') as HTMLButtonElement;
  const closeBtn = el('button', { class: 'btn btn-ghost' }, 'Close') as HTMLButtonElement;
  const pendingCopy = el('p', { class: 'pending-copy', hidden: '' }, 'Checking password…');

  dialog.append(
    el('p', {}, 'Confirm your password to continue.'),
    field,
    error,
    pendingCopy,
    confirmBtn,
    closeBtn,
  );
  host.appendChild(dialog);
  field.focus();

  const wrap = async () => {
    confirmBtn.setAttribute('aria-disabled', 'true');
    closeBtn.setAttribute('aria-disabled', 'true');
    pendingCopy.hidden = false;
    const r = await api('POST', '/api/session/confirm', { body: { password: field.value } });
    if (r.status === 204) {
      dialog.remove();
      await onConfirm();
      return;
    }
    pendingCopy.hidden = true;
    confirmBtn.removeAttribute('aria-disabled');
    closeBtn.removeAttribute('aria-disabled');
    field.value = '';
    error.textContent = r.fail?.body?.message ?? "That password doesn't match your account.";
    error.hidden = false;
    announce(error.textContent);
    field.focus();
  };

  confirmBtn.addEventListener('click', () => void wrap());
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') void wrap(); });
  const close = () => {
    dialog.remove();
    onClose();
  };
  closeBtn.addEventListener('click', close);
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      // Tab wraps inside the dialog.
      const focusables = [field, confirmBtn, closeBtn];
      const idx = focusables.indexOf(document.activeElement as HTMLInputElement);
      e.preventDefault();
      const next = e.shiftKey ? (idx <= 0 ? focusables.length - 1 : idx - 1) : (idx === focusables.length - 1 ? 0 : idx + 1);
      focusables[next].focus();
    }
  });
}
