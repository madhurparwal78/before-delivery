import { ApiFailure, api } from '../api.js';
import { el } from '../dom.js';
import { languagePicker } from '../main.js';
import { HeroPreview } from '../scene/preview.js';
import { DEFAULT_LOOK, withPending, type AppContext, type Screen } from './shared.js';
import type { Account } from '../../shared/types.js';
import type { Page } from '../../server/pages.js';
import type { MessageKey } from '../../shared/i18n/index.js';

interface Field {
  wrapper: HTMLElement;
  input: HTMLInputElement;
  error: HTMLElement;
  name: string;
}

function field(
  ctx: AppContext,
  name: string,
  labelKey: MessageKey,
  type: string,
): Field {
  const id = `field-${name}`;
  const input = el('input', { id, name, type, autocomplete: 'off' }) as HTMLInputElement;
  const error = el('p', { class: 'field-error', id: `${id}-error` });
  const wrapper = el('label', { class: 'field', for: id }, [
    el('span', { text: ctx.t(labelKey) }),
    input,
    error,
  ]);
  return { wrapper, input, error, name };
}

function showFailure(
  ctx: AppContext,
  failure: unknown,
  fields: Field[],
  summary: HTMLElement,
): void {
  for (const entry of fields) {
    entry.error.textContent = '';
    entry.input.removeAttribute('aria-invalid');
  }
  summary.textContent = '';
  if (!(failure instanceof ApiFailure)) {
    ctx.announce(ctx.t('fb.generic'));
    return;
  }
  const links: HTMLElement[] = [];
  for (const entry of fields) {
    const message = failure.fieldMessage(entry.name);
    if (message === null) continue;
    entry.error.textContent = message;
    entry.input.setAttribute('aria-invalid', 'true');
    entry.input.setAttribute('aria-describedby', `${entry.input.id}-error`);
    links.push(
      el('li', {}, [el('a', { href: `#${entry.input.id}`, text: message })]),
    );
  }
  if (links.length > 0) {
    summary.append(el('ul', {}, links));
    return;
  }
  if (failure.status === 409 || failure.status === 401) {
    summary.textContent = failure.localisedMessage;
    return;
  }
  ctx.announce(failure.localisedMessage);
}

export async function renderAuthScreen(
  ctx: AppContext,
  host: HTMLElement,
  page: Page,
): Promise<Screen> {
  const preview = new HeroPreview({ label: ctx.t('app.heroPreview'), turntable: true });
  preview.setHero(DEFAULT_LOOK);
  const card = el('div', { class: 'paper-card auth-card' });
  host.append(el('div', { class: 'auth-layout' }, [preview.element, card]));
  card.append(languagePicker(ctx));

  const summary = el('div', { class: 'form-summary', role: 'alert' });

  if (page.name === 'home') {
    card.append(
      el('h1', { text: 'Linewright' }),
      el('p', { text: ctx.t('home.tagline') }),
      el('p', { text: ctx.t('home.lead') }),
      el('a', { href: '/signup', class: 'button primary', text: ctx.t('btn.createAccount') }),
      el('a', { href: '/signin', class: 'link', text: ctx.t('btn.signIn') }),
    );
    return { destroy: () => preview.destroy() };
  }

  if (page.name === 'signup') {
    const email = field(ctx, 'email', 'field.email', 'email');
    const password = field(ctx, 'password', 'field.password', 'password');
    const displayName = field(ctx, 'display_name', 'field.displayName', 'text');
    const submit = el('button', { type: 'submit', class: 'button primary' }, [
      ctx.t('btn.createAccount'),
    ]) as HTMLButtonElement;
    const form = el('form', { class: 'stack' }, [
      el('h1', { text: ctx.t('heading.signup') }),
      summary,
      email.wrapper,
      password.wrapper,
      displayName.wrapper,
      submit,
      el('a', { href: '/signin', class: 'link', text: ctx.t('link.haveAccount') }),
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void withPending(ctx, submit, async () => {
        try {
          await api.post<{ account: Account }>('/api/auth/signup', {
            email: email.input.value,
            password: password.input.value,
            display_name: displayName.input.value,
            locale: ctx.locale,
          });
          window.location.assign('/hangar');
        } catch (failure) {
          showFailure(ctx, failure, [email, password, displayName], summary);
        }
      });
    });
    card.append(form);
    return { destroy: () => preview.destroy() };
  }

  if (page.name === 'signin') {
    const email = field(ctx, 'email', 'field.email', 'email');
    const password = field(ctx, 'password', 'field.password', 'password');
    const submit = el('button', { type: 'submit', class: 'button primary' }, [
      ctx.t('btn.signIn'),
    ]) as HTMLButtonElement;
    const form = el('form', { class: 'stack' }, [
      el('h1', { text: ctx.t('heading.signin') }),
      summary,
      email.wrapper,
      password.wrapper,
      submit,
      el('a', { href: '/forgot-password', class: 'link', text: ctx.t('link.forgot') }),
      el('a', { href: '/signup', class: 'link', text: ctx.t('link.noAccount') }),
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void withPending(ctx, submit, async () => {
        try {
          await api.post('/api/auth/signin', {
            email: email.input.value,
            password: password.input.value,
          });
          window.location.assign('/hangar');
        } catch (failure) {
          showFailure(ctx, failure, [email, password], summary);
        }
      });
    });
    card.append(form);
    return { destroy: () => preview.destroy() };
  }

  if (page.name === 'forgot') {
    const email = field(ctx, 'email', 'field.email', 'email');
    const submit = el('button', { type: 'submit', class: 'button primary' }, [
      ctx.t('btn.sendReset'),
    ]) as HTMLButtonElement;
    const form = el('form', { class: 'stack' }, [
      el('h1', { text: ctx.t('heading.forgot') }),
      summary,
      email.wrapper,
      submit,
      el('a', { href: '/signin', class: 'link', text: ctx.t('btn.signIn') }),
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void withPending(ctx, submit, async () => {
        try {
          await api.post('/api/auth/password-reset', { email: email.input.value });
          ctx.announce(ctx.t('fb.resetRequested'));
        } catch (failure) {
          if (failure instanceof ApiFailure && failure.code === 'mail_unavailable') {
            ctx.setBanner(failure.localisedMessage);
            return;
          }
          showFailure(ctx, failure, [email], summary);
        }
      });
    });
    card.append(form);
    return { destroy: () => preview.destroy() };
  }

  if (page.name === 'reset') {
    const token = new URL(window.location.href).searchParams.get('token') ?? '';
    const password = field(ctx, 'password', 'field.password', 'password');
    const submit = el('button', { type: 'submit', class: 'button primary' }, [
      ctx.t('btn.setNewPassword'),
    ]) as HTMLButtonElement;
    const heading = el('h1', { text: ctx.t('heading.reset') });
    const form = el('form', { class: 'stack' }, [heading, summary, password.wrapper, submit]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void withPending(ctx, submit, async () => {
        try {
          await api.post('/api/auth/password-reset/confirm', {
            token,
            password: password.input.value,
          });
          ctx.announce(ctx.t('fb.passwordChanged'));
          ctx.navigate('/signin');
        } catch (failure) {
          if (failure instanceof ApiFailure && failure.status === 410) {
            heading.textContent = failure.localisedMessage;
            form.replaceChildren(heading);
            return;
          }
          showFailure(ctx, failure, [password], summary);
        }
      });
    });
    card.append(form);
    return { destroy: () => preview.destroy() };
  }

  const token = new URL(window.location.href).searchParams.get('token') ?? '';
  const heading = el('h1', { text: ctx.t('title.verify') });
  card.append(heading, el('a', { href: '/signin', class: 'link', text: ctx.t('btn.signIn') }));
  try {
    await api.post('/api/auth/verify', { token });
    heading.textContent = ctx.t('fb.emailConfirmed');
  } catch (failure) {
    heading.textContent =
      failure instanceof ApiFailure && failure.status === 410
        ? failure.localisedMessage
        : ctx.t('fb.generic');
  }
  return { destroy: () => preview.destroy() };
}
