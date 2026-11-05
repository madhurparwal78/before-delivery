import type { PageContext } from './render.js';
import { layout } from './render.js';
import { t } from '../locales.js';

export function renderSignIn(ctx: PageContext): string {
  const l = ctx.locale;
  ctx.title = t(l, 'sign_in.heading');
  ctx.script = '/assets/session.js';
  ctx.clientCopy = {
    ...ctx.clientCopy,
    'field.email': t(l, 'field.email'),
    'field.password': t(l, 'field.password'),
    'invalid_credentials': t(l, 'invalid_credentials'),
  };
  const next = ctx.query.get('next') ?? '';
  const main = `<section class="sign-in">
  <h1>${t(l, 'sign_in.heading')}</h1>
  <form id="sign-in-form" data-next="${next === '' ? '' : next.replace(/"/g, '&quot;')}">
    <label for="sign-in-email">${t(l, 'sign_in.email')}</label>
    <input type="email" id="sign-in-email" name="email" autocomplete="username" required>
    <label for="sign-in-password">${t(l, 'sign_in.password')}</label>
    <input type="password" id="sign-in-password" name="password" autocomplete="current-password" required>
    <button type="submit">${t(l, 'sign_in.submit')}</button>
    <p class="form-alert" role="alert" hidden></p>
  </form>
</section>`;
  return layout(ctx, main);
}
