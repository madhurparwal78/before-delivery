import type { RenterDocument } from '../../shared/types.js';
import { api, firstFieldMessage } from '../api.js';
import { copy } from '../copy.js';
import { clear, el, fieldError, labelled, setStatus, statusRegion } from '../dom.js';

const DOCUMENT_TITLES: Record<string, string> = {
  liability: 'Liability certificate',
  food_handler: 'Food handler card',
};

function statusCell(document: RenterDocument, today: string): string {
  if (document.valid_from > today) return 'Not yet valid';
  if (document.expires_on < today) return 'Expired';
  const days = Math.round(
    (Date.parse(`${document.expires_on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  return days <= 14 ? `Expires in ${days} days` : 'Current';
}

export function documentsScreen(host: HTMLElement): void {
  const status = statusRegion('Documents status');
  const kind = el('select', { class: 'select', 'aria-label': 'Document type' }, [
    el('option', { value: 'liability' }, ['Liability certificate']),
    el('option', { value: 'food_handler' }, ['Food handler card']),
  ]);
  const validFrom = el('input', { type: 'text', class: 'input mono', 'aria-label': 'Valid from', placeholder: 'YYYY-MM-DD' });
  const expiresOn = el('input', { type: 'text', class: 'input mono', 'aria-label': 'Expires on', placeholder: 'YYYY-MM-DD' });
  const file = el('input', { type: 'file', class: 'input file', accept: '.pdf,.png,.jpg,.jpeg' });
  const error = fieldError();
  const upload = el('button', { type: 'submit', class: 'button primary' }, ['Upload document']);
  const body = el('tbody');
  const table = el('table', { class: 'data-table', 'aria-label': 'My documents' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['Type']),
        el('th', { scope: 'col' }, ['Valid from']),
        el('th', { scope: 'col' }, ['Expires on']),
        el('th', { scope: 'col' }, ['Status']),
        el('th', { scope: 'col' }, ['File']),
      ]),
    ]),
    body,
  ]);

  async function load(): Promise<void> {
    const result = await api.get<{ documents: RenterDocument[] }>('/api/documents');
    if (!result.ok) return;
    const today = new Date().toISOString().slice(0, 10);
    clear(body);
    for (const document of result.data.documents) {
      body.append(
        el('tr', {}, [
          el('td', {}, [DOCUMENT_TITLES[document.kind] ?? document.kind]),
          el('td', { class: 'mono' }, [document.valid_from]),
          el('td', { class: 'mono' }, [document.expires_on]),
          el('td', {}, [statusCell(document, today)]),
          el('td', {}, [
            el('a', { href: `/api/documents/${document.id}/file`, class: 'link', target: '_blank', rel: 'noreferrer' }, [
              'Open file',
            ]),
          ]),
        ]),
      );
    }
  }

  const form = el('form', { class: 'document-form' }, [
    labelled('Document type', kind),
    labelled('Valid from', validFrom),
    labelled('Expires on', expiresOn),
    labelled('Document file', file, { hint: 'Document file (PDF, PNG or JPEG)' }),
    upload,
    error,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    error.textContent = '';
    const payload = new FormData();
    payload.set('kind', kind.value);
    payload.set('valid_from', validFrom.value.trim());
    payload.set('expires_on', expiresOn.value.trim());
    const chosen = file.files?.[0];
    if (chosen !== undefined) payload.set('file', chosen);
    setStatus(status, copy.uploading);
    void api.postForm<{ document: RenterDocument }>('/api/documents', payload).then(async (result) => {
      if (!result.ok) {
        const message =
          result.status === 415
            ? copy.unsupportedFile
            : result.status === 413
              ? copy.fileTooLarge
              : firstFieldMessage(result.error);
        error.textContent = message;
        setStatus(status, message);
        return;
      }
      setStatus(status, copy.documentSaved);
      form.reset();
      await load();
    });
  });

  host.append(
    el('section', { class: 'panel' }, [el('h1', {}, ['Documents']), form, status]),
    el('section', { class: 'panel' }, [
      el('h2', {}, ['My documents']),
      el('div', { class: 'table-frame' }, [table]),
    ]),
  );
  void load();
}
