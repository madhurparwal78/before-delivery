// Sign-in, including the alert an ended session leaves behind.

import { api, encodeNext, readNext, setToken, takeSessionEnded, token } from './api.js';

const form = document.getElementById('login-form');
const alertBox = document.getElementById('form-alert');
const submit = document.getElementById('submit');
const switchLink = document.getElementById('switch-link');
const next = readNext();

if (next) switchLink.href = '/register?next=' + encodeNext(next);
if (takeSessionEnded()) alertBox.textContent = 'Your session has ended. Log in again.';
if (token() && !alertBox.textContent) window.location.replace(next || '/servers');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  submit.disabled = true;
  submit.textContent = 'Logging in…';
  let answer;
  try {
    answer = await api('/api/auth/login', {
      method: 'POST',
      body: { email: form.email.value, password: form.password.value },
      token: null,
    });
  } catch (error) {
    alertBox.textContent = 'Something went wrong. Try again.';
    submit.disabled = false;
    submit.textContent = 'Log in';
    return;
  }
  if (answer.ok) {
    setToken(answer.data.access_token);
    window.location.replace(next || '/servers');
    return;
  }
  form.password.value = '';
  submit.disabled = false;
  submit.textContent = 'Log in';
  const code = answer.data && answer.data.error ? answer.data.error.code : '';
  alertBox.textContent = code === 'rate_limited'
    ? 'Too many sign-in attempts. Try again later.'
    : 'That email and password do not match.';
});
