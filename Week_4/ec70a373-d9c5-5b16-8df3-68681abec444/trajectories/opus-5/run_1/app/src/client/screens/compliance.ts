import { request } from '../api';
import { COPY, TYPE_LABELS } from '../copy';
import { Dialog } from '../dialog';
import { button, clear, el, row, table } from '../dom';
import { StatusRegion, showFieldError } from '../status';
import type { DocumentJson } from '../../shared/types';

type QueueDocument = DocumentJson & { business_name: string };

export function renderCompliance(container: HTMLElement): void {
  const status = new StatusRegion('Compliance status');
  const queue = table('Documents awaiting review', [
    'Member',
    'Type',
    'Expiry',
    'Uploaded',
    'Actions',
  ]);
  container.append(el('h1', { text: 'Compliance' }), queue.root, status.element);

  function load(): void {
    void request<{ documents: QueueDocument[] }>('/api/documents?status=pending').then((result) => {
      if (!result.ok) return;
      clear(queue.body);
      for (const document of result.data.documents) {
        const actions = el('div', { class: 'row-actions' });
        const open = el('a', {
          href: `/api/documents/${document.id}/file`,
          class: 'inline-link',
          text: 'Open file',
        });
        const verify = button('Verify');
        const reject = button('Reject');
        verify.addEventListener('click', () => void sendVerify(document, verify));
        reject.addEventListener('click', () => openRejectDialog(document, reject));
        actions.append(open, verify, reject);
        queue.body.append(
          row([
            { label: 'Member', content: document.business_name },
            { label: 'Type', content: TYPE_LABELS[document.type] ?? document.type },
            { label: 'Expiry', content: document.expiry_date },
            { label: 'Uploaded', content: document.created_at.slice(0, 10) },
            { label: 'Actions', content: actions },
          ]),
        );
      }
    });
  }

  async function sendVerify(document: QueueDocument, pressed: HTMLElement): Promise<void> {
    if (pressed.getAttribute('aria-disabled') === 'true') return;
    pressed.setAttribute('aria-disabled', 'true');
    status.write(COPY.saving);
    const result = await request<{ valid_through: string }>(
      `/api/documents/${document.id}/verify`,
      { method: 'POST', body: {} },
    );
    pressed.setAttribute('aria-disabled', 'false');
    if (result.ok) {
      status.write(COPY.verified(document.business_name, result.data.valid_through));
      load();
      return;
    }
    const code = result.error.code;
    if (code === 'invalid_transition') status.write(COPY.alreadyReviewed);
    else if (code === 'document_expired') status.write(COPY.documentExpired);
    else if (code === 'csrf_failed') status.write(COPY.csrf);
    else if (result.status === 401) return;
    else if (result.status === 0) status.write(COPY.offline);
    else status.write(COPY.internal);
    load();
  }

  function openRejectDialog(document: QueueDocument, opener: HTMLElement): void {
    const reason = el('textarea', { 'aria-label': 'Reason', rows: '3', id: 'reject-reason' });
    const confirm = button('Reject document', { class: 'primary' });
    const close = button('Close');
    const dialog = new Dialog({ title: 'Reject document', opener });
    dialog.body.append(
      el('div', { class: 'field' }, [
        el('label', { for: 'reject-reason', text: 'Reason' }),
        reason,
      ]),
      confirm,
      close,
    );
    close.addEventListener('click', () => dialog.close());
    confirm.addEventListener('click', () => {
      if (confirm.getAttribute('aria-disabled') === 'true') return;
      confirm.setAttribute('aria-disabled', 'true');
      status.write(COPY.saving);
      void request(`/api/documents/${document.id}/reject`, {
        method: 'POST',
        body: { reason: reason.value },
      }).then((result) => {
        confirm.setAttribute('aria-disabled', 'false');
        if (result.ok) {
          dialog.close();
          status.write(
            COPY.rejected(TYPE_LABELS[document.type] ?? document.type, document.business_name),
          );
          load();
          return;
        }
        if (result.error.code === 'validation') {
          showFieldError(reason, COPY.reasonRequired);
          status.write(COPY.reasonRequired);
          return;
        }
        if (result.error.code === 'invalid_transition') {
          dialog.close();
          status.write(COPY.alreadyReviewed);
          load();
          return;
        }
        if (result.status === 401) return;
        status.write(result.status === 0 ? COPY.offline : COPY.internal);
      });
    });
    dialog.open(reason);
  }

  load();
}
