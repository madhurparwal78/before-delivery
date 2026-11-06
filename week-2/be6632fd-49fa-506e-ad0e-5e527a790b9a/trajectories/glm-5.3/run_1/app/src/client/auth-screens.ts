// Sign-in, forgot-password, reset-password and invitation screens. Sign-in lands
// on the next query value when it is an allowed staff screen, else the role home.
import { api, apiOk, failOf, MESSAGES, type MemberOut, ROLE_HOME } from './api.js';
import { el, buttonEl, liveRegion, announce, clearFieldErrors, showProblems, fieldError } from './ui.js';
import { route, navigate } from './router.js';

function staffScreenAllowed(path: string): boolean {
  if (!path.startsWith('/studio/') || path.startsWith('//')) return false;
  try { const u = new URL(path, location.origin); return u.origin === location.origin && u.pathname.startsWith('/studio/'); } catch { return false; }
}

export function registerAuthRoutes(): void {
  route('/sign-in', (root) => renderSignIn(root, new URLSearchParams(location.search).get('next')));
  route('/forgot-password', renderForgot);
  route('/reset-password/:token', (root, p) => renderReset(root, p.token));
  route('/invite/:token', (root, p) => renderInvite(root, p.token));
}

async function renderSignIn(root: HTMLElement, next: string | null): Promise<HTMLElement> {
  const h = el('h1', {}, 'Sign in');
  const status = liveRegion('Sign-in status');
  const form = el('form', { 'aria-label': 'Sign in', onsubmit: async (e: Event) => {
    e.preventDefault();
    clearFieldErrors(form);
    const email = (form.querySelector('[name="email"]') as HTMLInputElement).value.trim();
    const password = (form.querySelector('[name="password"]') as HTMLInputElement).value;
    setBusy(signInBtn, 'Signing in…', async () => {
      const res = await api<{ member: MemberOut }>('POST', '/api/auth/sign-in', { email, password });
      const member = res.data!.member;
      let target: string;
      if (next && staffScreenAllowed(next)) target = next;
      else target = ROLE_HOME[member.role] ?? '/studio/drops';
      document.dispatchEvent(new CustomEvent('hourline:signed-in', { detail: member }));
      await navigate(target, { push: true, wipe: true });
    }, (fail) => {
      if (fail.status === 401) announce(status, "That email and password don't match.", true);
      else announce(status, fail.message, true);
    });
  } });
  const emailInput = el('input', { type: 'email', name: 'email', 'aria-label': 'Email', autocomplete: 'email' });
  const passwordInput = el('input', { type: 'password', name: 'password', 'aria-label': 'Password' });
  const signInBtn = buttonEl({ class: 'btn btn-primary', type: 'submit', text: 'Sign in' });
  form.append(
    fieldRow('Email', emailInput),
    fieldRow('Password', passwordInput),
    signInBtn,
    el('a', { href: '/forgot-password', text: 'Forgot password?' }),
    status
  );
  root.append(el('div', { class: 'panel', style: 'max-width: 420px; margin: 40px auto;' }, h, form));
  return h;
}

async function renderForgot(root: HTMLElement): Promise<HTMLElement> {
  const h = el('h1', {}, 'Reset your password');
  const status = liveRegion('Reset status');
  const form = el('form', { onsubmit: async (e: Event) => {
    e.preventDefault();
    const email = (form.querySelector('[name="email"]') as HTMLInputElement).value.trim();
    setBusy(sendBtn, 'Sending…', async () => {
      await apiOk('POST', '/api/auth/password-reset', { email });
      announce(status, 'If that address belongs to a member, a reset link is on its way.');
    }, fail => {
      if (fail.fields) { showProblems(form, fail, { email: 'Email' }); fieldError(form, 'email', fail.fields.email, 'Email'); }
      else announce(status, fail.message, true);
    });
  } });
  const emailInput = el('input', { type: 'email', name: 'email', 'aria-label': 'Email' });
  const sendBtn = buttonEl({ class: 'btn btn-primary', type: 'submit', text: 'Send reset link' });
  form.append(fieldRow('Email', emailInput), sendBtn, status);
  root.append(el('div', { class: 'panel', style: 'max-width: 420px; margin: 40px auto;' }, h, form));
  return h;
}

async function renderReset(root: HTMLElement, token: string): Promise<HTMLElement> {
  const h = el('h1', {}, 'Choose a new password');
  const status = liveRegion('Reset status');
  const form = el('form', { onsubmit: async (e: Event) => {
    e.preventDefault();
    const password = (form.querySelector('[name="password"]') as HTMLInputElement).value;
    setBusy(saveBtn, 'Saving…', async () => {
      const res = await api<{ member: MemberOut }>('POST', '/api/auth/password-reset/complete', { token, password });
      document.dispatchEvent(new CustomEvent('hourline:signed-in', { detail: res.data!.member }));
      announce(status, 'Password saved.');
      await navigate(ROLE_HOME[res.data!.member.role] ?? '/studio/drops', { wipe: true });
    }, fail => {
      if (fail.status === 410) announce(status, 'This reset link is no longer valid. Ask for a new one.', true);
      else if (fail.fields?.password) { showProblems(form, fail, { password: 'New password' }); fieldError(form, 'password', fail.fields.password, 'New password'); }
      else announce(status, fail.message, true);
    });
  } });
  const passwordInput = el('input', { type: 'password', name: 'password', 'aria-label': 'New password' });
  const saveBtn = buttonEl({ class: 'btn btn-primary', type: 'submit', text: 'Save password' });
  form.append(fieldRow('New password', passwordInput), saveBtn, status);
  root.append(el('div', { class: 'panel', style: 'max-width: 420px; margin: 40px auto;' }, h, form));
  return h;
}

async function renderInvite(root: HTMLElement, token: string): Promise<HTMLElement> {
  const h = el('h1', {}, 'Accept your invitation');
  const status = liveRegion('Invitation status');
  const form = el('form', { onsubmit: async (e: Event) => {
    e.preventDefault();
    const name = (form.querySelector('[name="name"]') as HTMLInputElement).value.trim();
    const password = (form.querySelector('[name="password"]') as HTMLInputElement).value;
    setBusy(joinBtn, 'Joining…', async () => {
      const res = await api<{ member: MemberOut }>('POST', '/api/auth/invitations/accept', { token, name, password });
      document.dispatchEvent(new CustomEvent('hourline:signed-in', { detail: res.data!.member }));
      await navigate(ROLE_HOME[res.data!.member.role] ?? '/studio/drops', { wipe: true });
    }, fail => {
      if (fail.status === 410) announce(status, 'This invitation is no longer valid. Ask your launch producer for a new one.', true);
      else if (fail.fields) {
        showProblems(form, fail, { name: 'Your name', password: 'Password' });
        for (const [p, msg] of Object.entries(fail.fields)) fieldError(form, p, msg, p);
      } else announce(status, fail.message, true);
    });
  } });
  const nameInput = el('input', { type: 'text', name: 'name', 'aria-label': 'Your name' });
  const passwordInput = el('input', { type: 'password', name: 'password', 'aria-label': 'Password' });
  const joinBtn = buttonEl({ class: 'btn btn-primary', type: 'submit', text: 'Join workspace' });
  form.append(fieldRow('Your name', nameInput), fieldRow('Password', passwordInput), joinBtn, status);
  root.append(el('div', { class: 'panel', style: 'max-width: 420px; margin: 40px auto;' }, h, form));
  return h;
}

function fieldRow(label: string, input: HTMLElement): HTMLElement {
  const wrap = el('label', { class: 'field' });
  wrap.append(el('span', { class: 'label', text: label }), input);
  return wrap;
}

async function setBusy(btn: HTMLButtonElement, copy: string, work: () => Promise<void>, onFail: (fail: ReturnType<typeof failOf>) => void): Promise<void> {
  const original = btn.textContent ?? '';
  btn.textContent = copy;
  btn.disabled = true;
  try {
    await work();
  } catch (err) {
    onFail(failOf(err));
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}

void MESSAGES;
