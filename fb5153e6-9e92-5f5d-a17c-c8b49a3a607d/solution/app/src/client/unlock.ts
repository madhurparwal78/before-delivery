import { one } from './dom.js';
import { call } from './api.js';
import { showFailure } from './forms.js';
import { localeFromLang } from '../shared/locale.js';

const form = one<HTMLFormElement>('[data-unlock-form]');
const alertNode = one('[data-unlock-alert]');
const locale = localeFromLang(new URL(window.location.href).searchParams.get('lang'));

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    try {
      await call<void>(`/api/models/${form.dataset.unlockForm ?? ''}/unlock`, {
        method: 'POST',
        locale,
        body: { password: one<HTMLInputElement>('[name="password"]', form)?.value ?? '' },
      });
      window.location.reload();
    } catch (error) {
      showFailure(alertNode, error, locale, form);
    }
  })();
});
