import type { Line, User } from '../../shared/types.js';
import { ApiFailure, NoResponse, request, uploadWithProgress } from '../api.js';
import { button, el, setText, trapFocus } from '../dom.js';
import type { Shell } from '../shell.js';

const RESUMABLE_THRESHOLD = 8_000_000;
const PART_BYTES = 4_000_000;

export interface HeldUpload {
  lineId: string;
  cancel(): void;
  storageReturned(): void;
}

export interface UploadDialogOptions {
  shell: Shell;
  host: HTMLElement;
  line: Line;
  opener: HTMLButtonElement;
  held: HeldUpload | null;
  setStatus(text: string): void;
  setRowWord(word: string): void;
  clearRowWord(): void;
}

/**
 * The upload dialog. It keeps the chosen file and checksum through an expired
 * session and a storage outage, shows progress in words, and shows Stored only
 * after the server confirms.
 */
export function openUploadDialog(options: UploadDialogOptions): HeldUpload | null {
  const { shell, host, line, opener } = options;
  const wasHeld = options.held?.lineId === line.id ? options.held : null;
  // Only one upload is held at a time; holding another cancels the earlier one.
  if (options.held && !wasHeld) options.held.cancel();

  const fileInput = el('input', { type: 'file', id: 'line-file' });
  const sha = el('input', { type: 'text', id: 'line-sha', 'data-sha': '' });
  const checksumError = el('p', { class: 'field-error' });
  const fileError = el('p', { class: 'field-error' });
  const waiting = el('p', { class: 'waiting' });
  const sessionBlock = el('div', { class: 'session-block' });
  sessionBlock.hidden = true;

  const upload = button('Upload', { class: 'primary' });
  const cancel = button('Cancel');
  const retry = button('Retry upload');
  const hide = button('Hide');
  retry.hidden = true;
  hide.hidden = true;

  const card = el('div', { class: 'dialog-card upload-card' }, [
    el('h2', {}, ['Upload line file']),
    el('p', { class: 'dialog-subtitle' }, [line.label]),
    el('div', { class: 'field' }, [
      el('label', { for: 'line-file' }, ['Line file']),
      fileInput,
      fileError,
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'line-sha' }, ['SHA-256']),
      sha,
      checksumError,
    ]),
    waiting,
    sessionBlock,
    upload,
    retry,
    hide,
    cancel,
  ]);
  const dialog = el(
    'div',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Upload line file', class: 'dialog' },
    [card],
  );

  /** The file and checksum kept across a held or interrupted upload. */
  let keptFile: File | null = wasHeld ? heldFiles.get(line.id)?.file ?? null : null;
  let keptSha = wasHeld ? heldFiles.get(line.id)?.sha ?? '' : '';
  let holding = wasHeld !== null;
  let cancelled = false;
  let inFlight = false;

  if (keptSha) sha.value = keptSha;
  if (holding) enterWaiting();

  function close(): void {
    shell.openDialogs.delete(dialog);
    dialog.remove();
    if (document.contains(opener)) opener.focus();
  }

  function enterWaiting(): void {
    setText(waiting, `Waiting for storage — ${line.label} will upload when it returns`);
    upload.hidden = true;
    retry.hidden = true;
    hide.hidden = false;
    options.setRowWord('Waiting for storage');
  }

  function leaveWaiting(): void {
    setText(waiting, '');
    upload.hidden = false;
    hide.hidden = true;
  }

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // Escape while waiting keeps the upload held.
      close();
      return;
    }
    trapFocus(dialog, event);
  });
  cancel.addEventListener('click', () => {
    if (holding) {
      cancelled = true;
      holding = false;
      heldFiles.delete(line.id);
      options.clearRowWord();
    }
    close();
  });
  hide.addEventListener('click', close);

  function currentFile(): File | null {
    return fileInput.files?.[0] ?? keptFile;
  }

  async function send(): Promise<void> {
    if (inFlight) return;
    const file = currentFile();
    setText(fileError, '');
    setText(checksumError, '');
    if (!file) {
      setText(fileError, 'The file is empty');
      return;
    }
    keptFile = file;
    keptSha = sha.value.trim();
    inFlight = true;
    upload.disabled = true;
    options.setStatus(`Uploading ${line.label}`);
    try {
      if (file.size > RESUMABLE_THRESHOLD) await sendInParts(file);
      else await sendWhole(file);
      options.setRowWord('Stored');
      options.setStatus(`${line.label} stored`);
      heldFiles.delete(line.id);
      holding = false;
      close();
    } catch (error) {
      handleFailure(error);
    } finally {
      inFlight = false;
      upload.disabled = false;
    }
  }

  async function sendWhole(file: File): Promise<void> {
    await uploadWithProgress(
      `/api/lines/${line.id}/file`,
      'PUT',
      await file.arrayBuffer(),
      {
        'content-type': 'application/octet-stream',
        'x-line-file-name': file.name,
        'x-content-sha256': keptSha,
      },
      (percent) => options.setRowWord(`Uploading ${percent}%`),
    );
  }

  /** Files over 8,000,000 bytes upload in resumable parts. */
  async function sendInParts(file: File): Promise<void> {
    let started = await request<{ upload_id: string; received_bytes: number }>(
      `/api/lines/${line.id}/uploads`,
      { method: 'POST', body: { size_bytes: file.size, sha256: keptSha } },
    );
    let sent = started.received_bytes;
    while (sent < file.size) {
      const end = Math.min(file.size, sent + PART_BYTES);
      const slice = file.slice(sent, end);
      try {
        const result = await uploadWithProgress(
          `/api/lines/${line.id}/uploads/${started.upload_id}`,
          'PUT',
          slice,
          {
            'content-type': 'application/octet-stream',
            'content-range': `bytes ${sent}-${end - 1}/${file.size}`,
            'x-line-file-name': file.name,
          },
          (percent) =>
            options.setRowWord(
              `Uploading ${Math.min(99, Math.floor(((sent + (slice.size * percent) / 100) / file.size) * 100))}%`,
            ),
        );
        if (result.status === 201) return;
        sent = (result.data as { received_bytes: number }).received_bytes;
      } catch (error) {
        if (error instanceof NoResponse) {
          // Resume from the received bytes the server reports.
          started = await request<{ upload_id: string; received_bytes: number }>(
            `/api/lines/${line.id}/uploads`,
            { method: 'POST', body: { size_bytes: file.size, sha256: keptSha } },
          );
          sent = started.received_bytes;
          continue;
        }
        if (error instanceof ApiFailure && error.code === 'range_mismatch') {
          sent = Number(error.body.received_bytes ?? 0);
          continue;
        }
        throw error;
      }
    }
  }

  function handleFailure(error: unknown): void {
    if (error instanceof NoResponse) {
      options.setRowWord('Awaiting upload');
      options.setStatus(`Could not reach Swathdeck — ${line.label} is not uploaded yet`);
      retry.hidden = false;
      return;
    }
    if (!(error instanceof ApiFailure)) return;
    if (error.status === 401) {
      askForSignIn();
      return;
    }
    if (error.code === 'storage_unavailable') {
      holding = true;
      heldFiles.set(line.id, { file: keptFile, sha: keptSha });
      options.setStatus(`Storage is unreachable — ${line.label} is still awaiting upload`);
      enterWaiting();
      return;
    }
    if (error.body.errors?.sha256) {
      setText(checksumError, error.body.errors.sha256);
      options.setStatus(error.body.errors.sha256);
      return;
    }
    if (error.body.errors?.file_name) {
      setText(fileError, error.body.errors.file_name);
      return;
    }
    if (error.body.errors?.file) {
      setText(fileError, error.body.errors.file);
      return;
    }
    if (error.code === 'already_delivered') {
      options.setStatus(`${line.label} already holds a different file`);
      return;
    }
    options.setStatus(error.message);
  }

  /** An upload that finds the session ended asks for sign-in in place. */
  function askForSignIn(): void {
    const email = el('input', { type: 'email', id: 'upload-email' });
    const password = el('input', { type: 'password', id: 'upload-password' });
    const message = el('p', { class: 'field-error' });
    const signIn = button('Sign in and upload', { class: 'primary' });
    sessionBlock.replaceChildren(
      el('p', {}, [`Your session ended — sign in again to finish uploading ${line.label}`]),
      el('div', { class: 'field' }, [el('label', { for: 'upload-email' }, ['Email']), email]),
      el('div', { class: 'field' }, [
        el('label', { for: 'upload-password' }, ['Password']),
        password,
      ]),
      signIn,
      message,
    );
    sessionBlock.hidden = false;
    upload.hidden = true;
    const previousId = shell.user?.id ?? null;
    signIn.addEventListener('click', () => {
      void request<{ user: User; home: string }>('/api/session', {
        method: 'POST',
        body: { email: email.value, password: password.value },
      })
        .then((result) => {
          shell.user = result.user;
          if (previousId !== null && result.user.id !== previousId) {
            // A different account sends nothing and lands on its own home.
            close();
            shell.reset();
            shell.user = result.user;
            shell.navigate(result.home, { replace: true });
            return;
          }
          sessionBlock.hidden = true;
          upload.hidden = false;
          void send();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) setText(message, error.message);
        });
    });
    email.focus();
  }

  upload.addEventListener('click', () => void send());
  retry.addEventListener('click', () => {
    retry.hidden = true;
    void send();
  });

  shell.openDialogs.add(dialog);
  host.append(dialog);
  (holding ? hide : fileInput).focus();

  const handle: HeldUpload = {
    lineId: line.id,
    cancel: () => {
      cancelled = true;
      holding = false;
      heldFiles.delete(line.id);
    },
    storageReturned: () => {
      if (!holding || cancelled) return;
      holding = false;
      leaveWaiting();
      void send();
    },
  };
  return holding || inFlight ? handle : handle;
}

/** The file and checksum of the single held upload, kept out of the DOM. */
const heldFiles = new Map<string, { file: File | null; sha: string }>();
