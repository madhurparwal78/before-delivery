import { call } from './modules/api.js';
import { COPY } from './modules/copy.js';
import { el } from './modules/dom.js';

interface VerifyAnswer {
  signed_in: boolean;
  email: string;
  confirmed: boolean;
}

const status = el('link-status');
const token = new URL(window.location.href).searchParams.get('token');

/** The link is checked once, as soon as the page loads, and never again on its own. */
async function checkLink(): Promise<void> {
  status.textContent = COPY.linkPending;
  if (!token) {
    status.textContent = COPY.linkUnknown;
    return;
  }
  const answer = await call<VerifyAnswer>('POST', '/api/session/verify', { body: { token } });
  if (answer.status === 200 && answer.data) {
    status.textContent = answer.data.confirmed ? COPY.linkConfirmed : COPY.linkSignedIn;
    return;
  }
  if (answer.status === 503) {
    status.textContent = COPY.unavailable;
    return;
  }
  const code = answer.error?.code;
  if (code === 'link_used') status.textContent = COPY.linkUsed;
  else if (code === 'link_expired') status.textContent = COPY.linkExpired;
  else status.textContent = COPY.linkUnknown;
}

void checkLink();
