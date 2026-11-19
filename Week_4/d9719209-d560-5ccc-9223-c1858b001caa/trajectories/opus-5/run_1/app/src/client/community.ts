import { copy } from '../shared/copy.js';
import { request } from './api.js';
import { alertAnnounce, applyFieldErrors, on, qs } from './dom.js';

/** Creation refusals land on their field, except the eligibility ones, which are announced. */
export function initCreateCommunity(): void {
  const form = qs<HTMLFormElement>('[data-create-community]');
  if (!form) return;
  const submit = qs<HTMLButtonElement>('[data-submit]', form);

  on(form, 'submit', (event) => {
    event.preventDefault();
    const name = qs<HTMLInputElement>('#name', form);
    const title = qs<HTMLInputElement>('#title', form);
    const description = qs<HTMLTextAreaElement>('#description', form);
    const type = qs<HTMLInputElement>('input[name="type"]:checked', form);

    if (submit) {
      submit.textContent = copy.community.pending;
      submit.disabled = true;
    }

    void (async () => {
      const result = await request<{ name: string }>('/api/communities', {
        method: 'POST',
        body: {
          name: name?.value.trim() ?? '',
          title: title?.value.trim() ?? '',
          description: description?.value ?? '',
          type: type?.value ?? 'public',
        },
      });
      if (submit) {
        submit.textContent = 'Create community';
        submit.disabled = false;
      }
      if (result.ok && result.data) {
        window.location.assign(`/c/${result.data.name}`);
        return;
      }
      if (result.error?.fields) {
        applyFieldErrors(form, result.error.fields);
        return;
      }
      if (result.error?.code === 'NOT_ELIGIBLE') {
        alertAnnounce(result.error.message);
        return;
      }
      alertAnnounce(result.error?.message ?? 'That did not work');
    })();
  });
}
