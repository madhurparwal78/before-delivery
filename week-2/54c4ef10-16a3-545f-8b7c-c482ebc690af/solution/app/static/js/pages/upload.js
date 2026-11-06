// Upload strip: browser-side size check and checksum, byte progress, and the announced outcomes with their focus.
import { NetworkLost } from '../api.js';
import { OUTAGE_UPLOAD, TOO_LARGE, UNSUPPORTED_FORMAT, failureCopy } from '../copy.js';
import { announce, showFieldErrors } from '../dom.js';
import { UPLOAD_LIMIT } from '../domain.js';
import { hooks } from '../hooks.js';

const CONNECTION_LOST = 'Upload failed: the connection was lost. Nothing was stored; try again.';
const DUPLICATE = 'duplicate_scan';

async function sha256(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function send(url, file, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => onProgress(event.loaded, event.total);
    request.onload = () => resolve({ status: request.status, data: request.responseText ? JSON.parse(request.responseText) : null });
    request.onerror = () => reject(new NetworkLost('connection lost'));
    request.onabort = () => reject(new NetworkLost('aborted'));
    request.send(file);
  });
}

function focusStrip(scanId) {
  document.querySelector(`ul[aria-label="Strips"] a[href$="/scans/${scanId}"]`)?.focus();
}

export async function uploadStrip({ rollId, file, dpi, edge, fields, send: button, progress, refresh }) {
  for (const entry of Object.values(fields)) entry.setError(null);
  const chosen = file.files[0];
  if (!chosen) {
    showFieldErrors(fields, { file: UNSUPPORTED_FORMAT });
    return;
  }
  if (chosen.size > UPLOAD_LIMIT) {
    showFieldErrors(fields, { file: TOO_LARGE });
    return;
  }
  announce(`Uploading ${chosen.name}…`);
  button.disabled = true;
  const bar = progress.firstElementChild;
  let shown = 0;
  const show = (value) => {
    shown = Math.max(shown, value);
    progress.setAttribute('aria-valuenow', String(shown));
    bar.style.width = `${shown}%`;
  };
  progress.hidden = false;
  show(0);
  let outcome = null;
  try {
    const digest = await sha256(chosen);
    const query = `dpi=${encodeURIComponent(dpi.value)}&first_edge=${encodeURIComponent(edge.value)}&filename=${encodeURIComponent(chosen.name)}`;
    outcome = await send(`/api/rolls/${rollId}/scans?${query}`, chosen,
      { 'Content-Type': 'application/octet-stream', 'X-Scan-Size': String(chosen.size), 'X-Scan-SHA256': digest },
      (loaded, total) => show(Math.floor((loaded / total) * 100)));
  } catch (error) {
    if (!(error instanceof NetworkLost)) throw error;
  } finally {
    progress.hidden = true;
    button.disabled = false;
  }
  await conclude(outcome, { chosen, fields, button, refresh });
}

async function conclude(outcome, { chosen, fields, button, refresh }) {
  if (outcome === null) {
    announce(CONNECTION_LOST);
    button.focus();
    return;
  }
  const { status, data } = outcome;
  if (status === 201) {
    announce(`Stored ${chosen.name}: size and checksum confirmed.`);
    await refresh();
    focusStrip(data.id);
  } else if (status === 409 && data.error === DUPLICATE) {
    announce(failureCopy({ data }));
    focusStrip(data.scan_id);
  } else if (status === 401) {
    hooks.unauthenticated();
  } else if (status === 413 || status === 415) {
    showFieldErrors(fields, { file: failureCopy({ data }) });
  } else if (status === 422) {
    const messages = data.fields;
    showFieldErrors(fields, {
      file: ['size', 'sha256', 'file'].map((name) => messages[name]).filter(Boolean),
      dpi: messages.dpi, first_edge: messages.first_edge,
    });
  } else {
    announce(status === 503 ? OUTAGE_UPLOAD : failureCopy({ data }, { upload: true }));
    if (status === 503) hooks.storageRefused();
    button.focus();
  }
}

