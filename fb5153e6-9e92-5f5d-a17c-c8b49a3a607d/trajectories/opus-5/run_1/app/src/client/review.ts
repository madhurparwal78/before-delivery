import { all, one } from './dom.js';
import { call } from './api.js';
import { notifyThenRefresh, showFailure } from './forms.js';
import { localeFromLang } from '../shared/locale.js';
import { movedToState } from '../shared/strings.js';
import { stateLabel } from '../shared/labels.js';

const locale = localeFromLang(new URL(window.location.href).searchParams.get('lang'));
const notices = one('[data-studio-notices]');

for (const button of all<HTMLButtonElement>('[data-review-transition]')) {
  button.addEventListener('click', () => {
    void (async () => {
      const to = button.dataset.reviewTransition ?? '';
      try {
        await call(`/api/studio/models/${button.dataset.slug ?? ''}/transitions`, {
          method: 'POST',
          locale,
          body: { to },
        });
        notifyThenRefresh(movedToState(stateLabel(to as 'draft', locale), locale));
      } catch (error) {
        showFailure(notices, error, locale, null);
      }
    })();
  });
}
