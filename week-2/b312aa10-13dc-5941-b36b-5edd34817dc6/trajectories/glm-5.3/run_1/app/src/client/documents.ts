import { api, apiOrNull, ApiFailure, freshKey, type DocumentRecord } from './api.js';
import { h, clear, DOC_STATUS_WORDS, money } from './ui.js';
import { announce, showAlert, refreshBannerSoon, type AppState } from './main.js';

const DOC_TYPES = ['insurance_certificate', 'food_handler_card'] as const;

export async function renderDocuments(main: HTMLElement, state: AppState): Promise<void> {
  const session = state.session!;
  const container = h('div', { id: 'documents-container' });
  const isMember = session.user.role === 'member';
  let uploadForm: HTMLElement | null = null;
  let errorLine = h('p', { class: 'field-error' });
  let alertText = '';
  const getAlertText = (): string => alertText;
  const setAlertText = (text: string): void => {
    alertText = text;
    showAlert(text);
  };
  const getError = (): string => errorLine.textContent ?? '';
  const setError = (text: string): void => {
    errorLine.textContent = text;
  };
  if (isMember) {
    uploadForm = buildUploadForm(state, getAlertText, setAlertText, () => void reload());
    main.append(uploadForm);
    errorLine = uploadForm.querySelector('.field-error') as HTMLElement;
  }
  main.append(container);
  // The layout switches at exactly 768 CSS pixels, live, keeping rows, focus,
  // the alert, field errors and the upload form's values.
  const applyLayout = () => {
    const wide = window.innerWidth >= 768;
    const docs = (container as HTMLElement & { __docs?: DocumentRecord[] }).__docs;
    if (docs) drawRows(container, docs, state, wide);
  };
  window.addEventListener('resize', applyLayout);
  await reload();

  async function reload(): Promise<void> {
    const result = await apiOrNull<{ documents: DocumentRecord[] }>('GET', '/api/documents');
    if (!result) return;
    (container as HTMLElement & { __docs?: DocumentRecord[] }).__docs = result.data.documents;
    const wide = window.innerWidth >= 768;
    drawRows(container, result.data.documents, state, wide);
  }
}

function buildUploadForm(
  state: AppState,
  getAlert: () => string,
  setAlert: (text: string) => void,
  after: () => void,
): HTMLElement {
  const typeSelect = h('select', { 'aria-label': 'Document type' }) as HTMLSelectElement;
  typeSelect.append(h('option', { value: 'insurance_certificate', text: 'Insurance certificate' }));
  typeSelect.append(h('option', { value: 'food_handler_card', text: 'Food-handler card' }));
  const expiryInput = h('input', { type: 'text', 'aria-label': 'Expiry date', value: '' }) as HTMLInputElement;
  const fileInput = h('input', { type: 'file', 'aria-label': 'File' }) as HTMLInputElement;
  const error = h('p', { class: 'field-error' });
  const button = h('button', { text: 'Upload', onclick: async () => {
    setAlert('');
    error.textContent = '';
    const file = fileInput.files?.[0];
    announce(`Uploading ${file?.name ?? ''}…`);
    (button as HTMLButtonElement).disabled = true;
    button.setAttribute('aria-busy', 'true');
    const form = new FormData();
    form.append('type', typeSelect.value);
    form.append('expiryDate', expiryInput.value);
    if (file) form.append('file', file);
    try {
      await api('POST', '/api/documents', form);
      announce('Uploaded. Waiting for approval.');
      fileInput.value = '';
      after();
    } catch (err) {
      announce('');
      const failure = err as ApiFailure;
      if (failure instanceof ApiFailure && failure.body.error === 'validation_failed' && failure.body.errors) {
        error.textContent = Object.values(failure.body.errors)[0] ?? '';
      } else if (failure instanceof ApiFailure) {
        setAlert(failure.body.message);
      } else {
        setAlert('Lineboard could not reach the server. Check the connection and try again.');
      }
    }
    (button as HTMLButtonElement).disabled = false;
    button.removeAttribute('aria-busy');
  } });
  return h('div', { class: 'panel', role: 'region', 'aria-label': 'Upload' },
    h('h2', { class: 'display', text: 'Upload a document' }),
    h('label', { text: 'Document type' }, typeSelect),
    h('label', { text: 'Expiry date' }, expiryInput),
    h('label', { text: 'File' }, fileInput),
    error,
    button,
  );
}

function drawRows(container: HTMLElement, docs: DocumentRecord[], state: AppState, wide: boolean): void {
  const session = state.session!;
  const isOperator = session.user.role === 'operator';
  const focused = document.activeElement as HTMLElement | null;
  const focusedName = focused?.getAttribute('aria-label') ?? '';
  const busy = focused?.getAttribute('aria-busy') === 'true';
  clear(container);
  if (wide) {
    const table = h('table', { 'aria-label': 'Documents' });
    table.append(h('thead', {}, h('tr', {},
      h('th', { text: 'Business' }), h('th', { text: 'Type' }), h('th', { text: 'Status' }), h('th', { text: 'Version' }),
      h('th', { text: 'File' }), h('th', { text: 'Expires' }), h('th', { text: 'Actions' }),
    )));
    const body = h('tbody');
    for (const doc of docs) {
      const row = h('tr', {},
        h('td', { text: doc.businessName }),
        h('td', { text: doc.type === 'insurance_certificate' ? 'Insurance certificate' : 'Food-handler card' }),
        h('td', { text: DOC_STATUS_WORDS[doc.status] }),
        h('td', { text: String(doc.version) }),
        h('td', { text: doc.fileName }),
        h('td', { text: doc.expiryDate }),
        h('td', {},
          h('a', { href: `/api/documents/${doc.id}/file`, 'aria-label': `Download ${doc.type === 'insurance_certificate' ? 'insurance certificate' : 'food-handler card'}`, text: 'Download' }),
          isOperator && doc.status === 'submitted'
            ? h('button', { 'aria-label': `Approve ${doc.businessName} ${doc.type === 'insurance_certificate' ? 'insurance certificate' : 'food-handler card'}`, text: 'Approve', onclick: async (ev) => {
                const target = ev.target as HTMLElement;
                target.setAttribute('aria-busy', 'true');
                (target as HTMLButtonElement).disabled = true;
                announce('Approving…');
                try {
                  await api('POST', `/api/documents/${doc.id}/approve`, { version: doc.version });
                  announce(`Approved ${doc.businessName} ${doc.type === 'insurance_certificate' ? 'insurance certificate' : 'food-handler card'}.`);
                  window.location.reload();
                } catch (err) {
                  announce('');
                  const failure = err as ApiFailure;
                  if (failure instanceof ApiFailure) showAlert(failure.body.message);
                  else showAlert('Lineboard could not reach the server. Check the connection and try again.');
                  target.removeAttribute('aria-busy');
                  (target as HTMLButtonElement).disabled = false;
                }
              } })
            : null,
        ),
      );
      body.append(row);
    }
    table.append(body);
    container.append(table);
  } else {
    const list = h('ul', { 'aria-label': 'Documents' });
    for (const doc of docs) {
      const item = h('li', { class: 'doc-card' },
        h('span', { class: 'doc-pair' }, h('b', { text: 'Business' }), h('span', { text: doc.businessName })),
        h('span', { class: 'doc-pair' }, h('b', { text: 'Type' }), h('span', { text: doc.type === 'insurance_certificate' ? 'Insurance certificate' : 'Food-handler card' })),
        h('span', { class: 'doc-pair' }, h('b', { text: 'Status' }), h('span', { text: DOC_STATUS_WORDS[doc.status] })),
        h('span', { class: 'doc-pair' }, h('b', { text: 'Version' }), h('span', { text: String(doc.version) })),
        h('span', { class: 'doc-pair' }, h('b', { text: 'File' }), h('span', { text: doc.fileName })),
        h('span', { class: 'doc-pair' }, h('b', { text: 'Expires' }), h('span', { text: doc.expiryDate })),
        h('a', { href: `/api/documents/${doc.id}/file`, 'aria-label': `Download ${doc.type === 'insurance_certificate' ? 'insurance certificate' : 'food-handler card'}`, text: 'Download' }),
        isOperator && doc.status === 'submitted'
          ? h('button', { 'aria-label': `Approve ${doc.businessName} ${doc.type === 'insurance_certificate' ? 'insurance certificate' : 'food-handler card'}`, text: 'Approve', onclick: async (ev) => {
              const target = ev.target as HTMLElement;
              target.setAttribute('aria-busy', 'true');
              (target as HTMLButtonElement).disabled = true;
              announce('Approving…');
              try {
                await api('POST', `/api/documents/${doc.id}/approve`, { version: doc.version });
                announce(`Approved ${doc.businessName} ${doc.type === 'insurance_certificate' ? 'insurance certificate' : 'food-handler card'}.`);
                window.location.reload();
              } catch (err) {
                announce('');
                const failure = err as ApiFailure;
                if (failure instanceof ApiFailure) showAlert(failure.body.message);
                else showAlert('Lineboard could not reach the server. Check the connection and try again.');
                target.removeAttribute('aria-busy');
                (target as HTMLButtonElement).disabled = false;
              }
            } })
          : null,
      );
      list.append(item);
    }
    container.append(list);
  }
  if (focusedName && !busy) {
    const next = container.querySelector(`[aria-label="${CSS.escape(focusedName)}"]`) as HTMLElement | null;
    next?.focus();
  }
}
