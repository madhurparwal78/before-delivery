import { api, ApiCallError } from './api.js';
import { openDialog } from './dialog.js';
import { el, on } from './dom.js';
import { labelledField } from './forms.js';
import { announce, statusRegion } from './status.js';

const DECISIONS: { value: string; label: string }[] = [
  { value: 'approve', label: 'Approve' },
  { value: 'request_changes', label: 'Request changes' },
  { value: 'reject', label: 'Reject' },
];

export function approvalStatusRegion(): HTMLElement {
  return statusRegion('Approval status');
}

export function openDecideDialog(options: {
  taskId: string;
  taskName: string;
  opener: HTMLElement | null;
}): void {
  openDialog({
    name: `Decide on ${options.taskName}`,
    opener: options.opener,
    build: (handle) => {
      const group = el('div', { role: 'radiogroup', 'aria-label': 'Decision', class: 'stack' });
      const radios: HTMLInputElement[] = [];
      for (const decision of DECISIONS) {
        const input = el('input', {
          type: 'radio',
          name: 'decision',
          value: decision.value,
          'aria-label': decision.label,
          id: `decision-${decision.value}`,
        }) as HTMLInputElement;
        radios.push(input);
        group.appendChild(
          el('label', { class: 'radio' }, [input, el('span', {}, decision.label)]),
        );
      }
      const comment = labelledField({ name: 'Comment', kind: 'textarea' });
      const submit = el('button', { type: 'submit', class: 'pill pill--dark' }, 'Submit decision');
      const cancel = el('button', { type: 'button', class: 'pill pill--ghost' }, 'Cancel');
      on(cancel, 'click', handle.close);
      const form = el('form', { class: 'dialog-body stack' }, [
        el('h2', { class: 'dialog-title' }, `Decide on ${options.taskName}`),
        group,
        comment.wrap,
        el('div', { class: 'dialog-actions' }, [submit, cancel]),
      ]) as HTMLFormElement;
      on(form, 'submit', (event) => {
        event.preventDefault();
        if (submit.getAttribute('aria-busy') === 'true') return;
        const chosen = radios.find((radio) => radio.checked);
        submit.setAttribute('aria-busy', 'true');
        void api
          .post<{ status: string }>(`/api/tasks/${options.taskId}/decision`, {
            decision: chosen ? chosen.value : '',
            comment: (comment.input as HTMLTextAreaElement).value,
          })
          .then(() => {
            handle.close();
          })
          .catch((err) => {
            if (err instanceof ApiCallError) {
              comment.setError(err.failure.errors?.comment ?? null);
              if (err.failure.errors?.decision) {
                announce('Approval status', err.failure.errors.decision);
              }
              if (err.failure.error === 'already_decided') {
                announce('Approval status', 'This approval was already decided');
              }
            }
            submit.removeAttribute('aria-busy');
          });
      });
      return form;
    },
  });
}
