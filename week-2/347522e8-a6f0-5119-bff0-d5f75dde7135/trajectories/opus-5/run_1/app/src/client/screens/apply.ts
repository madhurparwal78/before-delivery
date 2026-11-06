/** Apply: a visitor's business details, which sign them in as a renter. */

import { api, ApiError } from '../api.js';
import { APPLY_PENDING, BRAND_NAME, GENERIC_ERROR, PRODUCT_NAME } from '../../shared/copy.js';
import { el, field, setFieldError } from '../dom.js';
import { replace } from '../router.js';
import { setCurrentUser } from '../session.js';
import type { ScreenContext } from '../router.js';
import type { SessionUser } from '../../shared/types.js';

export function applyScreen({ root }: ScreenContext): void {
  const inputs = {
    business_name: el('input', { attrs: { type: 'text', autocomplete: 'organization' } }),
    contact_name: el('input', { attrs: { type: 'text', autocomplete: 'name' } }),
    email: el('input', { attrs: { type: 'email', autocomplete: 'email' } }),
    phone: el('input', { attrs: { type: 'tel', autocomplete: 'tel' } }),
    password: el('input', { attrs: { type: 'password', autocomplete: 'new-password' } }),
  };
  const fields = {
    business_name: field('Business name', inputs.business_name, 'apply-business'),
    contact_name: field('Your name', inputs.contact_name, 'apply-contact'),
    email: field('Email', inputs.email, 'apply-email'),
    phone: field('Phone', inputs.phone, 'apply-phone'),
    password: field('Password', inputs.password, 'apply-password'),
  };

  const submit = el('button', {
    class: 'btn btn--primary',
    text: 'Submit application',
    attrs: { type: 'submit' },
  });
  const status = el('p', {
    class: 'status status--alert',
    attrs: { role: 'status', 'aria-label': 'Application status', 'aria-live': 'polite' },
  });

  const form = el('form', { attrs: { 'aria-label': 'Apply', novalidate: true } }, [
    fields.business_name.wrapper,
    fields.contact_name.wrapper,
    fields.email.wrapper,
    fields.phone.wrapper,
    fields.password.wrapper,
    submit,
    status,
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const entry of Object.values(fields)) setFieldError(entry.error, null);
    submit.disabled = true;
    status.textContent = APPLY_PENDING;
    void (async () => {
      try {
        const answer = await api.post<{ user: SessionUser }>('/api/applications', {
          business_name: inputs.business_name.value,
          contact_name: inputs.contact_name.value,
          email: inputs.email.value,
          phone: inputs.phone.value,
          password: inputs.password.value,
        });
        setCurrentUser(answer.user);
        replace('/kitchen');
      } catch (error) {
        submit.disabled = false;
        status.textContent = '';
        if (error instanceof ApiError && error.status === 422) {
          for (const [key, message] of Object.entries(error.fieldErrors)) {
            const entry = fields[key as keyof typeof fields];
            if (entry) setFieldError(entry.error, message);
          }
          const firstBad = Object.keys(error.fieldErrors)[0] as keyof typeof inputs | undefined;
          if (firstBad && inputs[firstBad]) inputs[firstBad].focus();
          return;
        }
        status.textContent = GENERIC_ERROR;
      }
    })();
  });

  root.append(
    el('div', { class: 'main' }, [
      el('div', { class: 'narrow' }, [
        el('p', { class: 'wordmark' }, [
          el('span', { text: BRAND_NAME }),
          document.createTextNode(PRODUCT_NAME),
        ]),
        el('h1', { text: 'Apply' }),
        form,
        el('p', {}, [el('a', { text: 'Sign in', attrs: { href: '/' } })]),
      ]),
    ]),
  );

  inputs.business_name.focus();
}
