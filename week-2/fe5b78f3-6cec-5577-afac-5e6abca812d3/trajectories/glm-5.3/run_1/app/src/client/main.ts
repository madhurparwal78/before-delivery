// Pakka Rail client entry: the router and the business clock.

import { fetchClock, businessNowMs } from './api.js';
import { renderSearch } from './search.js';
import { renderResults } from './results.js';
import { renderBooking } from './booking.js';
import { renderBookingDetail } from './detail.js';
import { renderMyBookings, renderPnrStatus, renderPageNotFound } from './misc.js';
import { renderAuth } from './auth.js';
import { loadAccount } from './ui.js';

declare global {
  interface Window {
    __pakkaClockRate?: number;
  }
}

async function route(): Promise<void> {
  const path = location.pathname;
  await loadAccount();

  if (path === '/' || path === '') return renderSearch();
  if (path === '/trains') return renderResults();
  if (path.startsWith('/book') && !path.startsWith('/bookings')) return renderBooking();
  if (path === '/bookings') return renderMyBookings();
  const bookingMatch = /^\/bookings\/(\d{10})$/.exec(path);
  if (bookingMatch) return renderBookingDetail(bookingMatch[1]);
  const bookingBad = /^\/bookings\/[^/]+$/.exec(path);
  if (bookingBad) {
    const { renderBookingNotFound } = await import('./misc.js');
    return renderBookingNotFound();
  }
  if (path === '/pnr') return renderPnrStatus(null);
  const pnrMatch = /^\/pnr\/(\d{10})$/.exec(path);
  if (pnrMatch) return renderPnrStatus(pnrMatch[1]);
  if (path === '/signin') return renderAuth('signin');
  if (path === '/register') return renderAuth('register');
  return renderPageNotFound();
}

async function boot(): Promise<void> {
  try {
    const c = await fetchClock();
    window.__pakkaClockRate = c.rate;
    // keep the business clock fresh for long-lived screens
    window.setInterval(() => {
      void fetchClock();
    }, 30_000);
  } catch {
    // the server is unreachable; screens will fall back to their own retries
  }
  await route();
}

window.addEventListener('popstate', () => {
  void route();
});

boot();

void businessNowMs;
