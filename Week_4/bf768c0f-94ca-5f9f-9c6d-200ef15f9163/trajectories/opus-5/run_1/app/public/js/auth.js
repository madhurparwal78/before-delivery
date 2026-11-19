/** Signing in and joining: refusals land beside the field that failed. */

import { api, fieldError } from './app.js';

const login = document.getElementById('login-form');
login?.addEventListener('submit', async (event) => {
  event.preventDefault();
  fieldError('login-error', '');
  fieldError('login-username-error', '');
  fieldError('login-password-error', '');
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  if (!username) {
    fieldError('login-username-error', 'Your username or email, please.');
    document.getElementById('login-username').focus();
    return;
  }
  if (!password) {
    fieldError('login-password-error', 'Your password, please.');
    document.getElementById('login-password').focus();
    return;
  }
  try {
    await api('POST', '/api/auth/login', { email: username, password });
    const next = login.dataset.next;
    window.location.href = next && next.startsWith('/') ? next : '/hall';
  } catch (error) {
    fieldError('login-error', error.message);
  }
});

const join = document.getElementById('join-form');
join?.addEventListener('submit', async (event) => {
  event.preventDefault();
  ['join-error', 'join-username-error', 'join-email-error', 'join-password-error'].forEach((id) => fieldError(id, ''));
  const username = document.getElementById('join-username').value.trim();
  const email = document.getElementById('join-email').value.trim();
  const password = document.getElementById('join-password').value;
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    fieldError('join-username-error', 'A username is 3 to 20 letters, digits and underscores.');
    return;
  }
  if (password.length < 8) {
    fieldError('join-password-error', 'At least 8 characters, please.');
    return;
  }
  try {
    await api('POST', '/api/auth/register', { username, email, password });
    await api('POST', '/api/auth/login', { email: username, password });
    window.location.href = '/hall';
  } catch (error) {
    if (error.status === 409) fieldError('join-username-error', error.message);
    else fieldError('join-error', error.message);
  }
});
