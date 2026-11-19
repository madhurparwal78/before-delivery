// Sign-up: every field is checked here first, and the landing replaces this entry.

import { api, encodeNext, readNext, setToken, token } from './api.js';
import {
  MESSAGES, fillSummary, markField, normaliseDisplayName, validDateOfBirth,
  validDisplayName, validEmail, validPassword, validUsername,
} from './fields.js';

const form = document.getElementById('register-form');
const alertBox = document.getElementById('form-alert');
const submit = document.getElementById('submit');
const switchLink = document.getElementById('switch-link');
const next = readNext();

if (next) switchLink.href = '/login?next=' + encodeNext(next);

if (token()) {
  window.location.replace(next || '/servers');
}

const FIELDS = [
  ['email', (value) => validEmail(value), 'email'],
  ['display_name', (value) => validDisplayName(value), 'display_name'],
  ['username', (value) => validUsername(value), 'username'],
  ['password', (value) => validPassword(value), 'password'],
  ['date_of_birth', (value) => validDateOfBirth(value), 'date_of_birth'],
];

function values() {
  return {
    email: form.email.value,
    display_name: form.display_name.value,
    username: form.username.value,
    password: form.password.value,
    date_of_birth: form.date_of_birth.value,
  };
}

function check() {
  const entered = values();
  const problems = [];
  for (const [name, rule, messageKey] of FIELDS) {
    const good = rule(entered[name]);
    markField(form, name, good ? '' : MESSAGES[messageKey]);
    if (!good) problems.push([name, MESSAGES[messageKey]]);
  }
  fillSummary(alertBox, form, problems);
  return problems;
}

async function joinFromNext(target) {
  const match = /^\/servers\/([^/?#]+)\?join=1$/.exec(target || '');
  if (!match) return null;
  const answer = await api('/api/servers/' + match[1] + '/join', { method: 'POST' });
  if (!answer.ok) return null;
  window.sessionStorage.setItem('hub_joined_slug', match[1]);
  return `/channels/${answer.data.community_id}/${answer.data.default_channel_id}`;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  const problems = check();
  if (problems.length) {
    const first = form.querySelector('#' + problems[0][0]);
    if (first) first.focus();
    return;
  }
  submit.disabled = true;
  submit.textContent = 'Creating account…';
  const entered = values();
  entered.display_name = normaliseDisplayName(entered.display_name);
  let answer;
  try {
    answer = await api('/api/auth/signup', { method: 'POST', body: entered, token: null });
  } catch (error) {
    alertBox.textContent = 'Something went wrong. Try again.';
    submit.disabled = false;
    submit.textContent = 'Create an account';
    return;
  }
  if (answer.status === 201) {
    setToken(answer.data.access_token);
    const landing = (await joinFromNext(next)) || next || '/servers';
    window.location.replace(landing);
    return;
  }
  form.password.value = '';
  submit.disabled = false;
  submit.textContent = 'Create an account';
  const field = answer.data && answer.data.error ? answer.data.error.field : null;
  const problemsFromServer = [];
  if (answer.status === 409 && field === 'email') {
    markField(form, 'email', MESSAGES.email_taken);
    problemsFromServer.push(['email', MESSAGES.email_taken]);
  } else if (answer.status === 409 && field === 'username') {
    markField(form, 'username', MESSAGES.username_taken);
    problemsFromServer.push(['username', MESSAGES.username_taken]);
  } else if (field && MESSAGES[field]) {
    markField(form, field, MESSAGES[field]);
    problemsFromServer.push([field, MESSAGES[field]]);
  }
  if (problemsFromServer.length) {
    fillSummary(alertBox, form, problemsFromServer);
    const first = form.querySelector('#' + problemsFromServer[0][0]);
    if (first) first.focus();
  } else {
    alertBox.textContent = 'Something went wrong. Try again.';
  }
});
