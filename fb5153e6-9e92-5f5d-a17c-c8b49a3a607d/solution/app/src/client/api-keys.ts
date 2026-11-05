import { all, one } from './dom.js';
import { call } from './api.js';
import { notifyThenRefresh, showFailure } from './forms.js';
import { localeFromLang } from '../shared/locale.js';
import { s } from '../shared/strings.js';

const locale = localeFromLang(new URL(window.location.href).searchParams.get('lang'));
const alertNode = one('[data-keys-alert]');
const form = one<HTMLFormElement>('[data-create-key]');

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    try {
      const reply = await call<{ key: string }>('/api/studio/api-keys', {
        method: 'POST',
        locale,
        body: { name: one<HTMLInputElement>('[name="name"]', form)?.value ?? '' },
      });
      notifyThenRefresh(`${s('noticeKeyCreated', locale)} ${reply.key}`);
    } catch (error) {
      showFailure(alertNode, error, locale, form);
    }
  })();
});

for (const button of all<HTMLButtonElement>('[data-revoke-key]')) {
  button.addEventListener('click', () => {
    void (async () => {
      await call(`/api/studio/api-keys/${button.dataset.revokeKey ?? ''}`, {
        method: 'DELETE',
        locale,
      });
      notifyThenRefresh(s('noticeKeyRevoked', locale));
    })();
  });
}
