import { request } from '../api';
import { COPY, TYPE_LABELS } from '../copy';
import { button, clear, el, labelled, row, table } from '../dom';
import { StatusRegion, showFieldError } from '../status';
import type { AppContext } from '../main';
import type { DocumentJson, DocumentType } from '../../shared/types';

export function renderDocuments(container: HTMLElement, ctx: AppContext): void {
  const memberOrNull = ctx.me.member;
  if (memberOrNull === null) return;
  const member = memberOrNull;
  const status = new StatusRegion('Document status');
  const coverage = el('ul', { role: 'list', 'aria-label': 'Coverage', class: 'coverage-list' });
  const documents = table('Your documents', ['Type', 'Expiry', 'Status', 'File']);

  const typeSelect = el('select', { 'aria-label': 'Document type', id: 'doc-type' });
  for (const [value, label] of Object.entries(TYPE_LABELS)) {
    typeSelect.append(el('option', { value, text: label }));
  }
  const expiry = el('input', { type: 'date' });
  const coverageAmount = el('input', { type: 'text', inputmode: 'numeric' });
  const additionalInsured = el('input', { type: 'checkbox' });
  const file = el('input', { type: 'file', accept: 'application/pdf,image/png,image/jpeg' });
  const submit = button('Upload document', { class: 'primary', type: 'submit' });
  const coverageField = labelled(
    'Coverage per occurrence (USD)',
    coverageAmount,
    'doc-coverage',
  );
  const insuredField = el('div', { class: 'field field-check' });
  additionalInsured.id = 'doc-insured';
  insuredField.append(
    additionalInsured,
    el('label', {
      for: 'doc-insured',
      text: `Names ${ctx.me.user.tenant.legal_name} as additional insured`,
    }),
  );
  const fileField = labelled('File', file, 'doc-file');
  fileField.append(
    el('p', { class: 'hint', text: 'PDF, PNG or JPEG, up to 5,000,000 bytes' }),
  );
  const form = el('form', { class: 'upload-form', novalidate: true }, [
    el('h2', { text: 'Upload a document' }),
    el('div', { class: 'field' }, [el('label', { for: 'doc-type', text: 'Document type' }), typeSelect]),
    labelled('Expiry date', expiry, 'doc-expiry'),
    coverageField,
    insuredField,
    fileField,
    submit,
  ]);

  container.append(
    el('section', { class: 'documents-body' }, [
      el('div', { class: 'documents-main' }, [
        el('h2', { text: 'Coverage' }),
        coverage,
        documents.root,
      ]),
      form,
    ]),
    status.element,
  );

  function syncInsuranceFields(): void {
    const isInsurance = typeSelect.value === 'certificate_of_insurance';
    coverageField.hidden = !isInsurance;
    insuredField.hidden = !isInsurance;
  }
  typeSelect.addEventListener('change', syncInsuranceFields);
  syncInsuranceFields();

  function drawCoverage(): void {
    clear(coverage);
    const today = ctx.siteById(member.home_site_id)?.local_date ?? '';
    for (const [type, label] of Object.entries(TYPE_LABELS)) {
      const validThrough = member.valid_through[type as DocumentType];
      let text: string;
      if (validThrough === null) text = `${label}: none on file`;
      else if (validThrough < today) text = `${label}: expired ${validThrough}`;
      else text = `${label}: valid through ${validThrough}`;
      coverage.append(el('li', { role: 'listitem', text }));
    }
  }

  function statusText(document: DocumentJson): string {
    if (document.status === 'pending') return 'Pending review';
    if (document.status === 'verified') return 'Verified';
    return `Rejected: ${document.rejection_reason ?? ''}`;
  }

  function drawDocuments(list: DocumentJson[]): void {
    clear(documents.body);
    for (const document of list) {
      const open = el('a', {
        href: `/api/documents/${document.id}/file`,
        class: 'inline-link',
        text: 'Open',
      });
      documents.body.append(
        row([
          { label: 'Type', content: TYPE_LABELS[document.type] ?? document.type },
          { label: 'Expiry', content: document.expiry_date },
          { label: 'Status', content: statusText(document) },
          { label: 'File', content: open },
        ]),
      );
    }
  }

  function loadDocuments(): void {
    void request<{ documents: DocumentJson[] }>('/api/documents').then((result) => {
      if (result.ok) drawDocuments(result.data.documents);
    });
  }

  function refreshCoverage(): void {
    void request<{ member: typeof member }>('/api/me').then((result) => {
      if (!result.ok || result.data.member === null) return;
      member.valid_through = result.data.member.valid_through;
      drawCoverage();
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submit.getAttribute('aria-disabled') === 'true') return;
    const body = new FormData();
    body.set('type', typeSelect.value);
    body.set('expiry_date', expiry.value);
    if (typeSelect.value === 'certificate_of_insurance') {
      body.set('per_occurrence_limit', coverageAmount.value);
      body.set('names_additional_insured', additionalInsured.checked ? 'true' : 'false');
    }
    const chosen = file.files?.[0];
    if (chosen !== undefined) body.set('file', chosen, chosen.name);
    submit.setAttribute('aria-disabled', 'true');
    status.write(COPY.uploading);
    void request<{ document: DocumentJson }>('/api/documents', { method: 'POST', form: body }).then(
      (result) => {
        submit.setAttribute('aria-disabled', 'false');
        if (result.ok) {
          status.write(COPY.uploaded(TYPE_LABELS[result.data.document.type] ?? ''));
          form.reset();
          syncInsuranceFields();
          loadDocuments();
          refreshCoverage();
          return;
        }
        const code = result.error.code;
        const fields = result.error.fields ?? {};
        if (code === 'unsupported_type') status.write(COPY.unsupportedType);
        else if (code === 'file_too_large') status.write(COPY.fileTooLarge);
        else if (code === 'storage_unavailable') status.write(COPY.storageUnavailableUpload);
        else if (code === 'validation') {
          if (fields.per_occurrence_limit !== undefined) {
            showFieldError(coverageAmount, COPY.coverageTooLow);
            status.write(COPY.coverageTooLow);
          } else if (fields.names_additional_insured !== undefined) {
            showFieldError(
              additionalInsured,
              COPY.additionalInsured(ctx.me.user.tenant.legal_name),
            );
            status.write(COPY.additionalInsured(ctx.me.user.tenant.legal_name));
          } else if (fields.expiry_date !== undefined) {
            showFieldError(expiry, COPY.expiryDateRequired);
            status.write(COPY.expiryDateRequired);
          } else if (fields.file !== undefined) {
            showFieldError(file, COPY.fileRequired);
            status.write(COPY.fileRequired);
          } else {
            status.write(COPY.internal);
          }
        } else if (result.status === 0) status.write(COPY.offline);
        else if (code === 'csrf_failed') status.write(COPY.csrf);
        else status.write(COPY.internal);
      },
    );
  });

  drawCoverage();
  loadDocuments();
}
