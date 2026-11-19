import { copy, REPORT_CATEGORIES } from '../shared/copy.js';
import { request } from './api.js';
import { announce, qs } from './dom.js';
import { openDialog, radioGroup, selectedRadio } from './overlays.js';
import { isSignedIn } from './state.js';

export function openReportDialog(
  target: { type: 'post' | 'comment'; id: string },
  opener: HTMLElement | null,
): void {
  const needsEmail = !isSignedIn();
  const dialog = openDialog({
    title: 'Report illegal content',
    opener,
    body: `
      ${radioGroup('category', 'Type of illegal content', REPORT_CATEGORIES.map((option) => ({ value: option.value, label: option.label })))}
      <p class="field-error" id="category-error" hidden></p>
      <div class="field">
        <label for="explanation">Explain why this is illegal</label>
        <textarea id="explanation" rows="4" aria-describedby="explanation-error"></textarea>
        <p class="field-error" id="explanation-error" hidden></p>
      </div>
      ${
        needsEmail
          ? `<div class="field">
               <label for="reporterEmail">Your email</label>
               <input id="reporterEmail" type="email" aria-describedby="reporterEmail-error" />
               <p class="field-error" id="reporterEmail-error" hidden></p>
             </div>`
          : ''
      }
      <div class="field checkbox">
        <input id="goodFaith" type="checkbox" />
        <label for="goodFaith">I believe this report is accurate and complete</label>
        <p class="field-error" id="goodFaith-error" hidden></p>
      </div>
      <div class="dialog-actions">
        <button type="button" data-confirm>Send report</button>
        <button type="button" data-dialog-cancel>Cancel</button>
      </div>`,
  });

  const showError = (id: string, message: string | null): HTMLElement | null => {
    const node = qs<HTMLElement>(`#${id}-error`, dialog.element);
    if (node) {
      node.textContent = message ?? '';
      node.hidden = message === null;
    }
    const field = qs<HTMLElement>(`#${id}`, dialog.element);
    if (field) {
      if (message === null) field.removeAttribute('aria-invalid');
      else field.setAttribute('aria-invalid', 'true');
    }
    return message === null ? null : field;
  };

  qs('[data-confirm]', dialog.element)?.addEventListener('click', () => {
    const category = selectedRadio(dialog.element, 'category');
    const explanation = qs<HTMLTextAreaElement>('#explanation', dialog.element)?.value.trim() ?? '';
    const email = qs<HTMLInputElement>('#reporterEmail', dialog.element)?.value.trim() ?? '';
    const goodFaith = qs<HTMLInputElement>('#goodFaith', dialog.element)?.checked === true;

    let firstInvalid: HTMLElement | null = null;
    firstInvalid = showError('category', category === null ? copy.report.categoryRequired : null) ?? firstInvalid;
    const explanationField = showError('explanation', explanation === '' ? copy.report.explanationRequired : null);
    firstInvalid = firstInvalid ?? explanationField;
    if (needsEmail) {
      const emailField = showError('reporterEmail', /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? null : copy.report.emailInvalid);
      firstInvalid = firstInvalid ?? emailField;
    }
    const goodFaithField = showError('goodFaith', goodFaith ? null : copy.report.goodFaithRequired);
    firstInvalid = firstInvalid ?? goodFaithField;

    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    const confirm = qs<HTMLButtonElement>('[data-confirm]', dialog.element);
    if (confirm) confirm.textContent = copy.report.pending;

    void (async () => {
      const result = await request<{ reference: string }>('/api/reports', {
        method: 'POST',
        body: {
          targetType: target.type,
          targetId: target.id,
          category,
          explanation,
          reporterEmail: needsEmail ? email : undefined,
          goodFaith: true,
        },
      });
      if (confirm) confirm.textContent = 'Send report';
      if (!result.ok || !result.data) {
        const fields = result.error?.fields ?? {};
        for (const [name, message] of Object.entries(fields)) showError(name, message);
        return;
      }
      announce(copy.report.sent(result.data.reference));
      dialog.element.innerHTML = `
        <h2 class="dialog-title">${copy.report.receivedHeading}</h2>
        <p>${copy.report.reference(result.data.reference)}</p>
        <div class="dialog-actions"><button type="button" data-dialog-cancel>Close</button></div>`;
      const close = qs<HTMLButtonElement>('[data-dialog-cancel]', dialog.element);
      close?.addEventListener('click', () => dialog.close());
      close?.focus();
    })();
  });
}
