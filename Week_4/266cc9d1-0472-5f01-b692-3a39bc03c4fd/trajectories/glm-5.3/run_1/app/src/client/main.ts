import { loadSession } from './state.js';
import { renderSignIn } from './screens/signin.js';
import { renderCorridors } from './screens/corridors.js';
import { renderWorkspace } from './screens/workspace.js';
import { renderReview } from './screens/review.js';
import type { Staff } from './api.js';

let staff: Staff | null = null;

export function getStaff(): Staff | null {
  return staff;
}

export function setStaff(s: Staff | null): void {
  staff = s;
}

export function announce(region: string, text: string): void {
  const el = document.getElementById(region);
  if (el) el.textContent = text;
}

async function route(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  const path = location.pathname;
  if (path.startsWith('/review/')) {
    await renderReview(app, path.slice('/review/'.length));
    return;
  }
  if (!staff) {
    staff = await loadSession();
  }
  if (path === '/' || path === '') {
    if (staff) {
      location.replace('/corridors');
      return;
    }
    renderSignIn(app);
    return;
  }
  if (!staff) {
    renderSignIn(app);
    return;
  }
  if (path === '/corridors') {
    await renderCorridors(app);
    return;
  }
  const match = /^\/corridors\/([^/]+)$/.exec(path);
  if (match) {
    await renderWorkspace(app, decodeURIComponent(match[1]));
    return;
  }
  app.replaceChildren();
  const missing = document.createElement('p');
  missing.textContent = 'This page does not exist.';
  app.replaceChildren(missing);
}

window.addEventListener('popstate', () => {
  void route();
});

void route();

