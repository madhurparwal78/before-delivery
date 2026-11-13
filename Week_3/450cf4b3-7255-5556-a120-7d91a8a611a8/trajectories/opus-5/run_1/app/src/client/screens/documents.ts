import { request } from '../api';
import { el, focusElement, setText } from '../dom';
import { DOCUMENTS_MS, Refreshes } from '../refresh';
import { announce, heading, type Screen, type ScreenContext } from '../shell';
import { session, type UploadDraft } from '../state';
import * as copy from '../copy';
import { formatDateLabel, isoDate } from '../../shared/format';
import type { DocumentKind, DocumentRecord, Me } from '../../shared/types';

interface Row {
  id: string;
  node: HTMLTableRowElement;
  cells: HTMLTableCellElement[];
}

export async function mountDocuments(ctx: ScreenContext): Promise<Screen> {
  const user = ctx.user;
  if (user === null) return { unmount: () => undefined };

  const level1 = heading('Your documents');
  const statusLine = el('p', { className: 'tenant-status' });
  const form = el('form', {
    className: 'upload-form',
    attrs: { 'aria-label': 'Upload document', novalidate: '' },
  });

  const typeGroup = el('div', {
    className: 'radio-group',
    attrs: { role: 'radiogroup', 'aria-label': 'Document type' },
  });
  const kinds: ReadonlyArray<{ value: DocumentKind; label: string }> = [
    { value: 'insurance_certificate', label: 'Certificate of insurance' },
    { value: 'food_handler_card', label: 'Food-handler card' },
  ];
  const radios: HTMLInputElement[] = [];
  for (const kind of kinds) {
    const id = `doc-kind-${kind.value}`;
    const radio = el('input', {
      className: 'field-radio',
      attrs: { type: 'radio', name: 'kind', id, value: kind.value, 'aria-label': kind.label },
    });
    const label = el('label', { text: kind.label, className: 'radio-label', attrs: { for: id } });
    typeGroup.append(radio, label);
    radios.push(radio);
  }
  const firstRadio = radios[0];
  if (firstRadio !== undefined) firstRadio.checked = true;

  const expiresLabel = el('label', {
    text: 'Expires on',
    className: 'field-label',
    attrs: { for: 'doc-expires' },
  });
  const expires = el('input', {
    className: 'field-input',
    attrs: { id: 'doc-expires', type: 'date', name: 'expiresOn', 'aria-label': 'Expires on' },
  });
  const expiresError = el('p', { className: 'field-error', attrs: { id: 'doc-expires-error' } });

  const insuranceFields = el('div', { className: 'insurance-fields' });
  const limitLabel = el('label', {
    text: 'Per-occurrence limit (dollars)',
    className: 'field-label',
    attrs: { for: 'doc-limit' },
  });
  const limit = el('input', {
    className: 'field-input',
    attrs: {
      id: 'doc-limit',
      type: 'text',
      name: 'perOccurrenceLimit',
      'aria-label': 'Per-occurrence limit (dollars)',
      inputmode: 'numeric',
    },
  });
  const limitError = el('p', { className: 'field-error', attrs: { id: 'doc-limit-error' } });
  const insuredId = 'doc-insured';
  const insured = el('input', {
    className: 'field-checkbox',
    attrs: {
      id: insuredId,
      type: 'checkbox',
      name: 'additionalInsured',
      'aria-label': 'Names Halfsheet Commissary as additional insured',
    },
  });
  const insuredLabel = el('label', {
    text: 'Names Halfsheet Commissary as additional insured',
    className: 'checkbox-label',
    attrs: { for: insuredId },
  });
  const insuredError = el('p', { className: 'field-error', attrs: { id: 'doc-insured-error' } });
  insuranceFields.append(limitLabel, limit, limitError, insured, insuredLabel, insuredError);

  const fileLabel = el('label', { text: 'File', className: 'field-label', attrs: { for: 'doc-file' } });
  const file = el('input', {
    className: 'field-input',
    attrs: { id: 'doc-file', type: 'file', name: 'file', 'aria-label': 'File' },
  });
  const fileError = el('p', { className: 'field-error', attrs: { id: 'doc-file-error' } });
  const help = el('p', { text: 'PDF, PNG or JPEG', className: 'help-text' });
  const uploadButton = el('button', {
    text: 'Upload',
    className: 'button primary',
    attrs: { type: 'submit' },
  });
  const outcome = el('p', { className: 'outcome-copy' });

  form.append(
    typeGroup,
    expiresLabel,
    expires,
    expiresError,
    insuranceFields,
    fileLabel,
    file,
    fileError,
    help,
    uploadButton,
    outcome,
  );

  const table = el('table', { className: 'data-table', attrs: { 'aria-label': 'Documents on file' } });
  const head = el('thead');
  const headRow = el('tr');
  for (const column of ['Type', 'Expires', 'Cover', 'Uploaded', 'Fingerprint', 'File']) {
    headRow.append(el('th', { text: column, attrs: { scope: 'col' } }));
  }
  head.append(headRow);
  const body = el('tbody');
  table.append(head, body);

  ctx.root.append(level1, statusLine, form, table);
  focusElement(level1);

  const refreshes = new Refreshes();
  let statusLabel: string | null = null;
  const rows = new Map<string, Row>();

  const showInsuranceFields = (): void => {
    const checked = radios.find((radio) => radio.checked);
    const isInsurance = checked?.value === 'insurance_certificate';
    insuranceFields.classList.toggle('hidden', !isInsurance);
    if (!isInsurance) {
      limitError.textContent = '';
      insuredError.textContent = '';
    }
  };
  for (const radio of radios) {
    radio.addEventListener('change', showInsuranceFields);
  }
  showInsuranceFields();

  const saveDraft = (): void => {
    const checked = radios.find((radio) => radio.checked);
    session.uploadDraft = {
      userId: user.id,
      kind: checked?.value ?? 'insurance_certificate',
      expiresOn: expires.value,
      perOccurrenceLimit: limit.value,
      additionalInsured: insured.checked,
      file: file.files?.[0] ?? null,
    };
  };

  const hasNonDefaultValue = (): boolean =>
    expires.value !== '' ||
    limit.value !== '' ||
    insured.checked ||
    (file.files?.length ?? 0) > 0 ||
    radios[1]?.checked === true;

  const restoreDraft = (draft: UploadDraft): void => {
    for (const radio of radios) radio.checked = radio.value === draft.kind;
    showInsuranceFields();
    expires.value = draft.expiresOn;
    limit.value = draft.perOccurrenceLimit;
    insured.checked = draft.additionalInsured;
    if (draft.file !== null) {
      try {
        const transfer = new DataTransfer();
        transfer.items.add(draft.file);
        file.files = transfer.files;
      } catch {
        // the browser kept no way to re-attach the file
      }
    }
    outcome.textContent = copy.upload.restored;
    announce(copy.upload.restored);
  };

  const drawRow = (document_: DocumentRecord): void => {
    let row = rows.get(document_.id);
    if (row === undefined) {
      const node = el('tr');
      const cells = [0, 1, 2, 3, 4, 5].map(() => el('td'));
      for (const cell of cells) node.append(cell);
      body.append(node);
      row = { id: document_.id, node, cells };
      rows.set(document_.id, row);
    }
    const [type, expiry, cover, uploaded, fingerprint, fileCell] = row.cells;
    if (type !== undefined) setText(type, copy.documentTypeLabel(document_.kind));
    if (expiry !== undefined) setText(expiry, formatDateLabel(document_.expiresOn));
    if (cover !== undefined) {
      setText(cover, copy.coverLabel(document_.coverState, document_.daysLeft));
      cover.className = `cover cover-${document_.coverState}`;
    }
    if (uploaded !== undefined) setText(uploaded, formatDateLabel(isoDate(document_.uploadedAt)));
    if (fingerprint !== undefined) {
      setText(fingerprint, copy.fingerprintText(document_.sha256));
      fingerprint.className = 'mono';
    }
    if (fileCell !== undefined) {
      if (!document_.hasFile) {
        setText(fileCell, 'On paper');
      } else if (fileCell.querySelector('a') === null) {
        fileCell.textContent = '';
        fileCell.append(
          el('a', {
            text: 'Open',
            className: 'link',
            attrs: {
              href: `/api/documents/${document_.id}/file`,
              target: '_blank',
              rel: 'noreferrer',
            },
          }),
        );
      }
    }
  };

  const draw = (documents: ReadonlyArray<DocumentRecord>): void => {
    const seen = new Set<string>();
    for (const document_ of documents) {
      drawRow(document_);
      seen.add(document_.id);
    }
    for (const [id, row] of rows) {
      if (!seen.has(id)) {
        row.node.remove();
        rows.delete(id);
      }
    }
    for (const [index, document_] of documents.entries()) {
      const row = rows.get(document_.id);
      if (row !== undefined && body.children[index] !== row.node) body.append(row.node);
    }
  };

  const readStatus = async (): Promise<void> => {
    const me = await request<Me>('GET', '/api/me');
    if (me.kind === 'error' && me.status === 401 && hasNonDefaultValue()) saveDraft();
    if (me.kind !== 'ok' || me.body.tenant === null) return;
    session.user = me.body;
    const label = copy.tenantStatusLabel(me.body.tenant.status, me.body.tenant.suspendedReason);
    setText(statusLine, `Status: ${label}`);
    if (statusLabel !== null && statusLabel !== label) announce(copy.statusChange(label));
    statusLabel = label;
  };

  const readDocuments = async (): Promise<void> => {
    const result = await request<{ documents: DocumentRecord[] }>('GET', '/api/documents');
    if (result.kind === 'error' && result.status === 401 && hasNonDefaultValue()) saveDraft();
    if (result.kind !== 'ok') return;
    draw(result.body.documents);
  };

  let uploading = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (uploading) return;
    uploading = true;
    uploadButton.setAttribute('aria-disabled', 'true');
    expiresError.textContent = '';
    limitError.textContent = '';
    insuredError.textContent = '';
    fileError.textContent = '';
    outcome.textContent = copy.upload.pending;
    announce(copy.upload.pending);

    const checked = radios.find((radio) => radio.checked);
    const kind = (checked?.value ?? 'insurance_certificate') as DocumentKind;
    const form_ = new FormData();
    form_.set('kind', kind);
    form_.set('expiresOn', expires.value);
    if (kind === 'insurance_certificate') {
      form_.set('perOccurrenceLimit', limit.value);
      form_.set('additionalInsured', insured.checked ? 'true' : 'false');
    }
    const chosen = file.files?.[0];
    if (chosen !== undefined) form_.set('file', chosen, chosen.name);

    void (async () => {
      const result = await request<DocumentRecord>('POST', '/api/documents', { form: form_ });
      uploading = false;
      uploadButton.removeAttribute('aria-disabled');
      if (result.kind === 'stale') return;
      if (result.kind === 'ok') {
        const message = copy.upload.success(result.body.kind, result.body.expiresOn);
        outcome.textContent = message;
        announce(message);
        session.uploadDraft = null;
        await readStatus();
        await readDocuments();
        return;
      }
      if (result.kind === 'network') {
        outcome.textContent = copy.generic;
        announce(copy.generic);
        return;
      }
      if (result.status === 401) {
        saveDraft();
        return;
      }
      if (result.status === 503) {
        outcome.textContent = copy.upload.storageDown;
        announce(copy.upload.storageDown);
        return;
      }
      if (result.status === 422) {
        outcome.textContent = '';
        const messages = result.fields;
        const bind = (
          node: HTMLInputElement,
          errorNode: HTMLElement,
          name: string,
        ): void => {
          const message = messages[name];
          if (message === undefined) return;
          errorNode.textContent = message;
          node.setAttribute('aria-describedby', errorNode.id);
          if (outcome.textContent === '') {
            outcome.textContent = message;
            announce(message);
          }
        };
        bind(expires, expiresError, 'expiresOn');
        bind(limit, limitError, 'perOccurrenceLimit');
        bind(insured, insuredError, 'additionalInsured');
        bind(file, fileError, 'file');
        return;
      }
      outcome.textContent = copy.generic;
      announce(copy.generic);
    })();
  });

  const draft = session.uploadDraft;
  if (draft !== null && draft.userId === user.id) {
    restoreDraft(draft);
    session.uploadDraft = null;
  }

  await readStatus();
  await readDocuments();
  refreshes.every(DOCUMENTS_MS, () => {
    void readStatus();
    void readDocuments();
  });

  return {
    unmount: () => {
      refreshes.stop();
    },
  };
}
