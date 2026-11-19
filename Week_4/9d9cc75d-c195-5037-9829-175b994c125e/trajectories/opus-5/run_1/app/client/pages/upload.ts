import { type ApiErrorBody, sendCsv, uploadErrors } from '../api.js';
import { clear, el } from '../dom.js';
import { session } from '../session.js';
import { navigate } from '../shell.js';
import type { FieldType } from '../../shared/types.js';

export interface PreviewReply {
  columns: { name: string; type: FieldType }[];
  rows: (string | null)[][];
  row_count: number;
  errors: { line: number | null; message: string }[];
}

let handoff: string | null = null;

export function takeUploadMessage(): string | null {
  const message = handoff;
  handoff = null;
  return message;
}

export interface UploadPanel {
  root: HTMLElement;
  status: HTMLElement;
  reset: () => void;
}

export function buildUploadPanel(options: {
  projectId: () => string;
  tableName: () => string;
  upload: (bytes: ArrayBuffer) => Promise<{ status: number; data: ApiErrorBody & { id?: string; tables?: { name: string; rows: number }[] } }>;
  onUploaded: (reply: { id?: string; tables?: { name: string; rows: number }[] }, tableName: string, rows: number) => void;
}): UploadPanel {
  const status = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Upload state', class: 'status' });
  const errorList = el('ul', { class: 'upload-errors', 'aria-label': 'Upload errors' });
  const previewTable = el('table', { class: 'data-table', 'aria-label': 'Preview' });
  const fileInput = el('input', { type: 'file', accept: '.csv,text/csv', class: 'visually-hidden', id: 'csv-file' });
  const chooseButton = el('button', { type: 'button', class: 'pill-button', text: 'Choose file' });
  const uploadButton = el('button', { type: 'button', class: 'pill-button primary', text: 'Upload' });
  const retryButton = el('button', { type: 'button', class: 'pill-button', text: 'Try again', hidden: true });
  const fileName = el('p', { class: 'muted' });

  let bytes: ArrayBuffer | null = null;

  const drawPreview = (reply: PreviewReply): void => {
    clear(previewTable);
    const head = el('tr', {}, reply.columns.map((column) =>
      el('th', { scope: 'col', 'data-type': column.type, text: column.name }),
    ));
    previewTable.append(el('thead', {}, [head]));
    previewTable.append(
      el(
        'tbody',
        {},
        reply.rows.map((row) => el('tr', {}, row.map((cell) => el('td', { text: cell ?? '(null)' })))),
      ),
    );
    clear(errorList);
    for (const error of reply.errors) {
      errorList.append(el('li', { text: error.message }));
    }
  };

  chooseButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    void (async () => {
      const file = fileInput.files?.[0];
      if (file === undefined) return;
      fileName.textContent = file.name;
      bytes = await file.arrayBuffer();
      const res = await sendCsv<PreviewReply & ApiErrorBody>(
        'POST',
        `/api/projects/${options.projectId()}/sources/preview`,
        bytes,
      );
      const reply = res.data as PreviewReply;
      if (Array.isArray(reply.columns)) drawPreview(reply);
      status.textContent = '';
    })();
  });

  const doUpload = async (): Promise<void> => {
    if (bytes === null) return;
    status.textContent = 'Uploading...';
    status.classList.remove('banner');
    retryButton.hidden = true;
    const res = await options.upload(bytes);
    if (res.status === 503) {
      status.textContent = 'Storage is unavailable. Your file was not saved. Try again.';
      status.classList.add('banner');
      retryButton.hidden = false;
      return;
    }
    if (res.status === 201 || res.status === 200) {
      const table = options.tableName();
      const rows = res.data.tables?.find((t) => t.name === table)?.rows ?? 0;
      status.textContent = `Uploaded ${table}: ${rows} rows.`;
      clear(errorList);
      options.onUploaded(res.data, table, rows);
      return;
    }
    status.textContent = '';
    clear(errorList);
    for (const error of uploadErrors(res.data)) errorList.append(el('li', { text: error.message }));
    if (errorList.childElementCount === 0) {
      const errors = res.data.errors;
      if (errors !== undefined && !Array.isArray(errors)) {
        for (const message of Object.values(errors)) errorList.append(el('li', { text: message }));
      }
    }
  };

  uploadButton.addEventListener('click', () => {
    void doUpload();
  });
  retryButton.addEventListener('click', () => {
    void doUpload();
  });

  const root = el('div', { class: 'upload-panel' }, [
    el('div', { class: 'row' }, [chooseButton, fileInput, fileName, uploadButton, retryButton]),
    status,
    errorList,
    previewTable,
  ]);
  return { root, status, reset: () => {
    bytes = null;
    clear(previewTable);
    clear(errorList);
    status.textContent = '';
  } };
}

export function uploadPage(host: HTMLElement, _params: Record<string, string>, query: URLSearchParams): void {
  document.body.dataset.field = 'ground';
  const projects = (session.me?.projects ?? []).filter((p) => p.role === 'creator');
  const projectSelect = el('select', { id: 'upload-project', class: 'input' },
    projects.map((project) => el('option', { value: project.id, text: project.name })),
  );
  const asked = query.get('project');
  if (asked !== null) projectSelect.value = asked;
  const sourceName = el('input', { type: 'text', id: 'source-name', class: 'input' });
  const tableName = el('input', { type: 'text', id: 'table-name', class: 'input', value: 'orders' });

  const panel = buildUploadPanel({
    projectId: () => projectSelect.value,
    tableName: () => tableName.value,
    upload: (bytes) =>
      sendCsv<ApiErrorBody & { id?: string; tables?: { name: string; rows: number }[] }>(
        'POST',
        `/api/projects/${projectSelect.value}/sources?name=${encodeURIComponent(sourceName.value)}&table=${encodeURIComponent(tableName.value)}`,
        bytes,
      ),
    onUploaded: (reply, table, rows) => {
      handoff = `Uploaded ${table}: ${rows} rows.`;
      if (reply.id !== undefined) navigate(`/sources/${reply.id}`);
    },
  });

  host.append(
    el('div', { class: 'page upload-page' }, [
      el('h1', { text: 'Upload a source' }),
      el('div', { class: 'card' }, [
        el('label', { for: 'upload-project', text: 'Project' }),
        projectSelect,
        el('label', { for: 'source-name', text: 'Source name' }),
        sourceName,
        el('label', { for: 'table-name', text: 'Table name' }),
        tableName,
        panel.root,
      ]),
    ]),
  );
}
