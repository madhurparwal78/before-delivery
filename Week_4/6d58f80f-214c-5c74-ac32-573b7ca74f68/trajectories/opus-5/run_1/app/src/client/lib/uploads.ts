import { PART_SIZE, type Upload } from '../../shared/types.js';
import { SIZE_LIMIT, STORAGE_OUTAGE } from '../../shared/copy.js';
import { ApiFailure, api } from './api.js';
import { dropBytes, keepBytes, takeBytes } from './idb.js';
import { announce, getState, setUploads, type UploadRow } from './store.js';

const MAX_SIZE = 2_000_000_000;
const sending = new Set<string>();

const upsert = (row: UploadRow): void => {
  setUploads((rows) => {
    const index = rows.findIndex((existing) => existing.key === row.key);
    if (index === -1) return [...rows, row];
    const next = rows.slice();
    next[index] = row;
    return next;
  });
};

const patch = (key: string, changes: Partial<UploadRow>): void => {
  setUploads((rows) =>
    rows.map((row) => (row.key === key ? { ...row, ...changes } : row)),
  );
};

const rowOf = (key: string): UploadRow | undefined =>
  getState().uploads.find((row) => row.key === key);

export const removeRow = (key: string): void => {
  setUploads((rows) => rows.filter((row) => row.key !== key));
};

const fromUpload = (upload: Upload, state: UploadRow['state']): UploadRow => ({
  key: upload.id,
  id: upload.id,
  name: upload.name,
  size: upload.size,
  contentType: upload.contentType,
  folderId: upload.folderId,
  partCount: upload.partCount,
  confirmedParts: upload.confirmedParts,
  state,
});

/** Sends the parts that are not yet confirmed, one at a time. */
const pump = async (key: string): Promise<void> => {
  if (sending.has(key)) return;
  sending.add(key);
  try {
    for (;;) {
      const row = rowOf(key);
      if (row === undefined || row.id === null || row.state !== 'uploading') return;
      const blob = await takeBytes(row.id);
      if (blob === null) {
        patch(key, { state: 'failed' });
        return;
      }
      const next = findNextPart(row);
      if (next === null) {
        try {
          const done = await api.completeUpload(row.id);
          patch(key, { state: 'done' });
          await dropBytes(row.id);
          announce(`Uploaded ${done.file.name}`);
        } catch (error) {
          if (error instanceof ApiFailure && error.status === 503) {
            patch(key, { state: 'waiting' });
            announce(STORAGE_OUTAGE);
            return;
          }
          patch(key, { state: 'failed' });
        }
        return;
      }
      const start = (next - 1) * PART_SIZE;
      const slice = blob.slice(start, Math.min(start + PART_SIZE, row.size));
      try {
        const updated = await api.sendPart(row.id, next, slice);
        patch(key, { confirmedParts: updated.confirmedParts });
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 503) {
          patch(key, { state: 'waiting' });
          announce(STORAGE_OUTAGE);
          return;
        }
        if (error instanceof ApiFailure && error.code.startsWith('upload_')) {
          patch(key, { state: error.code === 'upload_paused' ? 'paused' : 'failed' });
          return;
        }
        patch(key, { state: 'failed' });
        return;
      }
    }
  } finally {
    sending.delete(key);
  }
};

const findNextPart = (row: UploadRow): number | null => {
  for (let part = 1; part <= row.partCount; part += 1) {
    if (!row.confirmedParts.includes(part)) return part;
  }
  return null;
};

export const startUploads = async (files: File[], folderId: string): Promise<void> => {
  for (const file of files) {
    if (file.size < 1 || file.size > MAX_SIZE) {
      announce(SIZE_LIMIT);
      continue;
    }
    const key = `pending-${Math.random().toString(36).slice(2)}`;
    const partCount = Math.max(1, Math.ceil(file.size / PART_SIZE));
    upsert({
      key,
      id: null,
      name: file.name,
      size: file.size,
      contentType: file.type === '' ? 'application/octet-stream' : file.type,
      folderId,
      partCount,
      confirmedParts: [],
      state: 'uploading',
    });
    try {
      const started = await api.startUpload({
        folderId,
        name: file.name,
        size: file.size,
        contentType: file.type === '' ? 'application/octet-stream' : file.type,
      });
      await keepBytes(started.upload.id, file);
      removeRow(key);
      upsert(fromUpload(started.upload, 'uploading'));
      void pump(started.upload.id);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 503) {
        patch(key, { state: 'waiting' });
        announce(STORAGE_OUTAGE);
        continue;
      }
      if (error instanceof ApiFailure && error.status === 422) {
        removeRow(key);
        announce(Object.values(error.fields)[0] ?? SIZE_LIMIT);
        continue;
      }
      patch(key, { state: 'failed' });
    }
  }
};

export const pauseUpload = async (key: string): Promise<void> => {
  const row = rowOf(key);
  if (row === undefined || row.id === null) return;
  await api.pauseUpload(row.id);
  patch(key, { state: 'paused' });
};

export const resumeUpload = async (key: string): Promise<void> => {
  const row = rowOf(key);
  if (row === undefined || row.id === null) return;
  const upload = await api.resumeUpload(row.id);
  patch(key, { state: 'uploading', confirmedParts: upload.upload.confirmedParts });
  void pump(key);
};

export const cancelUpload = async (key: string): Promise<void> => {
  const row = rowOf(key);
  if (row === undefined) return;
  if (row.id !== null) {
    await api.cancelUpload(row.id);
    await dropBytes(row.id);
  }
  removeRow(key);
  announce(`Cancelled upload of ${row.name}`);
};

export const dismissUpload = async (key: string): Promise<void> => {
  const row = rowOf(key);
  if (row === undefined) return;
  if (row.id !== null && row.state === 'expired') {
    await api.cancelUpload(row.id).catch(() => undefined);
    await dropBytes(row.id);
  }
  removeRow(key);
};

export const markUploadExpired = (uploadId: string, name: string): void => {
  const row = rowOf(uploadId);
  if (row === undefined) {
    upsert({
      key: uploadId,
      id: uploadId,
      name,
      size: 0,
      contentType: 'application/octet-stream',
      folderId: '',
      partCount: 1,
      confirmedParts: [],
      state: 'expired',
    });
  } else {
    patch(uploadId, { state: 'expired' });
  }
  announce(`Upload of ${name} expired`);
};

/** Only uploads that stopped because storage went away carry on by themselves. */
export const resumeWaitingUploads = async (): Promise<void> => {
  for (const row of getState().uploads) {
    if (row.state !== 'waiting') continue;
    if (row.id === null) {
      removeRow(row.key);
      continue;
    }
    patch(row.key, { state: 'uploading' });
    void pump(row.key);
  }
};

/** After a reload the panel lists the person's unfinished uploads from the server. */
export const loadUnfinishedUploads = async (): Promise<void> => {
  const { uploads } = await api.uploads();
  for (const upload of uploads) {
    const state: UploadRow['state'] =
      upload.state === 'abandoned'
        ? 'expired'
        : upload.state === 'paused'
          ? 'paused'
          : 'paused';
    upsert(fromUpload(upload, state));
  }
};
