import { api, formatPrice, type Session } from '../api.ts';
import { shell, openDialog, closeDialog, errorSummary, clearErrorSummary, notice, newIdempotencyKey, isApiFailure } from '../shell.ts';

/** Sessions: the list refreshes every 30 seconds and after every booking. */

export async function initSessionsPage(): Promise<void> {
  await refreshSessions();
  window.setInterval(() => void refreshSessions(), 30_000);

  const dialog = document.querySelector<HTMLDialogElement>('#dialog-book');
  if (dialog) wireBookingDialog(dialog);
}

let currentSessions: Session[] = [];

async function refreshSessions(): Promise<void> {
  const grid = document.querySelector<HTMLElement>('[data-role="sessions-grid"]');
  if (!grid) return;
  try {
    const data = await api.get<{ sessions: Session[] }>('/api/sessions');
    currentSessions = data.sessions;
  } catch {
    return;
  }
  renderSessions(grid);
}

function renderSessions(grid: HTMLElement): void {
  grid.textContent = '';
  for (const session of currentSessions) {
    const card = document.createElement('article');
    card.className = 'session-card';
    card.dataset['sessionCard'] = session.id;
    card.setAttribute('tabindex', '-1');
    const title = document.createElement('h3');
    title.textContent = session.title;
    const time = document.createElement('div');
    time.className = 'muted';
    time.textContent = session.starts_at_display;
    const duration = document.createElement('div');
    duration.className = 'muted';
    duration.textContent = `${session.duration_minutes} minutes`;
    const statusLine = document.createElement('div');
    statusLine.className = 'lines';
    const statusText =
      session.status === 'on_sale' ? 'On sale' : session.status === 'closed' ? 'Closed' : session.status === 'held' ? 'Held' : 'Cancelled';
    statusLine.textContent = statusText;
    const seats = document.createElement('div');
    seats.className = 'lines';
    seats.textContent = session.seats_left === 1 ? '1 seat left' : `${session.seats_left} seats left`;
    const price = document.createElement('div');
    price.className = 'lines';
    if (session.price_minor !== undefined && session.currency) {
      price.textContent = `${formatPrice(session.price_minor, session.currency)} a seat`;
    } else {
      price.textContent = 'Prices are unavailable right now.';
    }
    card.append(title, time, duration, statusLine, seats, price);
    if (session.status === 'on_sale') {
      const button = document.createElement('button');
      button.textContent = `Book ${session.title}`;
      button.addEventListener('click', () => {
        openBookingDialog(session, button);
      });
      card.appendChild(button);
    }
    grid.appendChild(card);
  }
}

function openBookingDialog(session: Session, opener: HTMLButtonElement): void {
  const dialog = document.querySelector<HTMLDialogElement>('#dialog-book');
  if (!dialog) return;
  clearErrorSummary(dialog);
  const titleEl = dialog.querySelector<HTMLElement>('[data-role="book-title"]');
  if (titleEl) titleEl.textContent = session.title;
  const seats = dialog.querySelector<HTMLInputElement>('[data-role="book-seats"]');
  if (seats) seats.value = '1';
  const card = dialog.querySelector<HTMLInputElement>('[data-role="book-card"]');
  if (card) card.value = '';
  (dialog as HTMLDialogElement & { _session?: Session; _opener?: HTMLElement })._session = session;
  (dialog as HTMLDialogElement & { _session?: Session; _opener?: HTMLElement })._opener = opener;

  // The currency radios start on the card currency; other currencies are
  // disabled when the buyer's Kill Bill account currency is fixed.
  void api.get<{ membership: { currency: string; status: string } | null }>('/api/me/membership').then((res) => {
    let lockedCurrency: string | null = null;
    if (res.membership && res.membership.status !== 'cancelled') lockedCurrency = res.membership.currency;
    let startCurrency = lockedCurrency ?? 'EUR';
    for (const radio of Array.from(dialog.querySelectorAll<HTMLInputElement>('[data-role="book-currency"]'))) {
      const value = radio.value;
      const locked = lockedCurrency !== null && value !== lockedCurrency;
      radio.disabled = locked;
      const label = dialog.querySelector(`[data-currency-label="${value}"]`);
      if (label) {
        label.classList.toggle('muted', locked);
        label.textContent = locked ? `${value} — your supporter account pays in ${lockedCurrency}` : value;
      }
      radio.checked = value === startCurrency;
    }
    updateBookingPrice(dialog);
  }).catch(() => {
    for (const radio of Array.from(dialog.querySelectorAll<HTMLInputElement>('[data-role="book-currency"]'))) {
      radio.disabled = false;
      radio.checked = radio.value === 'EUR';
    }
    updateBookingPrice(dialog);
  });

  for (const radio of Array.from(dialog.querySelectorAll<HTMLInputElement>('[data-role="book-currency"]'))) {
    radio.addEventListener('change', () => updateBookingPrice(dialog));
  }
  const seatsInput = dialog.querySelector<HTMLInputElement>('[data-role="book-seats"]');
  seatsInput?.addEventListener('input', () => updateBookingPrice(dialog));

  openDialog('dialog-book', opener);
  updateBookingPrice(dialog);
}

function updateBookingPrice(dialog: HTMLDialogElement): void {
  const session = (dialog as HTMLDialogElement & { _session?: Session })._session;
  const seats = Number(dialog.querySelector<HTMLInputElement>('[data-role="book-seats"]')?.value ?? 1);
  const currency = dialog.querySelector<HTMLInputElement>('[data-role="book-currency"]:checked')?.value ?? 'EUR';
  const status = dialog.querySelector<HTMLElement>('[data-role="booking-price"]');
  if (!status || !session) return;
  const price = (session.price_minor ?? 1200) * seats;
  status.textContent = seats === 1 ? `${formatPrice(price, currency)} for 1 seat` : `${formatPrice(price, currency)} for ${seats} seats`;
}

function wireBookingDialog(dialog: HTMLDialogElement): void {
  const form = dialog.querySelector<HTMLFormElement>('form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const session = (dialog as HTMLDialogElement & { _session?: Session })._session;
    if (!session) return;
    const payButton = dialog.querySelector<HTMLButtonElement>('[data-role="pay-and-book"]');
    if (!payButton) return;
    payButton.disabled = true;
    notice('Processing payment, please wait.');
    const seats = Number(dialog.querySelector<HTMLInputElement>('[data-role="book-seats"]')?.value ?? 1);
    const currency = dialog.querySelector<HTMLInputElement>('[data-role="book-currency"]:checked')?.value ?? 'EUR';
    const card = dialog.querySelector<HTMLInputElement>('[data-role="book-card"]')?.value ?? '';
    const key = (dialog as HTMLDialogElement & { _key?: string })._key ?? newIdempotencyKey();
    (dialog as HTMLDialogElement & { _key?: string })._key = key;
    try {
      const res = await api.post<{ booking: { ticket_code: string }; order: unknown; receipt_email: string }>(
        `/api/sessions/${session.id}/bookings`,
        { seats, currency, card_number: card },
        key,
      );
      // The dialog content becomes the confirmation.
      const body = dialog.querySelector<HTMLElement>('[data-role="book-form-body"]');
      const confirm = dialog.querySelector<HTMLElement>('[data-role="book-confirmation"]');
      if (body) body.hidden = true;
      if (confirm) {
        confirm.hidden = false;
        const heading = confirm.querySelector<HTMLHeadingElement>('h2');
        const line = confirm.querySelector<HTMLElement>('[data-role="confirmation-line"]');
        if (heading) {
          heading.textContent = "You're booked";
          heading.setAttribute('tabindex', '-1');
          heading.focus();
        }
        if (line) {
          line.textContent = `${session.title}, ${session.starts_at_display}. Ticket ${res.booking.ticket_code}.`;
        }
        notice(seats === 1 ? `Booked 1 seat for ${session.title}.` : `Booked ${seats} seats for ${session.title}.`);
      }
      await refreshSessions();
    } catch (e) {
      if (isApiFailure(e)) {
        errorSummary(dialog, e.message, e.fields);
        notice(e.message);
      } else {
        errorSummary(dialog, 'Something went wrong.');
      }
    } finally {
      payButton.disabled = false;
    }
  });

  const doneButton = dialog.querySelector<HTMLButtonElement>('[data-role="book-done"]');
  doneButton?.addEventListener('click', () => {
    const session = (dialog as HTMLDialogElement & { _session?: Session })._session;
    closeDialog('dialog-book');
    // Done returns focus to that session's Book button, or its card when gone.
    const opener = (dialog as HTMLDialogElement & { _opener?: HTMLElement })._opener;
    if (opener && document.contains(opener) && !opener.hidden) {
      opener.focus();
      return;
    }
    const card = session ? document.querySelector<HTMLElement>(`[data-session-card="${session.id}"]`) : null;
    if (card) card.focus();
    const body = dialog.querySelector<HTMLElement>('[data-role="book-form-body"]');
    const confirm = dialog.querySelector<HTMLElement>('[data-role="book-confirmation"]');
    if (body) body.hidden = false;
    if (confirm) confirm.hidden = true;
  });

  for (const closeBtn of Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-close]'))) {
    closeBtn.addEventListener('click', () => {
      const session = (dialog as HTMLDialogElement & { _session?: Session })._session;
      const opener = (dialog as HTMLDialogElement & { _opener?: HTMLElement })._opener;
      closeDialog('dialog-book');
      if (opener && document.contains(opener) && !opener.hidden) {
        opener.focus();
        return;
      }
      const card = session ? document.querySelector<HTMLElement>(`[data-session-card="${session.id}"]`) : null;
      if (card) card.focus();
    });
  }

  void shell;
  void closeDialog;
}
