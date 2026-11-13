// Shared dialogs: sign-up, sign-in, generic item dialogs, focus management.

import { el, api, copy, navigate } from './ui.js';
import { state, resumeAfterAuth, loadMe, setChips } from './app-state.js';

export function trapFocus(dialog) {
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusables = dialog.querySelectorAll('button, input, select, a[href], [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

export function openDialog(dialog, opener) {
  dialog.dataset.openerId = opener?.id ?? '';
  if (!dialog.id) dialog.id = `dialog-${Math.random().toString(36).slice(2)}`;
  if (opener && !opener.id) opener.id = `opener-${Math.random().toString(36).slice(2)}`;
  if (opener) dialog.dataset.openerId = opener.id;
  dialog.showModal();
  trapFocus(dialog);
  const first = dialog.querySelector('input, button');
  if (first) first.focus();
}

export function closeDialog(dialog) {
  const openerId = dialog.dataset.openerId;
  dialog.close();
  const opener = openerId ? document.getElementById(openerId) : null;
  if (opener && document.contains(opener)) opener.focus();
  else {
    const heading = document.querySelector('main h1');
    if (heading) heading.focus();
  }
}

function fieldError(name, message) {
  return el('a', { href: '#', text: message, onclick: (event) => {
    event.preventDefault();
    const field = document.getElementById(name);
    if (field) field.focus();
  } });
}

export function errorSummary(errors) {
  const region = el('div', { class: 'alert-summary', role: 'alert', 'aria-label': 'Check these fields' });
  region.append(el('h3', { text: 'Check these fields' }));
  for (const [field, message] of Object.entries(errors)) {
    region.append(fieldError(field, message));
  }
  return region;
}

export function ageNote(yearValue) {
  const year = Number(yearValue);
  if (!Number.isInteger(year) || year < 1900) return null;
  const age = new Date().getUTCFullYear() - year;
  if (age < 13) return copy.underAge;
  if (age < 18) return copy.ageNote;
  return null;
}

export async function signUpDialog({ mode = 'signup', onDone } = {}) {
  const isSignup = mode === 'signup';
  const dialog = el('dialog', { 'aria-label': isSignup ? 'Create your account' : 'Sign in' });
  dialog.id = isSignup ? 'signup-dialog' : 'signin-dialog';
  const heading = el('h2', { text: isSignup ? 'Create your account' : 'Sign in' });

  const email = el('input', { type: 'email', id: 'field-email', autocomplete: 'email' });
  const password = el('input', { type: 'password', id: 'field-password', autocomplete: isSignup ? 'new-password' : 'current-password' });
  const displayName = isSignup ? el('input', { type: 'text', id: 'field-displayname', maxlength: '20' }) : null;
  const birthYear = isSignup
    ? el('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', id: 'field-birthyear', maxlength: '4', placeholder: '1998' })
    : null;

  const emailLabel = el('label', { for: 'field-email', text: 'Email' });
  const passwordLabel = el('label', { for: 'field-password', text: 'Password' });
  const displayNameLabel = isSignup ? el('label', { for: 'field-displayname', text: 'Display name' }) : null;
  const birthYearLabel = isSignup ? el('label', { for: 'field-birthyear', text: 'Year of birth' }) : null;

  const notice = el('p', { role: 'status', 'aria-live': 'polite', class: 'mode-note', text: '' });
  const sheet = el('div', { class: 'sheet-motion' });

  const submit = el('button', { class: 'primary', type: 'button', text: isSignup ? 'Create account' : 'Sign in', onclick: submitForm });
  const switchBtn = el('button', { type: 'button', text: isSignup ? 'Sign in instead' : 'Create an account instead', onclick: () => {
    closeDialog(dialog);
    dialog.remove();
    void signUpDialog({ mode: isSignup ? 'signin' : 'signup', onDone });
  } });
  const closeBtn = el('button', { type: 'button', text: 'Close', onclick: () => { closeDialog(dialog); dialog.remove(); } });

  const ageLine = el('p', { class: 'mode-note', role: 'status', text: '' });

  if (isSignup) {
    birthYear.addEventListener('input', () => {
      const note = ageNote(birthYear.value);
      ageLine.textContent = note ?? '';
    });
  }

  sheet.append(
    heading,
    notice,
    el('div', { class: 'field' }, emailLabel, email),
    el('div', { class: 'field' }, passwordLabel, password)
  );
  if (isSignup) {
    sheet.append(
      el('div', { class: 'field' }, displayNameLabel, displayName),
      el('div', { class: 'field' }, birthYearLabel, birthYear),
      ageLine
    );
  }
  sheet.append(el('div', { class: 'dialog-actions' }, submit, switchBtn, closeBtn));
  dialog.append(sheet);

  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(dialog); dialog.remove(); });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeDialog(dialog); dialog.remove(); }
  });

  document.body.append(dialog);
  openDialog(dialog, document.activeElement);

  async function submitForm() {
    notice.textContent = copy.pending;
    const errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) errors.email = copy.emailInvalid;
    if (password.value.length < 8) errors.password = copy.passwordInvalid;
    if (isSignup) {
      if (displayName.value.trim().length < 2 || displayName.value.trim().length > 20) errors.displayName = copy.displayNameInvalid;
      const year = Number(birthYear.value);
      if (!Number.isInteger(year) || year < 1900) errors.birthYear = copy.yearInvalid;
      else if (new Date().getUTCFullYear() - year < 13) {
        notice.textContent = copy.underAge;
        return;
      }
    }
    const priorSummary = dialog.querySelector('.alert-summary');
    if (priorSummary) priorSummary.remove();
    if (Object.keys(errors).length > 0) {
      const summary = errorSummary(errors);
      heading.after(summary);
      const link = summary.querySelector('a');
      if (link) link.focus();
      notice.textContent = '';
      return;
    }
    try {
      if (isSignup) {
        await api('/api/auth/signup', {
          method: 'POST',
          body: {
            email: email.value.trim(),
            password: password.value,
            displayName: displayName.value.trim(),
            birthYear: Number(birthYear.value),
          },
        });
      } else {
        await api('/api/auth/signin', {
          method: 'POST',
          body: { email: email.value.trim(), password: password.value },
        });
      }
      await loadMe();
      setChips();
      closeDialog(dialog);
      dialog.remove();
      if (onDone) onDone();
      else resumeAfterAuth();
    } catch (err) {
      notice.textContent = '';
      const fields = err.fields ?? {};
      const summary = errorSummary(Object.keys(fields).length > 0 ? fields : { email: err.message });
      const prior = dialog.querySelector('.alert-summary');
      if (prior) prior.remove();
      heading.after(summary);
      const link = summary.querySelector('a');
      if (link) link.focus();
    }
  }
  return dialog;
}
