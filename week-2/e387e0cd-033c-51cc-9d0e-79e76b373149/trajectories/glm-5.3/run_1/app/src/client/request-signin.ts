// The private data request page and the sign-in screen.
import { h, inputText, radioGroup, radioValue } from './dom.js';
import { api } from './api.js';
import { navigate } from './router.js';
import { liveRegion, Desk, fieldErrorsClear } from './feedback.js';
import { startPolling, takeStash, peekStash } from './state.js';
import { formatCountdown, formatAmount } from './format.js';
import { fieldWrap } from './screens-cases.js';

interface RequestPage {
  caseReference: string; asset: string; amount: string; fromAddressMasked: string; toAddressMasked: string;
  requestingExchange: string; status: 'live' | 'answered'; endsAt: string; remainingSeconds: number; now: string;
}

export async function renderRequestPage(root: HTMLElement, token: string): Promise<void> {
  const statusEl = liveRegion('Request status');
  const desk = new Desk(statusEl);
  const ended = h('div', { class: 'ended-copy', hidden: true });
  const countdown = h('div', { role: 'timer', 'aria-label': 'Page countdown', class: 'countdown mono' });
  const body = h('div', { class: 'request-body' });

  root.append(h('main', { class: 'public-main request-page' },
    h1(), statusEl, ended, body,
    h('div', { class: 'sticky-bar' })));

  function h1(): HTMLElement {
    return h('h1', {}, 'Travel Rule data request');
  }

  let answered = false;

  async function load(): Promise<void> {
    const res = await api<{ page: RequestPage }>('GET', `/api/request-pages/${token}`);
    if (res.status === 410) {
      if (res.error !== null) {
        ended.hidden = false;
        ended.textContent = res.error.message;
        body.replaceChildren();
        desk.repaint();
      }
      return;
    }
    if (!res.ok || res.body === null) return;
    const page = res.body.page;
    answered = page.status === 'answered' || answered;
    if (answered) {
      countdown.textContent = '';
    } else {
      countdown.textContent = `This page ends in ${formatCountdown(page.remainingSeconds)}`;
    }
    body.replaceChildren(renderForm(page));
    desk.repaint();
  }

  function renderForm(page: RequestPage): HTMLElement {
    const form = h('form', { class: 'request-form', onsubmit: (e: Event) => {
      e.preventDefault();
      void submit(page, form);
    } });
    const answer = radioGroup('Answer', [
      { value: 'accepted', label: 'Accepted', checked: true },
      { value: 'rejected', label: 'Rejected', checked: false },
    ]);
    const fileInput = h('input', { type: 'file', id: 'certificate', class: 'file-input', 'aria-label': 'Licence certificate' }) as HTMLInputElement;
    const chooseButton = h('button', { type: 'button', class: 'btn', 'aria-label': 'Choose certificate', onclick: () => fileInput.click() }, 'Choose certificate');
    const fileName = h('span', { class: 'file-name', 'aria-live': 'polite' }, '');
    fileInput.addEventListener('change', () => {
      fileName.textContent = fileInput.files !== null && fileInput.files.length > 0 ? fileInput.files[0].name : '';
    });
    const note = inputText({ id: 'note', 'aria-label': 'Note', class: 'input' });

    form.append(
      h('dl', { class: 'facts-list' },
        h('dt', {}, 'Case reference'), h('dd', { class: 'mono' }, page.caseReference),
        h('dt', {}, 'Asset and amount'), h('dd', { class: 'mono' }, formatAmount(page.asset, page.amount)),
        h('dt', {}, 'From address'), h('dd', { class: 'mono' }, page.fromAddressMasked),
        h('dt', {}, 'To address'), h('dd', { class: 'mono' }, page.toAddressMasked),
        h('dt', {}, 'Requesting exchange'), h('dd', {}, page.requestingExchange)),
      countdown,
      answered ? h('p', { class: 'answered-copy' }, 'Answer received. Thank you.') : h('fieldset', { class: 'answer-group' }, answer),
      h('div', { class: 'field' }, chooseButton, fileName, fileInput, h('div', { class: 'field-error', 'data-error-for': 'certificate' })),
      fieldWrap(note, 'Note'),
      h('div', { class: 'sticky-bar-inner' },
        h('button', { type: 'submit', class: 'btn btn-primary send-answer', 'aria-label': 'Send answer' }, 'Send answer')),
    );
    if (answered) form.querySelectorAll('input,button').forEach((el) => ((el as HTMLButtonElement).disabled = true));
    return form;
  }

  async function submit(page: RequestPage, form: HTMLElement): Promise<void> {
    desk.announce('Sending answer…');
    fieldErrorsClear(form);
    const formData = new FormData();
    formData.append('answer', radioValue('Answer') ?? 'accepted');
    const note = form.querySelector('#note') as HTMLInputElement | null;
    if (note !== null && note.value !== '') formData.append('note', note.value);
    const fileInput = form.querySelector('#certificate') as HTMLInputElement | null;
    if (fileInput !== null && fileInput.files !== null && fileInput.files.length > 0) formData.append('certificate', fileInput.files[0]);
    const res = await api<{ answer: { decision: string } }>('POST', `/api/request-pages/${token}/answer`, formData);
    if (res.ok) {
      desk.announce('Answer sent. Thank you.');
      answered = true;
      await load();
    } else if (res.error !== null) {
      desk.announce(res.error.message, 'error');
      if (Object.keys(res.error.fields).length > 0) desk.inlineErrors(form, res.error.fields);
      if (res.status === 410) await load();
    }
    void page;
  }

  await load();
  startPolling(async () => {
    await load();
  });
}

// ---------- Sign-in ----------

export async function renderSignIn(root: HTMLElement): Promise<void> {
  const statusEl = liveRegion('Desk status');
  const desk = new Desk(statusEl);
  const stash = peekStash();
  const notice = h('p', { class: 'session-note' }, stash !== null
    ? (stash.reason === 'access_removed' ? 'Your access to this workspace was removed.' : 'Your session ended. Sign in again to continue. What you typed is kept.')
    : '');

  const email = h('input', { id: 'email', 'aria-label': 'Email', class: 'input', type: 'email', autocomplete: 'username' }) as HTMLInputElement;
  const password = h('input', { id: 'password', 'aria-label': 'Password', class: 'input', type: 'password', autocomplete: 'current-password' }) as HTMLInputElement;

  const signInButton = h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Sign in', onclick: async () => {
    desk.announce('Signing in…');
    const res = await api<{ member: { id: string }; workspace: { slug: string }; home: string }>('POST', '/api/session', {
      email: email.value, password: password.value,
    });
    if (res.ok && res.body !== null) {
      desk.announce('');
      const { setSession } = await import('./state.js');
      const sessionRes = await api<{ member: { id: string; name: string; email: string; role: string }; workspace: { slug: string; name: string }; home: string }>('GET', '/api/session');
      if (sessionRes.body !== null) setSession(sessionRes.body);
      const saved = takeStash();
      const target = saved !== null && saved.reason === 'session_ended' ? saved.route : res.body.home;
      navigate(target, true);
      if (saved !== null && saved.reason === 'session_ended' && saved.dialog !== 'none' && saved.dialog !== '') {
        const { reopenDialog } = await import('./state.js');
        reopenDialog(saved.dialog, saved.values);
      }
    } else if (res.error !== null) {
      desk.announce('Email or password is incorrect.', 'error');
    }
  } }, 'Sign in');

  root.append(h('main', { class: 'sign-in-main' },
    h('div', { class: 'sign-in-panel' },
      h('h1', {}, 'Sign in to Lanternline'),
      notice,
      fieldWrap(email, 'Email'),
      fieldWrap(password, 'Password'),
      signInButton,
      statusEl)));
  email.focus();
}

