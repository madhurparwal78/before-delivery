// The confirmation page confirms by its own request, then clears the token at once.

import { api } from './api.js';

const status = document.getElementById('confirmation-status');
const params = new URLSearchParams(window.location.search);
const confirmationToken = params.get('token');

window.history.replaceState({}, '', '/verify-email');

async function confirm() {
  if (!confirmationToken) {
    status.textContent = 'This confirmation link is no longer valid.';
    return;
  }
  status.textContent = 'Confirming your email…';
  let answer;
  try {
    answer = await api('/api/auth/verify-email', {
      method: 'POST', body: { token: confirmationToken }, token: null,
    });
  } catch (error) {
    status.textContent = 'Something went wrong. Try again.';
    return;
  }
  status.textContent = answer.ok
    ? 'Your email is confirmed.'
    : 'This confirmation link is no longer valid.';
}

confirm();
