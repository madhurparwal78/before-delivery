import { api } from '../api.js';
import { el } from '../dom.js';
import { HEADING, heading, navigate } from '../shell.js';
import { button, field, select, statusRegion } from '../widgets.js';
import { ZONES } from '../../shared/zones.js';
import type { PageContext } from '../main.js';

const SIGNED_UP = 'Check your email to confirm your account.';

export async function renderSignIn(ctx: PageContext): Promise<void> {
  if (ctx.me !== null) {
    navigate('/sessions');
    return;
  }
  heading(ctx.main, 'Sign in');
  const email = field('Email', 'email');
  const password = field('Password', 'password');
  const submit = button('Sign in', 'primary');
  const result = statusRegion('Account result');
  const form = el('form', { class: 'panel' }, [email.wrap, password.wrap, submit, result]);
  form.addEventListener('submit', (event) => event.preventDefault());
  ctx.main.append(form, el('p', {}, [el('a', { href: '/signup', text: 'Create an account' })]));

  const signIn = async (): Promise<void> => {
    result.textContent = 'Signing in...';
    const response = await api.post('/api/signin', { email: email.input.value, password: password.input.value });
    if (!response.ok) {
      result.textContent = response.error ?? '';
      return;
    }
    const next = new URL(window.location.href).searchParams.get('next');
    navigate(next === null || next === '' ? '/sessions' : next);
  };
  submit.addEventListener('click', () => void signIn());
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void signIn();
  });
}

export async function renderSignUp(ctx: PageContext): Promise<void> {
  if (ctx.me !== null) {
    navigate('/sessions');
    return;
  }
  heading(ctx.main, 'Sign up');
  const displayName = field('Display name', 'text');
  const email = field('Email', 'email');
  const password = field('Password', 'password');
  const zone = select(
    'Time zone',
    ZONES.map((entry) => ({ label: entry.name, value: entry.name }))
  );
  const submit = button('Create account', 'primary');
  const result = statusRegion('Account result');
  const form = el('form', { class: 'panel' }, [displayName.wrap, email.wrap, password.wrap, zone.wrap, submit, result]);
  form.addEventListener('submit', (event) => event.preventDefault());
  ctx.main.append(form, el('p', {}, [el('a', { href: '/signin', text: 'Sign in instead' })]));

  submit.addEventListener('click', () => {
    result.textContent = 'Sending...';
    void api
      .post('/api/signup', {
        email: email.input.value,
        password: password.input.value,
        displayName: displayName.input.value,
        timeZone: zone.input.value
      })
      .then((response) => {
        result.textContent = response.ok ? SIGNED_UP : (response.error ?? '');
      });
  });
}

export async function renderConfirm(ctx: PageContext): Promise<void> {
  const response = await api.post(`/api/confirm/${encodeURIComponent(ctx.params['token'] ?? '')}`);
  if (!response.ok) {
    heading(ctx.main, HEADING.deadConfirm);
    return;
  }
  heading(ctx.main, 'Your account is confirmed');
  ctx.main.append(el('p', {}, [el('a', { href: '/signin', text: 'Sign in' })]));
}
