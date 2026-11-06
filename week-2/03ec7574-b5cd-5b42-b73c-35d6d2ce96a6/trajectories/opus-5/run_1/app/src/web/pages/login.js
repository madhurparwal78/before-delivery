import { h, icon } from '../html.js';
import { publicPage } from '../layout.js';

export const WRONG_PAIR_MESSAGE = 'Email or password is incorrect';

export function renderLogin({ email = '', error = '', next = '' } = {}) {
  const content = `
  <section>
    <div class="shell" style="max-width:34rem">
      <h1>Sign in to Corvo</h1>
      <p class="lead">Members sign in to the treasury console.</p>
      <form class="form-card" method="post" action="/login" data-login-form>
        <input type="hidden" name="next" value="${h(next)}">
        <p class="alert" role="alert">${h(error)}</p>
        <div class="field">
          <label for="email">Email</label>
          <input type="text" id="email" name="email" value="${h(email)}" autocomplete="username">
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" autocomplete="current-password">
        </div>
        <button type="submit" class="capsule capsule-dark">Sign in${icon('arrow')}</button>
      </form>
    </div>
  </section>`;

  return publicPage({
    title: 'Sign in — Corvo',
    description: 'Sign in to the Corvo treasury console.',
    content
  });
}

export function renderNotFound() {
  const content = `
  <section>
    <div class="shell">
      <h1>Page not found</h1>
      <p>That address is not part of Corvo.</p>
      <p><a class="capsule capsule-dark" href="/">Back to home${icon('arrow')}</a></p>
    </div>
  </section>`;
  return publicPage({
    title: 'Page not found — Corvo',
    description: 'That address is not part of Corvo.',
    content
  });
}
