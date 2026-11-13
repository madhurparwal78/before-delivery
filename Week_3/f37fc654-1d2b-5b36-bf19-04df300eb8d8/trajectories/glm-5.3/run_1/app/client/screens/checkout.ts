/** Install day, checkout and payment screens. */
import { getApp, goto, setStatus } from '../app.js';
import { api, ApiError } from '../api.js';
import { el, toast } from '../dom.js';
import type { Commission, Hold } from '../types.js';
import { money, formatDate } from '../types.js';
import type { RouteContext } from './router.js';

// ---------- Install day ----------

export async function dayScreen(ctx: RouteContext): Promise<void> {
  const app = getApp();
  app.setScene('working');
  app.main.textContent = '';
  const id = ctx.path.split('/')[2] ?? '';
  const maybeCommission = await api<Commission>(`/commissions/${id}`).catch(() => null);
  if (!maybeCommission) {
    app.main.append(el('h1', {}, 'Not found'));
    return;
  }
  const commission = maybeCommission;

  const section = el('section', { class: 'card' });
  section.append(el('h1', { class: 'page-heading' }, 'Install day'));
  section.append(el('p', { class: 'muted' }, `${commission.venue.name} — ${commission.venue.timeZone}`));

  const tz = commission.venue.timeZone;
  const todayLocal = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/\//g, '-');
  const [y0, m0] = todayLocal.split('-').map(Number);
  let year = y0 ?? 2026;
  let month = (m0 ?? 1) - 1;

  const gridWrap = el('div', { class: 'calendar-wrap' });
  const prev = el('button', { class: 'btn ghost small' }, 'Previous month');
  const next = el('button', { class: 'btn ghost small' }, 'Next month');
  const monthLabel = el('h2', { class: 'month-label' });

  const holdRegion = el('p', { class: 'muted' });
  const timer = el('p', { class: 'hold-timer', role: 'timer', 'aria-label': 'Hold time left' });

  async function renderMonth(): Promise<void> {
    const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month, 1)));
    monthLabel.textContent = monthName;
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const days = await api<{ days: Array<{ date: string; status: string }> }>(`/venues/${commission.venue.id}/days?from=${from}&to=${to}`).catch(() => null);
    const statusMap = new Map((days?.days ?? []).map((d) => [d.date, d.status]));

    const grid = el('div', { class: 'day-grid', role: 'grid', 'aria-label': monthName });
    for (const dow of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) {
      grid.append(el('span', { class: 'dow', 'aria-hidden': 'true' }, dow));
    }
    const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let i = 0; i < firstDow; i++) grid.append(el('span', {}));
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const status = statusMap.get(date) ?? 'unavailable';
      const isYours = commission.hold?.date === date && commission.hold?.status === 'held';
      const label = isYours ? 'your hold' : status;
      const cell = el('button', { class: `day day-${isYours ? 'yours' : status}`, role: 'gridcell' });
      cell.setAttribute('aria-label', `${formatDate(date)}, ${label}`);
      cell.textContent = String(d);
      cell.addEventListener('click', () => {
        if (isYours || status !== 'free') return;
        void holdDay(date);
      });
      grid.append(cell);
    }
    gridWrap.textContent = '';
    gridWrap.append(grid);
    await renderHold();
  }

  async function renderHold(): Promise<void> {
    const hold = await api<Hold>(`/commissions/${id}/hold`).catch(() => null);
    if (!hold || hold.status !== 'held') {
      holdRegion.textContent = 'No hold right now.';
      timer.textContent = '';
      return;
    }
    holdRegion.textContent = `Held ${formatDate(hold.date)}. Finish checkout before the timer runs out.`;
    startCountdown(hold);
  }

  let countdownTimer: number | null = null;
  function startCountdown(hold: Hold): void {
    if (countdownTimer) window.clearInterval(countdownTimer);
    const anchor = { remaining: hold.secondsRemaining, at: performance.now() };
    const sync = async (): Promise<void> => {
      const fresh = await api<Hold>(`/commissions/${id}/hold`).catch(() => null);
      if (fresh) {
        anchor.remaining = fresh.secondsRemaining;
        anchor.at = performance.now();
      }
    };
    const tick = (): void => {
      const elapsed = (performance.now() - anchor.at) / 1000;
      const remaining = Math.max(0, anchor.remaining - elapsed);
      const m = Math.floor(remaining / 60);
      const ss = Math.floor(remaining % 60);
      timer.textContent = `${m}:${String(ss).padStart(2, '0')} left`;
      if (remaining <= 0) {
        void sync();
      }
    };
    tick();
    countdownTimer = window.setInterval(tick, 1000);
    window.setInterval(() => void sync(), 30_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void sync();
    });
  }

  async function holdDay(date: string): Promise<void> {
    try {
      const hold = await api<Hold>(`/commissions/${id}/hold`, { method: 'POST', body: { date } });
      setStatus(app.statusRegions.hold, `Held ${formatDate(hold.date)}. Finish checkout before the timer runs out.`);
      const fresh = await api<Commission>(`/commissions/${id}`);
      commission.hold = fresh.hold;
      await renderMonth();
    } catch (e) {
      if (e instanceof ApiError) {
        const next = e.extra['nextFreeDays'];
        if (Array.isArray(next)) {
          const names = next.map((d) => formatDate(String(d)));
          if (names.length === 0) {
            setStatus(app.statusRegions.hold, 'That day was just taken. There are no free days in the next year.');
          } else if (names.length === 1) {
            setStatus(app.statusRegions.hold, `That day was just taken. The next free days are ${names[0]}.`);
          } else if (names.length === 2) {
            setStatus(app.statusRegions.hold, `That day was just taken. The next free days are ${names[0]} and ${names[1]}.`);
          } else {
            setStatus(app.statusRegions.hold, `That day was just taken. The next free days are ${names[0]}, ${names[1]} and ${names[2]}.`);
          }
        } else {
          setStatus(app.statusRegions.hold, e.message || 'That day was just taken.');
        }
      }
    }
  }

  prev.addEventListener('click', () => {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
    void renderMonth();
  });
  next.addEventListener('click', () => {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    void renderMonth();
  });

  const release = el('button', { class: 'btn ghost' }, 'Release hold');
  release.addEventListener('click', async () => {
    await api(`/commissions/${id}/hold`, { method: 'DELETE' }).catch(() => undefined);
    await renderMonth();
  });

  section.append(monthLabel, prev, next, gridWrap, holdRegion, timer, release);
  app.main.append(section);
  await renderMonth();
}

// ---------- Checkout ----------

export async function checkoutScreen(ctx: RouteContext): Promise<void> {
  const app = getApp();
  app.setScene('working');
  app.main.textContent = '';
  const id = ctx.path.split('/')[2] ?? '';
  const maybeCommission = await api<Commission>(`/commissions/${id}`).catch(() => null);
  if (!maybeCommission) {
    app.main.append(el('h1', {}, 'Not found'));
    return;
  }
  const commission = maybeCommission;

  const section = el('section', { class: 'card' });
  section.append(el('h1', { class: 'page-heading' }, 'Checkout'));
  section.append(el('p', { class: 'muted' }, `${commission.title} — ${commission.venue.name}`));

  // Review: quote lines, payment schedule, funders.
  const review = el('div', { class: 'review' });
  review.append(el('h2', {}, 'Review'));
  if (commission.quote) {
    for (const line of commission.quote.lines) {
      const row = el('div', { class: 'quote-line' });
      row.append(el('span', {}, line.label), el('span', {}, money(line.amountCents)));
      review.append(row);
    }
    review.append(el('p', { class: 'quote-total' }, money(commission.quote.totalCents)));
  }
  review.append(el('h2', {}, 'Payment schedule'));
  for (const m of commission.milestones) {
    review.append(el('p', { class: 'muted' }, `${m.label} — ${money(m.amountCents)}`));
  }
  review.append(el('h2', {}, 'Funders'));
  for (const f of commission.funders) {
    review.append(el('p', { class: 'muted' }, `${f.name ?? f.kind} — ${(f.bp / 100).toFixed(2)}% — ${money(f.amountCents ?? 0)}`));
  }
  section.append(review);

  // Countdown from the server's remaining time.
  const timer = el('p', { class: 'hold-timer', role: 'timer', 'aria-label': 'Hold time left' });
  section.append(timer);

  // Signature form.
  const sigName = el('input', { type: 'text', class: 'answer-field', placeholder: 'Full name as signature' });
  sigName.setAttribute('aria-label', 'Full name as signature');
  const agree = el('input', { type: 'checkbox', id: 'agree-terms' });
  agree.setAttribute('aria-label', 'I agree to the commission agreement');
  const agreeLabel = el('label', { class: 'chip-wrap', for: 'agree-terms' }, 'I agree to the commission agreement');
  agreeLabel.prepend(agree);
  const signBtn = el('button', { class: 'btn primary' }, 'Sign agreement');
  const signRow = el('div', { class: 'field-row' });
  signRow.append(sigName, agreeLabel, signBtn);
  section.append(signRow);

  // Pay deposit button + sheet.
  const deposit = commission.milestones.find((m) => m.label === 'Deposit');
  const payBtn = el('button', { class: 'btn primary' }, deposit ? `Pay deposit ${money(deposit.amountCents)}` : 'Pay deposit');
  payBtn.setAttribute('aria-haspopup', 'dialog');
  section.append(payBtn);

  let signed = false;
  signBtn.addEventListener('click', async () => {
    try {
      await api(`/commissions/${id}/sign`, { method: 'POST', body: { signatureName: sigName.value, acceptTerms: agree.checked } });
      signed = true;
      toast('Agreement signed. Your contract PDF is being prepared.');
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'quote_expired') toast('This quote has expired. Refresh the quote to continue.');
        else toast(e.message || 'Could not sign.');
      }
    }
  });

  const sheetBuild = (container: HTMLElement, close: () => void): void => {
    const nameOnCard = el('input', { type: 'text', class: 'answer-field', placeholder: 'Name on card' });
    nameOnCard.setAttribute('aria-label', 'Name on card');
    const cardNumber = el('input', { type: 'text', class: 'answer-field', placeholder: 'Card number', inputmode: 'numeric', autocomplete: 'off' });
    cardNumber.setAttribute('aria-label', 'Card number');
    const note = el('p', { class: 'muted small' }, 'Test mode — no real card is charged.');
    const pay = el('button', { class: 'btn primary' }, deposit ? `Pay ${money(deposit.amountCents)}` : 'Pay');
    const cancel = el('button', { class: 'btn ghost' }, 'Cancel');
    const status = app.statusRegions.payment;
    container.setAttribute('aria-label', 'Payment');
    let attempt = 0;
    let attemptKey: string | null = null;
    pay.addEventListener('click', async () => {
      attempt += 1;
      if (attemptKey === null) {
        attemptKey = `pay-${id}-${attempt}-${Date.now()}`;
      }
      setStatus(status, 'Confirming payment with the billing system...');
      try {
        const result = await api<{ paymentId: string; amountCents: number }>(`/milestones/${deposit?.id ?? ''}/payments`, {
          method: 'POST',
          body: { nameOnCard: nameOnCard.value, cardNumber: cardNumber.value },
          idempotencyKey: attemptKey,
        });
        setStatus(status, `Paid ${money(result.amountCents)}. Your receipt is on its way.`);
        toast('Deposit paid.');
        close();
        const fresh = await api<Commission>(`/commissions/${id}`);
        await goto(`/c/${id}`);
        void fresh;
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.code === 'hold_expired') {
            setStatus(status, 'Your hold on that day has ended. Pick a day again to finish — your details are still here.');
            attemptKey = null;
            return;
          }
          if (e.code === 'quote_expired') {
            setStatus(status, 'This quote has expired. Refresh the quote to continue.');
            attemptKey = null;
            return;
          }
          if (e.code === 'already_paid') {
            setStatus(status, 'This is already paid.');
            return;
          }
          if (e.code === 'idempotency_conflict') {
            setStatus(status, 'This payment key was already used for a different payment. Close this sheet and try again.');
            return;
          }
          if (e.code === 'payment_failed') {
            setStatus(status, "The payment didn't go through. Nothing has been charged.");
            attemptKey = null;
            return;
          }
          setStatus(status, e.message || "The payment didn't go through. Nothing has been charged.");
          attemptKey = null;
        }
      }
    });
    cancel.addEventListener('click', () => close());
    container.append(nameOnCard, cardNumber, note, pay, cancel);
  };

  payBtn.addEventListener('click', () => {
    openSheet(sheetBuild, payBtn);
  });

  await refreshCountdown();
  async function refreshCountdown(): Promise<void> {
    const hold = await api<Hold>(`/commissions/${id}/hold`).catch(() => null);
    if (!hold) {
      timer.textContent = 'No hold. Pick a day first.';
      return;
    }
    if (hold.status !== 'held') {
      renderHoldEnded(section, id, hold.date);
      return;
    }
    startCountdown(timer, hold, id);
  }

  app.main.append(section);
}

function startCountdown(timer: HTMLElement, hold: Hold, commissionId: string): void {
  const anchor = { remaining: hold.secondsRemaining, at: performance.now() };
  const sync = async (): Promise<void> => {
    const fresh = await api<Hold>(`/commissions/${commissionId}/hold`).catch(() => null);
    if (fresh) {
      anchor.remaining = fresh.secondsRemaining;
      anchor.at = performance.now();
      if (fresh.status !== 'held') {
        renderHoldEnded(timer.parentElement ?? timer, commissionId, fresh.date);
      }
    }
  };
  window.setInterval(() => {
    const elapsed = (performance.now() - anchor.at) / 1000;
    const remaining = Math.max(0, anchor.remaining - elapsed);
    const m = Math.floor(remaining / 60);
    const ss = Math.floor(remaining % 60);
    timer.textContent = `${m}:${String(ss).padStart(2, '0')} left`;
    if (remaining <= 0) {
      void sync();
    }
  }, 1000);
  window.setInterval(() => void sync(), 30_000);
}

function renderHoldEnded(container: HTMLElement, commissionId: string, date: string): void {
  const existing = container.querySelector('.hold-ended');
  existing?.remove();
  const wrap = el('div', { class: 'hold-ended card' });
  const heading = el('h2', {}, 'Your hold has ended');
  const again = el('button', { class: 'btn primary' }, `Hold ${formatDate(date)} again`);
  again.addEventListener('click', async () => {
    try {
      await api(`/commissions/${commissionId}/hold`, { method: 'POST', body: { date } });
      window.location.reload();
    } catch {
      toast('That day was just taken.');
    }
  });
  const status = getApp().statusRegions.hold;
  setStatus(status, `Your hold on ${formatDate(date)} has ended. Pick a day again to finish — your details are still here.`);
  wrap.append(heading, again);
  container.append(wrap);
}

function openSheet(build: (container: HTMLElement, close: () => void) => void, opener: HTMLElement): void {
  const app = getApp();
  const backdrop = el('div', { class: 'dialog-backdrop' });
  const sheet = el('div', { class: 'dialog payment-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Payment' });
  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    opener.focus();
  };
  build(sheet, close);
  backdrop.append(sheet);
  document.body.append(backdrop);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    if (e.key === 'Tab') {
      const focusables = Array.from(sheet.querySelectorAll<HTMLElement>('button, input'));
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey);
  const first = sheet.querySelector<HTMLElement>('input');
  first?.focus();
  void app;
}
