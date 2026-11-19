// The support request form, with its one status region and its field errors.

import { api } from './api.js';
import { MESSAGES, markField, validEmail } from './fields.js';

const form = document.getElementById('support-form');
const status = document.getElementById('request-status');
const submit = document.getElementById('submit');

function check() {
  const problems = [];
  const email = form.email.value;
  const category = form.category.value;
  const subject = form.subject.value.trim();
  const body = form.body.value.trim();
  const tests = [
    ['email', validEmail(email), MESSAGES.email],
    ['category', Boolean(category), MESSAGES.category],
    ['subject', subject.length >= 3 && subject.length <= 120, MESSAGES.subject],
    ['body', body.length >= 10 && body.length <= 5000, MESSAGES.body],
  ];
  for (const [name, good, message] of tests) {
    markField(form, name, good ? '' : message);
    if (!good) problems.push(name);
  }
  return problems;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const problems = check();
  if (problems.length) {
    const first = form.querySelector('#' + problems[0]);
    if (first) first.focus();
    return;
  }
  submit.disabled = true;
  status.textContent = 'Sending request…';
  let answer;
  try {
    answer = await api('/api/support/tickets', {
      method: 'POST',
      token: null,
      body: {
        email: form.email.value,
        category: form.category.value,
        subject: form.subject.value.trim(),
        body: form.body.value.trim(),
      },
    });
  } catch (error) {
    status.textContent = 'Your request could not be sent. Try again.';
    submit.disabled = false;
    return;
  }
  submit.disabled = false;
  if (answer.status === 201) {
    status.textContent = 'Request received. Your reference is ' + answer.data.reference + '.';
    return;
  }
  if (answer.status === 429) {
    status.textContent = 'Too many requests from this email. Try again later.';
    return;
  }
  const field = answer.data && answer.data.error ? answer.data.error.field : null;
  if (field && MESSAGES[field]) {
    markField(form, field, MESSAGES[field]);
    const target = form.querySelector('#' + field);
    if (target) target.focus();
    status.textContent = '';
  } else {
    status.textContent = 'Your request could not be sent. Try again.';
  }
});
