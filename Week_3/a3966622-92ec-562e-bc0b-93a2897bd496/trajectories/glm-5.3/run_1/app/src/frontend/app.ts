// The app entry point. Routing is by path; an unknown path or a record the
// user may not read shows the not-found page.

import { clear } from './dom.js';
import { loadSession, notFoundPage, moveToRoleScreen } from './chrome.js';
import { renderBoard } from './board.js';
import { renderOrders } from './orders.js';
import { renderPilot } from './pilot.js';
import { renderMoveDetail } from './move-detail.js';
import { renderAccounts, renderInvoice, renderLogin, renderReport } from './screens.js';

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  clear(app);

  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);

  if (path === '/login') {
    await renderLogin(app);
    return;
  }

  const user = await loadSession();
  if (!user) {
    window.location.href = '/login';
    return;
  }

  if (path === '/' || path === '') {
    moveToRoleScreen(user);
    return;
  }

  if (path === '/board') {
    if (user.role !== 'dispatcher') {
      app.append(notFoundPage());
      return;
    }
    await renderBoard(app, user, { move: params.get('move'), q: params.get('q') ?? '' });
    return;
  }

  if (path === '/orders') {
    if (user.role !== 'agent') {
      app.append(notFoundPage());
      return;
    }
    await renderOrders(app, user, { q: params.get('q') ?? '' });
    return;
  }

  if (path === '/pilot') {
    if (user.role !== 'pilot') {
      app.append(notFoundPage());
      return;
    }
    await renderPilot(app, user);
    return;
  }

  if (path === '/accounts') {
    if (user.role !== 'clerk') {
      app.append(notFoundPage());
      return;
    }
    await renderAccounts(app, user);
    return;
  }

  const moveMatch = /^\/moves\/([^/]+)$/.exec(path);
  if (moveMatch) {
    await renderMoveDetail(app, user, moveMatch[1]!);
    return;
  }

  const reportMatch = /^\/reports\/([^/]+)$/.exec(path);
  if (reportMatch) {
    await renderReport(app, user, reportMatch[1]!);
    return;
  }

  const invoiceMatch = /^\/invoices\/([^/]+)$/.exec(path);
  if (invoiceMatch) {
    await renderInvoice(app, user, invoiceMatch[1]!);
    return;
  }

  app.append(notFoundPage());
}

void main();
