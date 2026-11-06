import { one } from './dom.js';
import { call } from './api.js';
import { notify, showFailure } from './forms.js';
import { wireUploadForm } from './upload.js';
import { localeFromLang } from '../shared/locale.js';
import { s } from '../shared/strings.js';

const locale = localeFromLang(new URL(window.location.href).searchParams.get('lang'));

const uploadForm = one<HTMLFormElement>('[data-contrib-upload]');
if (uploadForm !== null) {
  wireUploadForm(uploadForm, '/api/contrib/models', one('[data-upload-alert]'));
}

const textureForm = one<HTMLFormElement>('[data-texture-form]');
const textureAlert = one('[data-texture-alert]');
textureForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    try {
      await call('/api/contrib/texture-sets', {
        method: 'POST',
        locale,
        form: new FormData(textureForm),
      });
      notify(s('noticeTextureSet', locale));
      if (textureAlert !== null) textureAlert.textContent = '';
    } catch (error) {
      showFailure(textureAlert, error, locale, textureForm);
    }
  })();
});
