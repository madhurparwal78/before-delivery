import { api, state, el, clear, longDateFromKey } from '../lib.js';
import { announce } from '../live.js';
import { readKitchen, buildHeader, removeHeader, startClockText } from '../header.js';

// Documents: the tenant status line, the upload form that survives refreshes,
// and the documents-on-file table with cover labels and fingerprints.

interface DocumentJson {
  id: string; kind: string; expiresOn: string; perOccurrenceLimit: number | null;
  additionalInsured: boolean | null; contentType: string | null; sizeBytes: number | null;
  sha256: string | null; hasFile: boolean; current: boolean; coverState: string;
  daysLeft: number | null; uploadedAt: string;
  notices: Array<{ point: string; status: string; sentAt: string | null }>;
}

interface UploadDraft {
  kind: string;
  expiresOn: string;
  limit: string;
  insured: boolean;
  file: File | null;
}

let draft: UploadDraft | null = null;
let draftUserId: string | null = null;
let zone = 'UTC';

export function saveUploadDraft(me: { id: string } | null, d: UploadDraft | null): void {
  if (me === null || d === null) {
    draft = null;
    draftUserId = null;
    return;
  }
  draft = d;
  draftUserId = me.id;
}

export function restoreUploadDraft(me: { id: string }): UploadDraft | null {
  return draftUserId === me.id ? draft : null;
}

export function renderDocuments(app: HTMLElement, url: URL): () => void {
  const timers: number[] = [];
  let destroyed = false;
  void url;

  const boot = async () => {
    const kitchen = await readKitchen();
    if (!kitchen || destroyed) return;
    zone = kitchen.timeZone;
    removeHeader();
    buildHeader({ role: state.me!.role, displayName: state.me!.displayName });
    const stopClock = startClockText({ clockText: document.querySelector('.clock-text') as HTMLElement, menuButton: null, menuPanel: null }, zone);

    const heading = el('h1', { class: 'screen-heading' }, 'Your documents');
    const statusLine = el('p', { class: 'tenant-status' }, 'Status: …');
    const formWrap = el('div', { class: 'upload-wrap' });
    const tableWrap = el('div', { class: 'docs-wrap' });

    // ---- upload form ----
    const form = el('form', { 'aria-label': 'Upload document', class: 'upload-form' }) as HTMLFormElement;
    const kindSelect = el('select', { 'aria-label': 'Document type', role: 'radiogroup' }) as HTMLSelectElement;
    const optInsurance = el('option', { value: 'insurance_certificate' }, 'Certificate of insurance') as HTMLOptionElement;
    const optFood = el('option', { value: 'food_handler_card' }, 'Food-handler card') as HTMLOptionElement;
    kindSelect.append(optInsurance, optFood);
    const expiresInput = el('input', { type: 'date', 'aria-label': 'Expires on', class: 'dialog-input' }) as HTMLInputElement;
    const limitInput = el('input', { type: 'text', 'aria-label': 'Per-occurrence limit (dollars)', class: 'dialog-input' }) as HTMLInputElement;
    const insuredCheck = el('input', { type: 'checkbox', 'aria-label': 'Names Halfsheet Commissary as additional insured' }) as HTMLInputElement;
    const fileInput = el('input', { type: 'file', 'aria-label': 'File' }) as HTMLInputElement;
    const uploadBtn = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Upload') as HTMLButtonElement;
    const uploadError = el('p', { class: 'field-error', hidden: '' });

    const insuranceRow = el('div', { class: 'insurance-fields' }, limitInput, insuredCheck);

    form.append(
      el('label', {}, 'Document type'),
      kindSelect,
      el('label', {}, 'Expires on'),
      expiresInput,
      insuranceRow,
      el('label', {}, 'File'),
      fileInput,
      el('p', { class: 'help-text' }, 'PDF, PNG or JPEG'),
      uploadBtn,
      uploadError,
    );

    kindSelect.addEventListener('change', () => {
      insuranceRow.hidden = kindSelect.value !== 'insurance_certificate';
    });
    insuranceRow.hidden = kindSelect.value !== 'insurance_certificate';

    const restore = restoreUploadDraft(state.me!);
    if (restore) {
      kindSelect.value = restore.kind;
      expiresInput.value = restore.expiresOn;
      limitInput.value = restore.limit;
      insuredCheck.checked = restore.insured;
      const dataTransfer = new DataTransfer();
      if (restore.file) dataTransfer.items.add(restore.file);
      fileInput.files = dataTransfer.files;
      insuranceRow.hidden = restore.kind !== 'insurance_certificate';
      announce('Your upload wasn\'t sent. Check it and press Upload.');
      const restoredCopy = el('p', { class: 'restored-copy' }, 'Your upload wasn\'t sent. Check it and press Upload.');
      form.appendChild(restoredCopy);
    }

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      uploadError.hidden = true;
      uploadError.textContent = '';
      const fd = new FormData();
      fd.set('kind', kindSelect.value);
      fd.set('expiresOn', expiresInput.value);
      if (kindSelect.value === 'insurance_certificate') {
        fd.set('perOccurrenceLimit', limitInput.value);
        fd.set('additionalInsured', insuredCheck.checked ? 'true' : 'false');
      }
      if (fileInput.files && fileInput.files.length > 0) {
        fd.set('file', fileInput.files[0]);
      }
      uploadBtn.setAttribute('aria-disabled', 'true');
      const r = await api('POST', '/api/documents', { form: fd });
      if (r.sentUnder !== state.sessionId || destroyed) return;
      if (r.status === 401) {
        // Keep the draft in page memory for the same account.
        saveUploadDraft(state.me, {
          kind: kindSelect.value,
          expiresOn: expiresInput.value,
          limit: limitInput.value,
          insured: insuredCheck.checked,
          file: fileInput.files?.[0] ?? null,
        });
        return;
      }
      uploadBtn.removeAttribute('aria-disabled');
      if (r.status === 201 && r.ok) {
        const doc = r.ok as DocumentJson;
        announce(`Uploaded. ${kindLabel(doc.kind)} on file through ${longDateFromKey(doc.expiresOn, zone)}.`);
        saveUploadDraft(state.me, null);
        form.reset();
        insuranceRow.hidden = false;
        await load();
        return;
      }
      if (r.fail && r.fail.body?.fields) {
        const first = Object.values(r.fail.body.fields)[0];
        uploadError.textContent = first;
        uploadError.hidden = false;
      } else if (r.fail) {
        uploadError.textContent = r.fail.body?.message ?? 'Document storage is unreachable. Nothing was saved; try again shortly.';
        uploadError.hidden = false;
      }
    });

    formWrap.appendChild(form);

    // ---- table ----
    const load = async () => {
      const r = await api('GET', '/api/documents');
      if (destroyed || r.status !== 200 || !r.ok) return;
      if (r.sentUnder !== state.sessionId) return;
      const data = r.ok as { documents: DocumentJson[] };
      const me = state.me!;
      if (me.tenant && data.documents.length > 0 || me.tenant) {
        const status = me.tenant?.status ?? 'applied';
        const label = statusLabel(status);
        if (statusLine.textContent !== `Status: ${label}`) {
          const previous = statusLine.textContent;
          statusLine.textContent = `Status: ${label}`;
          if (previous !== 'Status: …' && previous !== statusLine.textContent) {
            announce(`Status changed: ${label}.`);
          }
        }
      }
      clear(tableWrap);
      const table = el('table', { 'aria-label': 'Documents on file', class: 'docs-table' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Type'), el('th', {}, 'Expires'), el('th', {}, 'Cover'),
          el('th', {}, 'Uploaded'), el('th', {}, 'Fingerprint'), el('th', {}, 'File'))),
      ) as HTMLTableElement;
      const body = el('tbody', {});
      for (const doc of data.documents) {
        body.appendChild(el('tr', {},
          el('td', {}, kindLabel(doc.kind)),
          el('td', {}, doc.expiresOn),
          el('td', {}, coverLabel(doc)),
          el('td', {}, longDateFromKey(dateKeyOf(doc.uploadedAt), zone)),
          el('td', { class: 'mono' }, doc.sha256 ? doc.sha256.slice(0, 12) : '—'),
          el('td', {}, doc.hasFile
            ? (doc.contentType === 'application/pdf'
              ? el('a', { href: `/api/documents/${doc.id}/file`, target: '_blank' }, 'Open')
              : el('a', { href: `/api/documents/${doc.id}/file` }, 'Open'))
            : 'On paper'),
        ));
      }
      table.appendChild(body);
      tableWrap.appendChild(table);
    };

    app.append(heading, statusLine, formWrap, tableWrap);

    await load();
    timers.push(window.setInterval(() => { void load(); }, 10_000));

    return () => {
      destroyed = true;
      stopClock();
      for (const t of timers) clearInterval(t);
      removeHeader();
    };
  };

  let cleanupFn: (() => void) | null = null;
  void boot().then((fn) => { cleanupFn = fn ?? null; });
  return () => {
    destroyed = true;
    cleanupFn?.();
  };
}

export function statusLabel(status: string): string {
  if (status === 'applied') return 'Applied — upload your documents';
  if (status === 'documents_pending') return 'Waiting for review';
  if (status === 'approved') return 'Approved';
  if (status === 'suspended') return 'Suspended';
  return status;
}

function coverLabel(doc: DocumentJson): string {
  if (doc.coverState === 'ok') return 'Valid';
  if (doc.coverState === 'expires_soon') return doc.daysLeft === 1 ? 'Expires in 1 day' : `Expires in ${doc.daysLeft} days`;
  if (doc.coverState === 'expires_today') return 'Expires today';
  if (doc.coverState === 'lapsed') return 'Lapsed';
  return 'Superseded';
}

function kindLabel(kind: string): string {
  return kind === 'insurance_certificate' ? 'Certificate of insurance' : 'Food-handler card';
}

function dateKeyOf(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/\//g, '-');
}
