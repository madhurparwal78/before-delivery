// Sign in, sign up, confirmation and invite pages.
import { api, el, type Ctx } from './main';
import { ZONE_OPTIONS } from './communities-page';

export function renderAuthPages(ctx: Ctx, mode: 'signin' | 'signup'): void {
  const main = ctx.main;
  main.append(el('h1', {}, mode === 'signin' ? 'Sign in' : 'Sign up'));

  const email = el('input', { type: 'email', 'aria-label': 'Email' }) as HTMLInputElement;
  const password = el('input', { type: 'password', 'aria-label': 'Password' }) as HTMLInputElement;
  const displayName = el('input', { type: 'text', 'aria-label': 'Display name' }) as HTMLInputElement;
  const zone = el('select', { 'aria-label': 'Time zone' }) as HTMLSelectElement;
  for (const z of ZONE_OPTIONS) {
    const o = document.createElement('option');
    o.value = z;
    o.textContent = z;
    zone.append(o);
  }
  const submit = el('button', { class: 'primary' }, mode === 'signin' ? 'Sign in' : 'Create account');
  const result = el('div', { role: 'status', 'aria-label': 'Account result', class: 'status-region' });

  const form = el('form', { class: 'panel' });
  form.append(email, el('label', {}, 'Password', password));
  if (mode === 'signup') {
    form.append(el('label', {}, 'Display name', displayName), el('label', {}, 'Time zone', zone));
  }
  form.append(submit, result);
  main.append(form);

  form.addEventListener('submit', async (ev: SubmitEvent) => {
    ev.preventDefault();
    if (mode === 'signin') {
      result.textContent = 'Signing in...';
      try {
        await api('/api/signin', { method: 'POST', body: JSON.stringify({ email: email.value, password: password.value }) });
        const back = sessionStorage.getItem('hearthtile_return');
        sessionStorage.removeItem('hearthtile_return');
        location.href = back ?? '/sessions';
      } catch (e) {
        result.textContent = (e as Error).message;
      }
      return;
    }
    result.textContent = 'Sending...';
    try {
      await api('/api/signup', {
        method: 'POST',
        body: JSON.stringify({ email: email.value, password: password.value, displayName: displayName.value, timeZone: zone.value }),
      });
      result.textContent = 'Check your email to confirm your account.';
    } catch (e) {
      result.textContent = (e as Error).message;
    }
  });
}

export async function renderConfirmPage(ctx: Ctx, token: string): Promise<void> {
  const main = ctx.main;
  main.append(el('h1', {}, 'Confirm your account'));
  const result = el('div', { role: 'status', 'aria-label': 'Account result', class: 'status-region' });
  main.append(result);
  try {
    await api(`/api/confirm/${token}`, { method: 'POST' });
    result.textContent = 'Account confirmed.';
    main.append(el('p', {}, el('a', { href: '/signin' }, 'Sign in')));
  } catch {
    main.textContent = '';
    main.append(el('h1', {}, "This link isn't available."));
  }
}

export async function renderInvitePage(ctx: Ctx, token: string): Promise<void> {
  const main = ctx.main;
  const invite = await api<{ from: string }>(`/api/invites/${token}`).catch(() => null);
  if (!invite) {
    main.append(el('h1', {}, "This invite isn't available."));
    return;
  }
  main.append(el('h1', {}, `Accept ${invite.from}'s invite`));
  const result = el('div', { role: 'status', 'aria-label': 'Invite result', class: 'status-region' });
  const accept = el('button', { class: 'primary' }, 'Accept invite');
  accept.addEventListener('click', async () => {
    result.textContent = 'Saving...';
    try {
      await api(`/api/invites/${token}/accept`, { method: 'POST' });
      location.href = '/friends';
    } catch (e) {
      result.textContent = (e as Error).message;
    }
  });
  main.append(el('div', { class: 'panel' }, accept, result));
}
