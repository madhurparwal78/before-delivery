import { one } from './dom.js';
import { ApiCallError, uploadWithProgress } from './api.js';
import { showFailure } from './forms.js';
import { localeFromLang } from '../shared/locale.js';
import { uploadingPercent } from '../shared/strings.js';
import { fieldMessageFromEnglish, errorMessage } from '../shared/copy.js';
import type { ErrorCode } from '../shared/copy.js';

const lang = new URL(window.location.href).searchParams.get('lang');
const locale = localeFromLang(lang);

interface Failure {
  error?: string;
  message?: string;
  fields?: Record<string, string>;
}

/** Shared by the author's upload screen, Replace source and the contributor form. */
export function wireUploadForm(
  form: HTMLFormElement,
  endpoint: string,
  alertNode: Element | null,
  extra: Readonly<Record<string, string>> = {},
): void {
  const progress = one<HTMLProgressElement>('[data-upload-progress]');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const data = new FormData(form);
      for (const [name, value] of Object.entries(extra)) data.set(name, value);
      if (alertNode !== null) alertNode.textContent = '';
      const reply = await uploadWithProgress(endpoint, data, (percent) => {
        if (progress === null) return;
        progress.value = percent;
        progress.setAttribute('aria-valuetext', uploadingPercent(percent, locale));
      });
      if (reply.status === 202) {
        const body = reply.body as { queue_url: string };
        const url = new URL(body.queue_url, window.location.origin);
        if (lang !== null) url.searchParams.set('lang', lang);
        window.location.assign(url.toString());
        return;
      }
      const failure = reply.body as Failure;
      const fields: Record<string, string> = {};
      for (const [name, english] of Object.entries(failure.fields ?? {})) {
        fields[name] = fieldMessageFromEnglish(english, locale);
      }
      const code = (failure.error ?? 'not_found') as ErrorCode;
      let message: string;
      try {
        message = errorMessage(code, locale);
        if (message.includes('<') && failure.message !== undefined) message = failure.message;
      } catch {
        message = failure.message ?? '';
      }
      showFailure(
        alertNode,
        new ApiCallError({ code, message, fields, status: reply.status }),
        locale,
        form,
      );
    })();
  });
}

const uploadForm = one<HTMLFormElement>('[data-upload-form]');
if (uploadForm !== null) {
  wireUploadForm(uploadForm, '/api/studio/uploads', one('[data-upload-alert]'));
}
