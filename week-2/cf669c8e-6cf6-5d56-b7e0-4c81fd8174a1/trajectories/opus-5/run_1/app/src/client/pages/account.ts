/**
 * Sign-in and register.
 *
 * Each role lands on its published route. If sign-in was reached from the
 * configurator, `/orders` also offers a link back to that configurator address.
 */

import { ApiCallError, api } from '../api.js';
import { el } from '../dom.js';
import { store } from '../state.js';
import type { Page, PageContext, PageFactory } from '../main.js';

const COUNTRIES = ['NL', 'BE', 'DE', 'LU'];
export const SIGN_IN_FAILURE = 'Email or password is wrong.';

export const accountPage: PageFactory = (context: PageContext): Page => ({
  mount(container) {
    const registering = window.location.pathname === '/register';
    const title = registering ? 'Register' : 'Sign in';

    const failure = el('p', { class: 'field-error', hidden: true });
    const summary = el('div', { class: 'alert-summary', role: 'alert', 'aria-label': 'Check these fields', hidden: true });

    const email = el('input', { type: 'email', id: 'email', autocomplete: 'email', 'aria-label': 'Email' });
    const password = el('input', { type: 'password', id: 'password', 'aria-label': 'Password' });
    const emailError = el('p', { class: 'field-error', hidden: true });
    const passwordError = el('p', { class: 'field-error', hidden: true });

    const fields: (Node | string)[] = [
      el('label', { for: 'email' }, ['Email']),
      email,
      emailError,
      el('label', { for: 'password' }, ['Password']),
      password,
      passwordError,
    ];

    let name: HTMLInputElement | null = null;
    let country: HTMLSelectElement | null = null;
    const nameError = el('p', { class: 'field-error', hidden: true });

    if (registering) {
      name = el('input', { type: 'text', id: 'name', 'aria-label': 'Name' });
      country = el('select', { id: 'country', 'aria-label': 'Country' });
      for (const code of COUNTRIES) country.append(el('option', { value: code }, [code]));
      fields.push(
        el('label', { for: 'name' }, ['Name']),
        name,
        nameError,
        el('label', { for: 'country' }, ['Country']),
        country,
      );
    }

    const submit = el('button', { type: 'submit', class: 'primary' }, [title]);
    const form = el('form', { class: 'stack', 'aria-label': title }, [...fields, submit]);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      failure.hidden = true;
      summary.hidden = true;
      for (const node of [emailError, passwordError, nameError]) node.hidden = true;

      const request = registering
        ? api.register({
            email: email.value,
            password: password.value,
            name: name?.value ?? '',
            country: country?.value ?? 'NL',
          })
        : api.signIn(email.value, password.value);

      void request
        .then((user) => {
          store.user = user;
          context.header.update();
          context.navigate(user.landing);
        })
        .catch((error: unknown) => {
          if (!(error instanceof ApiCallError)) throw error;
          if (error.errors) {
            const links: Node[] = [];
            for (const [field, message] of Object.entries(error.errors)) {
              const target =
                field === 'email'
                  ? emailError
                  : field === 'password'
                    ? passwordError
                    : field === 'name'
                      ? nameError
                      : null;
              if (target) {
                target.hidden = false;
                target.textContent = message;
              }
              links.push(el('a', { href: `#${field}` }, [message]));
            }
            summary.hidden = false;
            while (summary.firstChild) summary.firstChild.remove();
            for (const link of links) summary.append(link);
            return;
          }
          failure.hidden = false;
          failure.textContent =
            error.code === 'email_taken' ? 'That email already has an account.' : SIGN_IN_FAILURE;
        });
    });

    const other = registering
      ? el('a', { href: '/sign-in' }, ['Already have an account? Sign in'])
      : el('a', { href: '/register' }, ['New here? Register']);
    other.addEventListener('click', (event) => {
      event.preventDefault();
      context.navigate(registering ? '/sign-in' : '/register');
    });

    container.append(
      el('section', { class: 'sheet narrow' }, [
        el('h1', { class: 'heading-1' }, [title]),
        summary,
        failure,
        form,
        other,
      ]),
    );
    email.focus();
  },
});
