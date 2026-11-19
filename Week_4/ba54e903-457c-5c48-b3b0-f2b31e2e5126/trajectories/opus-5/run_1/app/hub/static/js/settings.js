// Account settings: the session, the tier, the status and logging out.

import { api, clearToken, encodeNext, token } from './api.js';

const signedIn = document.getElementById('signed-in-as');
const tierLine = document.getElementById('current-tier');
const statusSelect = document.getElementById('status-select');
const logOut = document.getElementById('log-out');
const TIER_NAMES = { free: 'Free', basic: 'Basic', max: 'Max' };

function toLogin() {
  window.location.replace('/login?next=' + encodeNext('/settings'));
}

async function load() {
  if (!token()) {
    toLogin();
    return;
  }
  const answer = await api('/api/users/@me');
  if (!answer.ok) {
    clearToken();
    toLogin();
    return;
  }
  signedIn.textContent = 'Signed in as ' + answer.data.email;
  tierLine.textContent = 'Current tier: ' + TIER_NAMES[answer.data.tier];
  statusSelect.value = answer.data.status;
}

statusSelect.addEventListener('change', () => {
  api('/api/users/@me', { method: 'PATCH', body: { status: statusSelect.value } });
});

logOut.addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  clearToken();
  for (const key of Object.keys(window.sessionStorage)) {
    if (key.startsWith('hub_draft:')) window.sessionStorage.removeItem(key);
  }
  window.location.replace('/login');
});

load();
