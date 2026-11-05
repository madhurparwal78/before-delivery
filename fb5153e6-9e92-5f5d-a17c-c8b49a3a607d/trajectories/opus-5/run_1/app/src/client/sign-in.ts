import { one } from './dom.js';
import type { Role } from '../shared/roles.js';
import { call } from './api.js';
import { showFailure } from './forms.js';
import { localeFromLang, withLang } from '../shared/locale.js';
import { destinationAfterSignIn } from '../shared/roles.js';

const form = one<HTMLFormElement>('[data-sign-in-form]');
const alertNode = one('[data-sign-in-alert]');
const locale = localeFromLang(new URL(window.location.href).searchParams.get('lang'));

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    try {
      const reply = await call<{ role: Role; landing: string }>('/api/session', {
        method: 'POST',
        locale,
        body: {
          email: one<HTMLInputElement>('[name="email"]', form)?.value ?? '',
          password: one<HTMLInputElement>('[name="password"]', form)?.value ?? '',
        },
      });
      const destination = destinationAfterSignIn(reply.role, form.dataset.next ?? null);
      window.location.assign(
        withLang(destination, new URL(window.location.href).searchParams.get('lang')),
      );
    } catch (error) {
      showFailure(alertNode, error, locale, form);
    }
  })();
});
