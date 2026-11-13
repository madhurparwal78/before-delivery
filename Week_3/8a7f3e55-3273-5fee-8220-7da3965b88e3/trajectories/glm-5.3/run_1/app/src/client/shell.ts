// The browser shell: frame, sign-in, routing, polling, live regions and the dialog host.
import type { AgencyInfo, Booking, MeInfo } from '../shared/api.js';
import { Api, ApiFailure, NetworkFailure, newIdempotencyKey } from './api.js';
import { h } from './dom.js';
import { ERROR_COPY, PENDING_COPY, invalidTransitionCopy } from './copy.js';
import { renderCoordinatorBoard } from './coordinator.js';
import { renderInterpreterHome } from './interpreter.js';
import { renderRequesterHome } from './requester.js';
import { renderBillingHome } from './billing.js';
import { STATUS_LABELS } from '../shared/terms.js';

export const api = new Api();

export interface App {
  me: MeInfo | null;
  agency: AgencyInfo | null;
  statusRegion: HTMLElement;
  errorRegion: HTMLElement;
  main: HTMLElement;
  pendingAction: null | { replay: () => void };
  refreshTimer: number | null;
}

export const app: App = {
  me: null,
  agency: null,
  statusRegion: h('div', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Action status', class: 'live-region', id: 'action-status' }),
  errorRegion: h('div', { role: 'alert', 'aria-label': 'Action error', class: 'live-region', id: 'action-error' }),
  main: h('div', { class: 'layout', id: 'main' }),
  pendingAction: null,
  refreshTimer: null,
};

function announce(region: HTMLElement, text: string): void {
  region.textContent = '';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      region.textContent = text;
    });
  });
}

export function announceStatus(text: string): void {
  announce(app.statusRegion, text);
}

export function announceError(text: string): void {
  announce(app.errorRegion, text);
}

export function clearStatus(): void {
  app.statusRegion.textContent = '';
}

export function clearError(): void {
  app.errorRegion.textContent = '';
}

export function errorCopyFor(err: ApiFailure): string {
  if (err.code === 'invalid_transition') {
    const status = err.body.status ?? '';
    return invalidTransitionCopy(STATUS_LABELS[status] ?? status);
  }
  if (err.code === 'already_holding') {
    return app.me?.role === 'interpreter' ? ERROR_COPY.already_holding_claim : ERROR_COPY.already_holding_assign;
  }
  if (err.code === 'schedule_conflict') {
    return app.me?.role === 'interpreter' ? ERROR_COPY.schedule_conflict_claim : ERROR_COPY.schedule_conflict_assign;
  }
  if (err.code === 'open_call_closed') {
    return app.me?.role === 'interpreter' ? ERROR_COPY.open_call_closed_claim : ERROR_COPY.open_call_closed_board;
  }
  if (err.code === 'rate_would_reprice') {
    const allowed = err.body.earliest_allowed;
    return allowed
      ? `That date would reprice billed work. Choose a date on or after ${allowed}.`
      : ERROR_COPY.rate_would_reprice;
  }
  if (err.code === 'storage_unavailable') {
    return app.me?.role === 'interpreter' ? ERROR_COPY.storage_unavailable : ERROR_COPY.storage_unavailable_upload;
  }
  if (err.code === 'validation') {
    return ERROR_COPY.validation;
  }
  return ERROR_COPY[err.code] ?? ERROR_COPY.network;
}

export function boot(): void {
  const root = document.getElementById('app')!;
  document.body.append(app.statusRegion, app.errorRegion);
  root.append(app.main);
  void start();
}

async function start(): Promise<void> {
  try {
    app.agency = await api.call<AgencyInfo>('/api/agency');
  } catch {
    app.agency = null;
  }
  try {
    app.me = await api.call<MeInfo>('/api/me');
  } catch {
    app.me = null;
  }
  const deepLink = /^\/bookings\/([\w-]+)$/.exec(window.location.pathname);
  if (app.me !== null && deepLink) {
    await openDeepLink(deepLink[1]);
    return;
  }
  renderHome();
}

export function renderHome(): void {
  stopRefresh();
  app.main.replaceChildren();
  if (app.me === null) {
    renderSignIn();
    return;
  }
  const role = app.me.role;
  if (role === 'billing_manager') {
    renderBillingHome();
  } else if (role === 'coordinator') {
    void renderCoordinatorBoard();
  } else if (role === 'interpreter') {
    void renderInterpreterHome();
  } else {
    void renderRequesterHome();
  }
}

/** A booking deep link opens that booking's detail for the caller's role. */
export async function openDeepLink(bookingId: string): Promise<void> {
  const role = app.me?.role ?? '';
  if (role === 'billing_manager') {
    renderBillingHome();
    return;
  }
  let booking: Booking | null = null;
  try {
    booking = await api.call<Booking>(`/api/bookings/${encodeURIComponent(bookingId)}`);
  } catch {
    booking = null;
  }
  if (booking === null) {
    app.main.replaceChildren(renderHeader(), h('div', { class: 'not-available' }, "That booking isn't available to you."));
    return;
  }
  if (role === 'coordinator') {
    await renderCoordinatorBoard();
    const row = document.querySelector<HTMLElement>(`button.row[data-booking-id="${booking!.id}"]`);
    if (row) {
      row.click();
      return;
    }
    // the booking is not on today's board: switch the board day to its own
    const { setBoardDay } = await import('./coordinator.js');
    setBoardDay(booking!.start.slice(0, 10));
    return;
  }
  if (role === 'interpreter') {
    await renderInterpreterHome();
    return;
  }
  await renderRequesterHome();
  const row = document.querySelector<HTMLElement>(`button.row[data-booking-id="${booking!.id}"]`);
  if (row) row.click();
}

function renderSignIn(): void {
  app.main.replaceChildren();
  const wrap = h('div', { class: 'sign-in-wrap' });
  const form = h('form', { 'aria-label': 'Sign in' });
  const email = h('input', { type: 'email', 'aria-label': 'Email', name: 'email', autocomplete: 'username' });
  const password = h('input', { type: 'password', 'aria-label': 'Password', name: 'password', autocomplete: 'current-password' });
  const fieldError = h('div', { class: 'field-error', 'aria-live': 'polite' });
  const submit = h('button', { type: 'submit' }, 'Sign in');
  form.append(
    h('h1', {}, 'Relayline'),
    h('label', {}, 'Email'),
    email,
    h('label', {}, 'Password'),
    password,
    fieldError,
    submit,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = PENDING_COPY.signIn;
    announceStatus(PENDING_COPY.signIn);
    clearError();
    try {
      const result = await api.call<{ user: MeInfo }>('/api/session', {
        method: 'POST',
        body: { email: email.value, password: password.value },
      });
      app.me = result.user;
      renderHome();
    } catch (err) {
      submit.disabled = false;
      submit.textContent = 'Sign in';
      if (err instanceof ApiFailure) {
        fieldError.textContent = errorCopyFor(err);
        announceError(errorCopyFor(err));
        password.value = '';
        password.focus();
      } else if (err instanceof NetworkFailure) {
        announceError(ERROR_COPY.network);
        submit.disabled = false;
        submit.textContent = 'Sign in';
      }
      return;
    }
  });
  wrap.append(form);
  app.main.append(wrap);
  email.focus();
}

export function stopRefresh(): void {
  if (app.refreshTimer !== null) {
    clearInterval(app.refreshTimer);
    app.refreshTimer = null;
  }
}

export function startRefresh(fn: () => void): void {
  stopRefresh();
  app.refreshTimer = window.setInterval(fn, 10_000);
}

export function renderHeader(): HTMLElement {
  const header = h('header', { class: 'frame-header' });
  const nav = h('nav', { 'aria-label': 'Main' });
  nav.append(h('span', { class: 'product' }, 'Relayline'));
  header.append(nav);
  header.append(h('span', { class: 'who' }, `Signed in as ${app.me?.name ?? ''} · ${roleLabel(app.me?.role ?? '')}`));
  if (app.agency) {
    header.append(h('span', { class: 'tz' }, `Times in ${app.agency.time_zone}`));
  }
  const signOut = h('button', {}, 'Sign out');
  signOut.addEventListener('click', async () => {
    try {
      await api.call('/api/session', { method: 'DELETE' });
    } catch {
      // Signing out proceeds; the session cookie is no longer usable.
    }
    app.me = null;
    window.history.replaceState(null, '', '/');
    renderHome();
  });
  header.append(signOut);
  return header;
}

export function roleLabel(role: string): string {
  switch (role) {
    case 'coordinator': return 'Dispatch coordinator';
    case 'interpreter': return 'Staff interpreter';
    case 'requester': return 'Client requester';
    case 'billing_manager': return 'Billing manager';
    default: return role;
  }
}

export { newIdempotencyKey, ApiFailure, NetworkFailure };
