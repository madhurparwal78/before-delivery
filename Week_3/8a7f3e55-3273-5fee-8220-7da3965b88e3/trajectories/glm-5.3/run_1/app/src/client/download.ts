// Prep material upload and download in the browser: one fresh link per download, byte-exact.
import type { MaterialInfo } from '../shared/api.js';
import { api, app, announceError, announceStatus, clearError } from './shell.js';
import { ApiFailure } from './api.js';
import { ERROR_COPY, PENDING_COPY, SUCCESS_COPY, downloadErrorCopy } from './copy.js';

/** Upload a prep material as multipart form data. The record and object are stored together. */
export async function uploadMaterial(bookingId: string, file: File, refresh: () => void | Promise<void>): Promise<void> {
  const form = new FormData();
  form.append('file', file, file.name);
  announceStatus(`${PENDING_COPY.upload.replace('file', file.name)}`);
  clearError();
  try {
    const response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/materials`, {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
    });
    if (response.status === 401) {
      const text = await response.text();
      let body: { error?: string } = {};
      try { body = JSON.parse(text); } catch { /* network-shaped failure */ }
      const { openSessionDialog } = await import('./dialogs.js');
      await openSessionDialog(new ApiFailure(response.status, body as { error: string; message: string }), () => {
        void uploadMaterial(bookingId, file, refresh);
      });
      return;
    }
    const text = await response.text();
    let body: { error?: string; message?: string; fields?: Record<string, string> } = {};
    try { body = JSON.parse(text); } catch { /* network-shaped failure */ }
    if (!response.ok) {
      const failure = new ApiFailure(response.status, body as { error: string; message: string });
      if (failure.code === 'validation' && body.fields?.file) {
        announceError(body.fields.file);
        return;
      }
      announceError(failure.code === 'storage_unavailable'
        ? ERROR_COPY.storage_unavailable_upload
        : downloadErrorCopy(failure.code));
      return;
    }
    announceStatus(SUCCESS_COPY.upload(file.name));
    await refresh();
  } catch {
    announceError(ERROR_COPY.network);
  }
}

/** Ask the server for a fresh link, then download the file through it under its display name. */
export async function downloadMaterial(material: MaterialInfo, button: HTMLButtonElement): Promise<void> {
  announceStatus(PENDING_COPY.download);
  clearError();
  const bookingId = currentBookingId();
  if (bookingId === null) {
    button.disabled = false;
    button.textContent = 'Download';
    return;
  }
  try {
    const link = await api.call<{ url: string; expires_at: string }>(
      `/api/bookings/${encodeURIComponent(bookingId)}/materials/${encodeURIComponent(material.id)}/link`,
      { method: 'POST', tag: 'download-link' },
    );
    const response = await fetch(link.url, { credentials: 'same-origin' });
    if (!response.ok) {
      const text = await response.text();
      let body: { error?: string; message?: string } = {};
      try { body = JSON.parse(text); } catch { /* network-shaped failure */ }
      const failure = new ApiFailure(response.status, body as { error: string; message: string });
      announceError(downloadErrorCopy(failure.code));
      button.disabled = false;
      button.textContent = 'Download';
      return;
    }
    const bytes = await response.arrayBuffer();
    const blob = new Blob([bytes], { type: material.content_type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = material.name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    button.disabled = false;
    button.textContent = 'Download';
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Download';
    if (err instanceof ApiFailure) {
      announceError(downloadErrorCopy(err.code));
      return;
    }
    announceError(ERROR_COPY.network);
  }
}

function currentBookingId(): string | null {
  // The detail pane renders the selected booking; its id is carried on the rows and detail.
  const selected = document.querySelector<HTMLElement>('button.row[data-selected="true"]');
  if (selected) return selected.getAttribute('data-booking-id');
  const fromDetail = document.querySelector<HTMLElement>('section[aria-label="Assignment detail"]');
  if (fromDetail) {
    const heading = fromDetail.querySelector<HTMLElement>('h2');
    return heading?.dataset.bookingId ?? null;
  }
  void app;
  return null;
}
