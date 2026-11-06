import { formatCount, formatTime, shortEtag } from '../src/format';
import { ApiFailure, api, buildQuery, queryOf } from './api';
import { button, el, field, openDialog, replace, setStatus, statusRegion, textbox } from './dom';
import { deleteStatus, lifecycleStatus, results, storageOutage, suspensionBanner, upload as uploadCopy } from './copy';
import { mountInspector, type InspectorHandles } from './inspector';
import type { Bucket, ConsoleContext, ObjectPage, ObjectRow } from './types';

export interface ObjectViewState {
  prefix: string;
  tagFilter: string;
  cursor: string | null;
  prev: string[];
  objectKey: string | null;
  search: string;
}

interface UploadTarget {
  fixedKey: string | null;
  versionId: string | null;
  etag: string | null;
}

function randomKey(): string {
  return `idem-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function parseTags(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  const pairs = trimmed.split(',').map((part) => part.trim()).filter((part) => part !== '');
  const encoded: string[] = [];
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index < 0) return null;
    encoded.push(`${encodeURIComponent(pair.slice(0, index).trim())}=${encodeURIComponent(pair.slice(index + 1).trim())}`);
  }
  return encoded.join('&');
}

interface UploadOutcome {
  status: number;
  body: { key: string; version_id: string; replicas: { state: string; role: string }[] };
}

function sendUpload(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (sent: number) => void,
): Promise<UploadOutcome> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('X-Requested-With', 'farshore');
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.addEventListener('progress', (event) => onProgress(event.loaded));
    request.addEventListener('load', () => {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(request.responseText);
      } catch {
        parsed = null;
      }
      if (request.status >= 200 && request.status < 300) {
        resolve({ status: request.status, body: parsed as UploadOutcome['body'] });
        return;
      }
      const failure = (parsed ?? {}) as { error?: string; message?: string; errors?: Record<string, string> };
      reject(
        new ApiFailure(
          request.status,
          failure.error ?? 'service_unavailable',
          failure.message ?? 'Upload failed.',
          failure.errors ?? {},
          (parsed ?? {}) as Record<string, unknown>,
        ),
      );
    });
    request.addEventListener('error', () => reject(new ApiFailure(0, 'service_unavailable', 'Upload failed.')));
    request.send(file);
  });
}

/** The centre zone: toolbar, object table, paging and the dialogs that act on them. */
export async function renderObjectView(options: {
  context: ConsoleContext;
  bucket: Bucket | null;
  bucketName: string;
  state: ObjectViewState;
}): Promise<{
  centre: HTMLElement;
  inspector: HTMLElement | null;
  focusHeading: () => void;
  focusInspector: (() => void) | null;
  stop: () => void;
}> {
  const { context, bucket, state } = options;
  const canWrite = context.role === 'developer' || context.role === 'owner';
  const base = bucket === null ? null : `/api/w/${context.slug}/buckets/${encodeURIComponent(bucket.name)}`;
  const originName =
    bucket === null ? '' : (context.regions.find((region) => region.id === bucket.placement[0])?.name ?? bucket.placement[0]);

  const heading = el('h2', { class: 'centre-heading', tabindex: '-1', text: options.bucketName });
  const breadcrumb = el('p', { class: 'breadcrumb', text: state.prefix === '' ? '/' : `/${state.prefix}` });
  const resultsStatus = el('p', { class: 'status', role: 'status', 'aria-label': 'Results status' });
  const uploadStatus = statusRegion('Upload status');
  const deleteStatusRegion = statusRegion('Delete status');
  const lifecycleStatusRegion = statusRegion('Lifecycle status');
  const progress = el('div', {
    class: 'progress',
    role: 'progressbar',
    'aria-label': 'Upload progress',
    'aria-valuemin': '0',
    'aria-valuenow': '0',
    'aria-valuemax': '0',
  });
  const deleteResults = el('ul', { class: 'delete-results', 'aria-label': 'Delete results' });
  const deleteResultsHolder = el('div', { class: 'delete-area' }, [deleteResults]);

  const search = el('input', {
    type: 'search',
    role: 'searchbox',
    'aria-label': 'Search objects',
    placeholder: 'Search objects',
    value: state.search,
  });
  const prefixInput = textbox('Prefix', { value: state.prefix, placeholder: 'Prefix' });
  const tagInput = textbox('Tag filter', { value: state.tagFilter, placeholder: 'env=qa and not team=art' });
  const applyButton = button('Apply filters', { focusKey: 'apply-filters' });

  const toolbar = el('div', { class: 'toolbar', role: 'group', 'aria-label': 'Object tools' }, [
    search,
    prefixInput,
    tagInput,
    applyButton,
  ]);

  const selected = new Set<string>();
  const selectAll = el('input', { type: 'checkbox', 'aria-label': 'Select all on this page' });
  const tableBody = el('tbody');
  const tableHead = el('thead');
  const table = el('table', { class: 'objects', 'aria-label': 'Objects' }, [tableHead, tableBody]);

  function renderHead(withBucket: boolean): void {
    replace(tableHead, [
      el('tr', {}, [
        canWrite ? el('th', { scope: 'col' }, [selectAll]) : null,
        el('th', { scope: 'col', text: 'Key' }),
        el('th', { scope: 'col', class: 'num', text: 'Size (bytes)' }),
        el('th', { scope: 'col', class: 'hide-narrow', text: 'Last modified (UTC)' }),
        withBucket
          ? el('th', { scope: 'col', text: 'Bucket' })
          : el('th', { scope: 'col', class: 'num', text: 'Regions (settled/placed)' }),
        el('th', { scope: 'col', class: 'hide-narrow', text: 'ETag' }),
      ]),
    ]);
  }
  renderHead(false);
  const tableFrame = el('div', { class: 'table-frame', id: 'objects' }, [table]);

  const previousButton = button('Previous page', { focusKey: 'previous-page' });
  const nextButton = button('Next page', { focusKey: 'next-page' });
  const paging = el('div', { class: 'paging' }, [previousButton, nextButton]);

  const centre = el('main', { class: 'centre' }, [heading, breadcrumb, toolbar]);
  let inspectorHandles: InspectorHandles | null = null;

  function navigateWith(next: Partial<ObjectViewState>, replaceEntry = false, focusKey?: string): void {
    const merged = { ...state, ...next };
    const query = buildQuery([
      queryOf('prefix', merged.prefix),
      queryOf('tag_filter', merged.tagFilter),
      merged.cursor === null ? null : queryOf('cursor', merged.cursor),
      ...merged.prev.map((entry) => `prev=${encodeURIComponent(entry)}`),
      merged.objectKey === null ? null : queryOf('object', merged.objectKey),
    ]);
    context.navigate(`/console/${context.slug}/${options.bucketName}${query}`, { replace: replaceEntry, focusKey });
  }

  applyButton.addEventListener('click', () => {
    navigateWith({ prefix: prefixInput.value, tagFilter: tagInput.value, cursor: null, prev: [], objectKey: null });
  });
  for (const input of [prefixInput, tagInput]) {
    input.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') applyButton.click();
    });
  }
  search.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key !== 'Enter') return;
    void runSearch(search.value);
  });

  async function runSearch(term: string): Promise<void> {
    setStatus(resultsStatus, results.pending);
    renderHead(true);
    try {
      const found = await api.get<{ items: { bucket: string; key: string; size: number; last_modified: string }[] }>(
        `/api/w/${context.slug}/search${buildQuery([queryOf('q', term)])}`,
      );
      replace(
        tableBody,
        found.body.items.map((item) =>
          el('tr', {}, [
            canWrite ? el('td') : null,
            el('td', {}, [
              (() => {
                const open = button(`Open ${item.key}`, { className: 'key-link', focusKey: `open:${item.bucket}:${item.key}` });
                open.textContent = item.key;
                open.setAttribute('aria-label', `Open ${item.key}`);
                open.addEventListener('click', () =>
                  context.navigate(`/console/${context.slug}/${item.bucket}${buildQuery([queryOf('object', item.key)])}`),
                );
                return open;
              })(),
            ]),
            el('td', { class: 'num mono', text: formatCount(item.size) }),
            el('td', { class: 'hide-narrow mono', text: formatTime(item.last_modified) }),
            el('td', { text: item.bucket }),
            el('td', { class: 'hide-narrow' }),
          ]),
        ),
      );
      setStatus(resultsStatus, found.body.items.length === 0 ? results.empty : results.count(found.body.items.length));
    } catch (error) {
      if (error instanceof ApiFailure) setStatus(resultsStatus, results.fieldError(error.errors.q ?? error.message));
    }
  }

  function uploadDialog(target: UploadTarget, files: File[], opener: HTMLElement | null): void {
    openDialog({
      name: 'Upload',
      opener,
      build: (dialog) => {
        const list = el('ul', { 'aria-label': 'Files to upload' });
        const chosen: File[] = [...files];
        const picker = el('input', { type: 'file', multiple: target.fixedKey === null, 'aria-label': 'Choose files' });
        const keyPrefix = textbox('Key prefix', { value: target.fixedKey === null ? state.prefix : '' });
        const tags = textbox('Tags', { value: '' });
        const onlyOverwrite = el('input', { type: 'checkbox', 'aria-label': 'Only overwrite the version I opened' });
        const start = button('Start upload', { className: 'primary' });
        const cancel = button('Cancel');

        function renderFiles(): void {
          replace(
            list,
            chosen.map((file) => el('li', { text: `${file.name} \u00b7 ${formatCount(file.size)} bytes` })),
          );
          start.disabled = chosen.length === 0;
        }
        picker.addEventListener('change', () => {
          const picked = (picker as HTMLInputElement).files;
          chosen.length = 0;
          if (picked) for (const file of Array.from(picked)) chosen.push(file);
          renderFiles();
        });
        renderFiles();

        let running = false;
        start.addEventListener('click', async () => {
          if (base === null) return;
          running = true;
          const tagging = parseTags(tags.value);
          if (tagging === null) {
            setStatus(uploadStatus, uploadCopy.tagError);
            running = false;
            return;
          }
          for (const file of chosen) {
            const key = target.fixedKey ?? `${keyPrefix.value}${file.name}`;
            const headers: Record<string, string> = {
              'X-Upload-Size': String(file.size),
              'Idempotency-Key': randomKey(),
              'Content-Type': file.type === '' ? 'application/octet-stream' : file.type,
            };
            if (tagging !== '') headers['x-amz-tagging'] = tagging;
            if (target.fixedKey !== null && (onlyOverwrite as HTMLInputElement).checked && target.etag !== null) {
              headers['If-Match'] = target.etag;
            }
            progress.setAttribute('aria-valuemax', String(file.size));
            progress.setAttribute('aria-valuenow', '0');
            setStatus(uploadStatus, uploadCopy.pending(file.name, 0, file.size));
            try {
              const stored = await sendUpload(
                `${base}/object${buildQuery([queryOf('key', key)])}`,
                file,
                headers,
                (sent) => {
                  progress.setAttribute('aria-valuenow', String(sent));
                  progress.style.setProperty('--sent', String(file.size === 0 ? 1 : sent / file.size));
                  setStatus(uploadStatus, uploadCopy.pending(file.name, sent, file.size));
                },
              );
              const pending = stored.body.replicas.filter((replica) => replica.state === 'pending').length;
              setStatus(uploadStatus, uploadCopy.success(stored.body.key, stored.body.version_id, pending));
            } catch (error) {
              if (!(error instanceof ApiFailure)) throw error;
              setStatus(
                uploadStatus,
                await uploadFailureCopy(error, {
                  fileName: file.name,
                  key,
                  context,
                  base,
                  bucketName: options.bucketName,
                  originRegionName: originName,
                }),
              );
              running = false;
              dialog.close();
              await reload();
              return;
            }
          }
          running = false;
          dialog.close();
          await reload();
        });
        cancel.addEventListener('click', () => {
          if (!running) {
            dialog.close();
            return;
          }
          openDialog({
            name: 'Stop uploading?',
            opener: cancel,
            build: (confirmDialog) => {
              confirmDialog.body.append(
                el('p', { text: 'Stop uploading? Files already stored stay stored.' }),
                el('div', { class: 'dialog-actions' }, [
                  button('Stop', {
                    className: 'primary',
                    onClick: () => {
                      confirmDialog.close();
                      dialog.close();
                    },
                  }),
                  button('Keep uploading', { onClick: () => confirmDialog.close() }),
                ]),
              );
            },
          });
        });

        dialog.body.append(
          el('h2', { text: target.fixedKey === null ? 'Upload' : 'Upload new version' }),
          list,
          field('Choose files', picker),
          target.fixedKey === null ? field('Key prefix', keyPrefix) : el('span'),
          field('Tags', tags, 'key=value, separated by commas'),
          target.fixedKey === null
            ? el('span')
            : el('div', { class: 'field' }, [
                onlyOverwrite,
                el('label', { text: 'Only overwrite the version I opened' }),
              ]),
          el('div', { class: 'dialog-actions' }, [start, cancel]),
        );
      },
    });
  }

  function lifecycleDialog(opener: HTMLElement): void {
    if (base === null) return;
    openDialog({
      name: 'Lifecycle rules',
      opener,
      build: async (dialog) => {
        const noncurrent = el('input', { type: 'number', 'aria-label': 'Expire noncurrent versions after (days)', min: '1', max: '3650' });
        const keep = el('input', { type: 'number', 'aria-label': 'Keep newest noncurrent versions', min: '0', max: '100' });
        const abort = el('input', { type: 'number', 'aria-label': 'Abort incomplete uploads after (days)', min: '1', max: '365' });
        const save = button('Save rules', { className: 'primary' });
        const noncurrentField = field('Expire noncurrent versions after (days)', noncurrent);
        const keepField = field('Keep newest noncurrent versions', keep);
        const abortField = field('Abort incomplete uploads after (days)', abort);
        dialog.body.append(
          el('h2', { text: 'Lifecycle rules' }),
          noncurrentField,
          keepField,
          abortField,
          el('div', { class: 'dialog-actions' }, [save, button('Cancel', { onClick: () => dialog.close() })]),
        );
        const rules = await api.get<{ noncurrent_days: number | null; keep_newest_noncurrent: number; abort_multipart_days: number | null }>(
          `${base}/lifecycle`,
        );
        (noncurrent as HTMLInputElement).value = rules.body.noncurrent_days === null ? '' : String(rules.body.noncurrent_days);
        (keep as HTMLInputElement).value = String(rules.body.keep_newest_noncurrent);
        (abort as HTMLInputElement).value = rules.body.abort_multipart_days === null ? '' : String(rules.body.abort_multipart_days);
        save.addEventListener('click', async () => {
          setStatus(lifecycleStatusRegion, lifecycleStatus.pending);
          const payload = {
            noncurrent_days: (noncurrent as HTMLInputElement).value === '' ? null : Number((noncurrent as HTMLInputElement).value),
            keep_newest_noncurrent: (keep as HTMLInputElement).value === '' ? 0 : Number((keep as HTMLInputElement).value),
            abort_multipart_days: (abort as HTMLInputElement).value === '' ? null : Number((abort as HTMLInputElement).value),
          };
          try {
            await api.put(`${base}/lifecycle`, payload);
            setStatus(lifecycleStatusRegion, lifecycleStatus.success(options.bucketName));
            dialog.close();
          } catch (error) {
            if (!(error instanceof ApiFailure)) throw error;
            setStatus(lifecycleStatusRegion, lifecycleStatus.fieldError);
            for (const [name, node] of [
              ['noncurrent_days', noncurrentField],
              ['keep_newest_noncurrent', keepField],
              ['abort_multipart_days', abortField],
            ] as const) {
              const target = node.querySelector('.field-error');
              if (target) target.textContent = error.errors[name] ?? '';
            }
          }
        });
      },
    });
  }

  let undoButton: HTMLButtonElement | null = null;

  async function runBulkDelete(keys: string[], opener: HTMLElement | null): Promise<void> {
    if (base === null) return;
    const idempotencyKey = randomKey();
    setStatus(deleteStatusRegion, deleteStatus.pending(keys.length));
    try {
      const outcome = await api.post<{
        batch_id: string | null;
        undo_until: string | null;
        results: { key: string; outcome: string }[];
      }>(`${base}/objects/delete`, { keys }, { 'Idempotency-Key': idempotencyKey });
      replace(
        deleteResults,
        outcome.body.results.map((entry) => el('li', { text: deleteStatus.item(entry.key, entry.outcome) })),
      );
      const deleted = outcome.body.results.filter((entry) => entry.outcome === 'deleted').length;
      const missing = outcome.body.results.length - deleted;
      setStatus(
        deleteStatusRegion,
        outcome.body.undo_until === null
          ? deleteStatus.success(deleted, missing, new Date().toISOString())
          : deleteStatus.success(deleted, missing, outcome.body.undo_until),
      );
      if (outcome.body.batch_id !== null) showUndo(outcome.body.batch_id);
      selected.clear();
      await reload();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setStatus(deleteStatusRegion, error.code === 'storage_unavailable' ? storageOutage : error.message);
    }
    if (opener) opener.focus();
  }

  function showUndo(batchId: string): void {
    if (undoButton) undoButton.remove();
    undoButton = button('Undo delete', { focusKey: 'undo-delete' });
    undoButton.addEventListener('click', async () => {
      setStatus(deleteStatusRegion, deleteStatus.undoPending);
      try {
        const undone = await api.post<{ results: { key: string; outcome: string }[] }>(
          `/api/w/${context.slug}/batches/${batchId}/undo`,
        );
        replace(
          deleteResults,
          undone.body.results.map((entry) => el('li', { text: deleteStatus.item(entry.key, entry.outcome) })),
        );
        const restored = undone.body.results.filter((entry) => entry.outcome === 'restored').length;
        const kept = undone.body.results.filter((entry) => entry.outcome === 'newer_version').length;
        const gone = undone.body.results.filter((entry) => entry.outcome === 'gone').length;
        setStatus(deleteStatusRegion, deleteStatus.undoSuccess(restored, kept, gone));
        undoButton?.remove();
        undoButton = null;
        await reload();
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
        if (error.code === 'undo_expired') setStatus(deleteStatusRegion, deleteStatus.windowClosed);
        else if (error.code === 'invalid_transition') setStatus(deleteStatusRegion, deleteStatus.alreadyUndone);
        else setStatus(deleteStatusRegion, error.message);
      }
    });
    deleteResultsHolder.append(undoButton);
  }

  if (canWrite) {
    const uploadButton = button('Upload files', { focusKey: 'upload-files' });
    uploadButton.addEventListener('click', () => uploadDialog({ fixedKey: null, versionId: null, etag: null }, [], uploadButton));
    const deleteSelected = button('Delete selected', { focusKey: 'delete-selected', disabled: true });
    deleteSelected.addEventListener('click', () => {
      const keys = Array.from(selected);
      openDialog({
        name: 'Delete objects',
        opener: deleteSelected,
        build: (dialog) => {
          dialog.body.append(
            el('h2', { text: 'Delete objects' }),
            el('ul', {}, keys.map((key) => el('li', { text: key }))),
            el('div', { class: 'dialog-actions' }, [
              button('Delete objects', {
                className: 'primary',
                onClick: async () => {
                  dialog.close();
                  await runBulkDelete(keys, deleteSelected);
                },
              }),
              button('Cancel', { onClick: () => dialog.close() }),
            ]),
          );
        },
      });
    });
    const lifecycleButton = button('Lifecycle rules', { focusKey: 'lifecycle-rules' });
    lifecycleButton.addEventListener('click', () => lifecycleDialog(lifecycleButton));
    toolbar.append(uploadButton, deleteSelected, lifecycleButton);

    selectAll.addEventListener('change', () => {
      const boxes = Array.from(tableBody.querySelectorAll<HTMLInputElement>('input[data-select-key]'));
      for (const box of boxes) {
        box.checked = (selectAll as HTMLInputElement).checked;
        const key = box.getAttribute('data-select-key') as string;
        if (box.checked) selected.add(key);
        else selected.delete(key);
      }
      deleteSelected.disabled = selected.size === 0;
    });

    tableFrame.addEventListener('dragover', (event) => {
      event.preventDefault();
      tableFrame.classList.add('drop-target');
      dropHint.textContent = `Drop to upload to ${options.bucketName}/${state.prefix}`;
    });
    tableFrame.addEventListener('dragleave', () => {
      tableFrame.classList.remove('drop-target');
      dropHint.textContent = '';
    });
    tableFrame.addEventListener('drop', (event) => {
      event.preventDefault();
      tableFrame.classList.remove('drop-target');
      dropHint.textContent = '';
      const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
      if (files.length > 0) uploadDialog({ fixedKey: null, versionId: null, etag: null }, files, null);
    });

    tableBody.addEventListener('change', (event) => {
      const box = event.target as HTMLInputElement;
      const key = box.getAttribute('data-select-key');
      if (key === null) return;
      if (box.checked) selected.add(key);
      else selected.delete(key);
      deleteSelected.disabled = selected.size === 0;
    });
  }

  const dropHint = el('p', { class: 'drop-hint' });

  function renderRows(page: ObjectPage): void {
    renderHead(false);
    const rows: HTMLElement[] = [];
    const folders = page.common_prefixes.map((prefix) => ({ folder: true, value: prefix }));
    const objects = page.items.map((item) => ({ folder: false, value: item.key, item }));
    const merged: { folder: boolean; value: string; item?: ObjectRow }[] = [...folders, ...objects].sort((left, right) =>
      left.value < right.value ? -1 : left.value > right.value ? 1 : 0,
    );
    for (const entry of merged) {
      if (entry.folder) {
        const open = button(`Open folder ${entry.value}`, { focusKey: `folder:${entry.value}` });
        open.textContent = entry.value;
        open.setAttribute('aria-label', `Open folder ${entry.value}`);
        open.addEventListener('click', () => navigateWith({ prefix: entry.value, cursor: null, prev: [], objectKey: null }));
        rows.push(
          el('tr', { class: 'folder-row' }, [
            canWrite ? el('td') : null,
            el('td', {}, [open]),
            el('td', { class: 'num' }),
            el('td', { class: 'hide-narrow' }),
            el('td', { class: 'num' }),
            el('td', { class: 'hide-narrow' }),
          ]),
        );
        continue;
      }
      const item = entry.item as ObjectRow;
      const open = button(`Open ${item.key}`, { className: 'key-link', focusKey: `open:${item.key}` });
      open.textContent = item.key;
      open.setAttribute('aria-label', `Open ${item.key}`);
      open.addEventListener('click', () => navigateWith({ objectKey: item.key }, true));
      const checkbox = el('input', { type: 'checkbox', 'aria-label': `Select ${item.key}`, 'data-select-key': item.key });
      (checkbox as HTMLInputElement).checked = selected.has(item.key);
      rows.push(
        el('tr', {}, [
          canWrite ? el('td', {}, [checkbox]) : null,
          el('td', {}, [open]),
          el('td', { class: 'num mono', text: formatCount(item.size) }),
          el('td', { class: 'hide-narrow mono', text: formatTime(item.last_modified) }),
          el('td', { class: 'num mono', text: `${formatCount(item.replicas_settled)}/${formatCount(item.replicas_total)}` }),
          el('td', { class: 'hide-narrow mono', text: shortEtag(item.etag) }),
        ]),
      );
    }
    replace(tableBody, rows);
    const count = page.items.length + page.common_prefixes.length;
    setStatus(
      resultsStatus,
      count === 0 ? results.empty : page.truncated ? results.truncated : results.count(count),
    );
    nextButton.disabled = page.next_cursor === null;
    previousButton.disabled = state.prev.length === 0;
    nextButton.onclick = () => {
      if (page.next_cursor === null) return;
      navigateWith({ cursor: page.next_cursor, prev: [...state.prev, state.cursor ?? ''], objectKey: null });
    };
    previousButton.onclick = () => {
      const prev = [...state.prev];
      const back = prev.pop() ?? '';
      navigateWith({ cursor: back === '' ? null : back, prev, objectKey: null });
    };
  }

  async function reload(): Promise<void> {
    if (base === null) {
      setStatus(resultsStatus, results.outsideWorkspace);
      return;
    }
    setStatus(resultsStatus, results.pending);
    try {
      const page = await api.get<ObjectPage>(
        `${base}/objects${buildQuery([
          queryOf('prefix', state.prefix),
          queryOf('delimiter', '/'),
          queryOf('tag_filter', state.tagFilter),
          state.cursor === null ? null : queryOf('cursor', state.cursor),
        ])}`,
      );
      renderRows(page.body);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      const firstField = Object.keys(error.errors)[0];
      setStatus(
        resultsStatus,
        error.code === 'not_found'
          ? results.outsideWorkspace
          : firstField
            ? results.fieldError(error.errors[firstField])
            : error.message,
      );
    }
  }

  centre.append(deleteResultsHolder, deleteStatusRegion, uploadStatus, progress, lifecycleStatusRegion, dropHint, tableFrame, paging, resultsStatus);

  if (state.search !== '') await runSearch(state.search);
  else await reload();

  let inspectorNode: HTMLElement | null = null;
  if (state.objectKey !== null && bucket !== null) {
    const mounted = await mountInspector({
      context,
      bucket,
      objectKey: state.objectKey,
      onClose: () => navigateWith({ objectKey: null }, true, `open:${state.objectKey ?? ''}`),
      onDeleted: () => navigateWith({ objectKey: null }, true),
      onNewVersion: () => void reload(),
      uploadNewVersion: (detail) =>
        uploadDialog({ fixedKey: detail.key, versionId: detail.versionId, etag: detail.etag }, [], null),
    });
    if (mounted === null) {
      setStatus(resultsStatus, results.unknownObject(state.objectKey, options.bucketName));
    } else {
      inspectorHandles = mounted;
      inspectorNode = mounted.root;
    }
  }

  return {
    centre,
    inspector: inspectorNode,
    focusHeading: () => heading.focus(),
    focusInspector: inspectorHandles === null ? null : () => inspectorHandles?.focusHeading(),
    stop: () => inspectorHandles?.stop(),
  };
}

async function uploadFailureCopy(
  error: ApiFailure,
  about: { fileName: string; key: string; context: ConsoleContext; base: string; bucketName: string; originRegionName: string },
): Promise<string> {
  const { fileName, key } = about;
  if (error.code === 'payload_too_large') return uploadCopy.tooLarge(fileName);
  if (error.code === 'validation_failed') {
    if (error.errors.size) return uploadCopy.sizeMismatch(fileName);
    if (error.errors.key) return uploadCopy.badKey(fileName);
    if (error.errors.content) return uploadCopy.scriptedSvg(fileName);
    if (error.errors.tags) return uploadCopy.tagError;
    if (error.errors.metadata) return uploadCopy.metadataError;
    return error.message;
  }
  if (error.code === 'precondition_failed') {
    const live = await api.get<{ version_id: string }>(`${about.base}/object${buildQuery([queryOf('key', key)])}`);
    return uploadCopy.overwriteLost(key, live.body.version_id);
  }
  if (error.code === 'not_found') return uploadCopy.overwriteDeleted(key);
  if (error.code === 'quota_exceeded') {
    return uploadCopy.overQuota(fileName, about.context.workspaceName, Number(error.extra.quota_bytes ?? 0));
  }
  if (error.code === 'region_offline') return uploadCopy.originOffline(about.bucketName, about.originRegionName);
  if (error.code === 'forbidden') return uploadCopy.forbidden;
  if (error.code === 'workspace_suspended') return suspensionBanner;
  return storageOutage;
}
