// The editor's dialogs: Share, Files, Import, and Sign in to continue.

import { apiGet, apiPost, apiPatch, apiDelete, setCsrfToken, ApiRequestError } from './api.js';
import { COPY } from '../shared/constants.js';
import { h, clear, optionEl } from './hyperscript.js';
import { openDialog, DialogHandle } from './dialogs.js';
import { Editor } from './editor.js';

interface ShareRow {
  id: string;
  email: string;
  displayName: string | null;
  role: 'editor' | 'viewer';
  status: string;
  delivery?: 'sent' | 'queued';
  expiresAt: string | null;
}

// ---------------------------------------------------------------------------
// Share dialog.

export function openShareDialog(editor: Editor): void {
  const announcements = editor.announcementsRegion();
  const emailInput = h('input', { type: 'email', class: 'field', 'aria-label': 'Email', id: 'share-email' }) as HTMLInputElement;
  const roleSelect = h('select', { class: 'field', 'aria-label': 'Role', id: 'share-role' }) as HTMLSelectElement;
  roleSelect.add(optionEl('editor', 'Editor'));
  roleSelect.add(optionEl('viewer', 'Viewer'));
  const emailError = h('div', { class: 'field-error hidden' });
  const send = h('button', { class: 'primary' }, 'Send invitation') as HTMLButtonElement;

  const table = h('table', { 'aria-label': 'People with access', class: 'share-table' });
  const thead = h('thead', {}, h('tr', {}, h('th', {}, 'Email'), h('th', {}, 'Access'), h('th', {}, '')));
  const tbody = h('tbody', {});
  // The owner's row.
  tbody.appendChild(h('tr', { 'data-share-id': 'owner' },
    h('td', {}, editor.info.ownerName),
    h('td', {}, 'Owner'),
    h('td', {}, ''),
  ));
  table.append(thead, tbody);

  const rowState = new Map<string, { statusText: string }>();

  const statusText = (share: ShareRow): string => {
    if (share.status === 'active') return share.role === 'editor' ? 'Editor' : 'Viewer';
    if (share.status === 'invited') return share.delivery === 'sent' ? 'Invited' : 'Not yet delivered';
    return 'Expired';
  };

  const focusNextRow = (removedId: string): void => {
    const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr'));
    const index = rows.findIndex((r) => r.getAttribute('data-share-id') === removedId);
    const next = rows[index + 1] ?? rows[index - 1];
    if (next !== undefined && next.getAttribute('data-share-id') !== 'owner') {
      const control = next.querySelector<HTMLElement>('select, button');
      if (control !== null) {
        control.focus();
        return;
      }
    }
    emailInput.focus();
  };

  const showError = (err: unknown): void => {
    if (err instanceof ApiRequestError) {
      if (err.code === 'validation') {
        emailError.textContent = COPY.emailInvalid;
        emailError.classList.remove('hidden');
        return;
      }
      if (err.code === 'already_member') {
        emailError.textContent = COPY.alreadyMember;
        emailError.classList.remove('hidden');
        return;
      }
      if (err.code === 'invite_pending') {
        emailError.textContent = COPY.invitePending;
        emailError.classList.remove('hidden');
        return;
      }
      if (err.code === 'invite_rate_limited') {
        emailError.textContent = COPY.inviteRateLimited;
        emailError.classList.remove('hidden');
        return;
      }
      if (err.code === 'share_pending') {
        announcements.textContent = 'This invitation is still pending.';
        return;
      }
      if (err.code === 'share_ended') {
        announcements.textContent = 'This share has ended.';
        return;
      }
    }
    announcements.textContent = COPY.genericFailureBanner;
  };

  const openRemoveConfirm = (share: ShareRow, removeButton: HTMLElement): void => {
    const confirmBtn = h('button', { class: 'danger' }, 'Remove access');
    const cancelBtn = h('button', {}, 'Cancel');
    const confirmBody = h('div', { class: 'dialog-body' },
      h('h2', {}, 'Remove access'),
      h('p', {}, `Remove access for ${share.email}?`),
      h('div', { class: 'dialog-actions' }, confirmBtn, cancelBtn),
    );
    const confirmHandle = openDialog('Remove access', confirmBody, {
      firstFocus: () => cancelBtn.focus(),
      onClose: () => { if (!confirmed) removeButton.focus(); },
    });
    confirmHandle.element.setAttribute('role', 'alertdialog');
    let confirmed = false;
    confirmBtn.addEventListener('click', async () => {
      confirmed = true;
      confirmHandle.close();
      try {
        await apiDelete(`/api/diagrams/${editor.diagramId}/shares/${share.id}`);
        announcements.textContent = COPY.removedFor(share.email);
        focusNextRow(share.id);
      } catch (err) {
        showError(err);
      }
    });
    cancelBtn.addEventListener('click', () => {
      confirmHandle.close();
    });
  };

  const renderRows = (shares: ShareRow[]): void => {
    const existing = new Map<string, HTMLTableRowElement>();
    for (const tr of Array.from(tbody.querySelectorAll('tr'))) {
      existing.set(tr.getAttribute('data-share-id') ?? '', tr as HTMLTableRowElement);
    }
    const wanted = new Set(shares.map((s) => s.id));
    for (const [id, tr] of existing) {
      if (!wanted.has(id) && id !== 'owner') {
        if (document.activeElement !== null && tr.contains(document.activeElement)) {
          emailInput.focus();
        }
        tr.remove();
      }
    }
    for (const share of shares) {
      const previous = rowState.get(share.id);
      let tr = existing.get(share.id);
      if (tr === undefined) {
        tr = h('tr', { 'data-share-id': share.id }) as HTMLTableRowElement;
        tbody.appendChild(tr);
      }
      clear(tr);
      tr.append(h('td', {}, share.email), h('td', { class: 'mono' }, statusText(share)));
      const actionsCell = h('td', {});
      if (share.status === 'active') {
        const roleCombo = h('select', { class: 'field', 'aria-label': `Role for ${share.email}` }) as HTMLSelectElement;
        roleCombo.add(optionEl('editor', 'Editor'));
        roleCombo.add(optionEl('viewer', 'Viewer'));
        roleCombo.value = share.role;
        let lastValue: 'editor' | 'viewer' = share.role;
        roleCombo.addEventListener('change', async () => {
          const role = roleCombo.value as 'editor' | 'viewer';
          try {
            await apiPatch(`/api/diagrams/${editor.diagramId}/shares/${share.id}`, { role });
            announcements.textContent = COPY.roleChangedFor(share.email);
            lastValue = role;
          } catch (err) {
            roleCombo.value = lastValue;
            showError(err);
          }
        });
        const remove = h('button', { 'aria-label': `Remove ${share.email}` }, 'Remove') as HTMLButtonElement;
        remove.addEventListener('click', () => openRemoveConfirm(share, remove));
        actionsCell.append(roleCombo, remove);
      } else {
        const withdraw = h('button', { 'aria-label': `Withdraw invitation for ${share.email}` }, 'Withdraw');
        withdraw.addEventListener('click', async () => {
          try {
            await apiDelete(`/api/diagrams/${editor.diagramId}/shares/${share.id}`);
            announcements.textContent = COPY.withdrawnFor(share.email);
            focusNextRow(share.id);
          } catch (err) {
            showError(err);
          }
        });
        actionsCell.appendChild(withdraw);
      }
      tr.appendChild(actionsCell);
      if (previous !== undefined && previous.statusText === 'Not yet delivered' && statusText(share) === 'Invited') {
        announcements.textContent = COPY.deliverySentence(share.email);
      }
      if (previous !== undefined && previous.statusText !== 'Expired' && statusText(share) === 'Expired') {
        announcements.textContent = COPY.expirySentence(share.email);
      }
      rowState.set(share.id, { statusText: statusText(share) });
    }
  };

  const load = async (): Promise<void> => {
    const resp = await apiGet(`/api/diagrams/${editor.diagramId}/shares`) as { shares: ShareRow[] };
    renderRows(resp.shares);
  };

  send.addEventListener('click', async () => {
    emailError.classList.add('hidden');
    send.textContent = 'Sending...';
    send.setAttribute('disabled', '');
    try {
      const resp = await apiPost(`/api/diagrams/${editor.diagramId}/shares`, { email: emailInput.value, role: roleSelect.value }) as { share: ShareRow };
      announcements.textContent = COPY.inviteCreatedFor(resp.share.email);
      emailInput.value = '';
      await load();
    } catch (err) {
      showError(err);
    }
    send.textContent = 'Send invitation';
    send.removeAttribute('disabled');
  });

  const body = h('div', { class: 'dialog-body share-body' },
    h('h2', {}, 'Share diagram'),
    h('div', { class: 'share-form' }, emailInput, roleSelect, send),
    emailError,
    table,
  );
  const handle = openDialog('Share diagram', body, { firstFocus: () => emailInput.focus() });
  void load();

  // Refresh every 10 seconds; nothing typed, chosen, opened or focused resets.
  const refresh = window.setInterval(() => {
    void load().catch(() => undefined);
  }, 10000);
  const originalClose = handle.close;
  handle.close = () => {
    window.clearInterval(refresh);
    originalClose();
  };
  const dialogElement = handle.element;
  dialogElement.addEventListener('remove-dialog-hook', () => undefined);
  // Close through the overlay's Escape wiring: patch the keydown path.
  const overlay = dialogElement.parentElement as HTMLElement;
  overlay.addEventListener('keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Escape') {
      window.clearInterval(refresh);
    }
  });
}

// ---------------------------------------------------------------------------
// Files dialog.

export function openFilesDialog(editor: Editor): void {
  const announcements = editor.announcementsRegion();
  const create = h('button', { class: 'primary' }, 'Create export');
  const exportsTable = h('table', { 'aria-label': 'Exports', class: 'files-table' });
  const importsTable = h('table', { 'aria-label': 'Imported originals', class: 'files-table' });

  const loadExports = async (): Promise<void> => {
    const resp = await apiGet(`/api/diagrams/${editor.diagramId}/exports`) as {
      exports: { id: string; status: string; createdAt: string; files: { format: string; sizeBytes: number; sha256: string }[] }[];
    };
    exportsTable.innerHTML = '';
    const thead = h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Status'), h('th', {}, 'Files')));
    const tbody = h('tbody', {});
    exportsTable.append(thead, tbody);
    for (const item of resp.exports) {
      const tr = h('tr', { 'data-export-id': item.id },
        h('td', { class: 'mono' }, item.createdAt),
        h('td', {}, item.status === 'ready' ? 'Ready' : item.status === 'pending' ? 'Preparing' : 'Failed'),
      );
      const filesCell = h('td', {});
      if (item.status === 'failed') {
        filesCell.textContent = COPY.exportFailedRow;
      }
      if (item.status === 'ready') {
        for (const file of item.files) {
          filesCell.appendChild(h('div', { class: 'export-file' },
            h('a', { href: `/api/diagrams/${editor.diagramId}/exports/${item.id}/files/${file.format}`, class: 'download-link' }, `Download ${file.format.toUpperCase()}`),
            h('span', { class: 'mono file-meta' }, `${file.sizeBytes} bytes ${file.sha256}`),
          ));
        }
      }
      tr.appendChild(filesCell);
      tbody.appendChild(tr);
    }
  };

  const loadImports = async (): Promise<void> => {
    const resp = await apiGet(`/api/diagrams/${editor.diagramId}/imports`) as {
      imports: { id: string; fileName: string; sizeBytes: number; sha256: string }[];
    };
    importsTable.innerHTML = '';
    const thead = h('thead', {}, h('tr', {}, h('th', {}, 'File'), h('th', {}, 'Size'), h('th', {}, 'Checksum')));
    const tbody = h('tbody', {});
    importsTable.append(thead, tbody);
    for (const item of resp.imports) {
      tbody.appendChild(h('tr', {},
        h('td', {}, h('a', {
          href: `/api/diagrams/${editor.diagramId}/imports/${item.id}/original`,
          class: 'download-link',
        }, `Download original ${item.fileName}`)),
        h('td', { class: 'mono' }, `${item.sizeBytes} bytes`),
        h('td', { class: 'mono' }, item.sha256),
      ));
    }
  };

  create.addEventListener('click', async () => {
    create.setAttribute('disabled', '');
    const key = `export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const resp = await apiPost(`/api/diagrams/${editor.diagramId}/exports`, {}, { idempotencyKey: key }) as { export: { status: string } };
      if (resp.export.status === 'ready') {
        announcements.textContent = COPY.exportReady;
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'storage_unavailable') {
        editor.showStorageBanner();
      } else {
        announcements.textContent = COPY.genericFailureBanner;
      }
    }
    await loadExports().catch(() => undefined);
    create.removeAttribute('disabled');
  });

  const body = h('div', { class: 'dialog-body files-body' },
    h('h2', {}, 'Diagram files'),
    editor.info.role === 'viewer' ? null : create,
    exportsTable,
    h('h3', {}, 'Imported originals'),
    importsTable,
  );
  openDialog('Diagram files', body, {});
  void loadExports().catch(() => undefined);
  void loadImports().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Import dialog.

export function openImportDialog(editor: Editor): void {
  const announcements = editor.announcementsRegion();
  const input = h('input', { type: 'file', class: 'field', id: 'import-file' }) as HTMLInputElement;
  const inputLabel = h('label', { for: 'import-file' }, 'Diagram file');
  const error = h('div', { class: 'field-error hidden', id: 'import-error' });
  input.setAttribute('aria-describedby', 'import-error');
  input.addEventListener('change', () => {
    error.classList.add('hidden');
  });
  const submit = h('button', { class: 'primary' }, 'Import file');
  submit.addEventListener('click', async () => {
    if (input.files === null || input.files.length === 0) return;
    const file = input.files[0];
    const fileName = file.name.split('/').pop() ?? file.name;
    announcements.textContent = COPY.importProgress(fileName);
    submit.textContent = 'Importing...';
    submit.setAttribute('disabled', '');
    const form = new FormData();
    form.append('file', file);
    try {
      const resp = await apiPost(`/api/diagrams/${editor.diagramId}/imports`, undefined, { raw: form }) as {
        import: { pageId: string };
      };
      close();
      announcements.textContent = COPY.importSuccess(fileName);
      await editor.addImportedPage(resp.import.pageId);
    } catch (err) {
      let message: string = COPY.genericFailureBanner;
      if (err instanceof ApiRequestError) {
        if (err.code === 'file_too_large') message = COPY.importTooLarge;
        else if (err.code === 'unsupported_file_type') message = COPY.importWrongType;
        else if (err.code === 'unsafe_file') message = COPY.importUnsafe;
        else if (err.code === 'invalid_model') message = COPY.importInvalid;
        else if (err.code === 'storage_unavailable') {
          editor.showStorageBanner();
          message = COPY.storageOutageBanner;
        }
      }
      error.textContent = message;
      error.classList.remove('hidden');
      announcements.textContent = message;
      submit.textContent = 'Import file';
      submit.removeAttribute('disabled');
      input.focus();
    }
  });
  const body = h('div', { class: 'dialog-body' },
    h('h2', {}, 'Import diagram file'),
    inputLabel, input, error,
    h('div', { class: 'dialog-actions' }, submit),
  );
  const close = openDialog('Import diagram file', body, { firstFocus: () => input.focus() }).close;
}

// ---------------------------------------------------------------------------
// Sign in to continue. No timer closes it, clears the typed password, moves
// focus out of it, removes its alert or sends another save.

export function openSessionDialog(editor: Editor): DialogHandle {
  const error = h('div', { role: 'alert', class: 'alert hidden' });
  const email = h('input', { type: 'email', class: 'field', value: editor.userEmail(), 'aria-label': 'Email', readonly: true }) as HTMLInputElement;
  const password = h('input', { type: 'password', class: 'field', 'aria-label': 'Password' }) as HTMLInputElement;
  const submit = h('button', { class: 'primary' }, 'Sign in');
  const body = h('div', { class: 'dialog-body session-body' },
    h('h2', {}, 'Sign in to continue'),
    h('p', {}, COPY.sessionDialogText),
    error,
    h('label', {}, 'Email'), email,
    h('label', {}, 'Password'), password,
    submit,
  );
  const handle = openDialog('Sign in to continue', body, {
    firstFocus: () => password.focus(),
    noEscape: true,
  });
  const signIn = async (): Promise<void> => {
    error.classList.add('hidden');
    try {
      const resp = await apiPost('/api/session', { email: email.value, password: password.value }) as { csrfToken: string };
      setCsrfToken(resp.csrfToken);
      handle.close();
      await editor.resendKeptRequests();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        error.textContent = err.code === 'signin_locked' ? COPY.signInLocked : COPY.signInIncorrect;
      } else {
        error.textContent = COPY.genericFailureBanner;
      }
      error.classList.remove('hidden');
    }
  };
  submit.addEventListener('click', () => void signIn());
  password.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void signIn();
    }
  });
  return handle;
}
