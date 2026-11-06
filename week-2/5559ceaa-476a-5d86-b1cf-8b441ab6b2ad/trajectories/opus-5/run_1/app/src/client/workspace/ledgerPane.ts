import type { Checkpoint, CheckpointFileRow, ReviewerLink } from '../../shared/api.js';
import { copy } from '../copy.js';
import { openDialog, type Dialog } from '../dialog.js';
import { clear, el, on } from '../dom.js';
import { ledgerTime, stamp } from '../format.js';
import { api, newIdempotencyKey, RequestFailed } from '../net.js';
import type { StatusBoard } from './status.js';
import type { WorkspaceStore } from './store.js';

const SHARE_REFRESH_MS = 30_000;

interface OpenCheckpointDialog {
  checkpointId: string;
  redraw(files: CheckpointFileRow[]): void;
  dialog: Dialog;
}

export interface LedgerPane {
  readonly toggle: HTMLButtonElement;
  readonly panel: HTMLElement;
  applyLayout(): void;
  onPushedCheckpoint(checkpoint: Checkpoint): void;
  refreshOpenCheckpointDialog(): Promise<void>;
}

export function createLedgerPane(store: WorkspaceStore, statuses: StatusBoard): LedgerPane {
  const toggle = el('button', { type: 'button', class: 'ledger-toggle quiet' }, ['Ledger']);
  const nameField = el('input', { type: 'text', id: 'checkpoint-name', 'aria-label': 'Checkpoint name' });
  const saveButton = el('button', { type: 'button' }, ['Save checkpoint']);
  const list = el('div', { role: 'list', 'aria-label': 'Checkpoints' });
  const checkpointStatus = statuses.create('Checkpoint status');
  const restoreStatus = statuses.create('Restore status');
  const shareStatus = statuses.create('Share status');
  const handle = el('div', { class: 'sheet-handle', 'aria-hidden': 'true' });

  const panel = el('div', { class: 'ledger', role: 'complementary', 'aria-label': 'Checkpoint ledger' }, [
    handle,
    el('div', { class: 'save-row' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'checkpoint-name' }, ['Checkpoint name']),
        nameField,
      ]),
      saveButton,
    ]),
    checkpointStatus,
    restoreStatus,
    shareStatus,
    list,
  ]);

  const renderedStates = new Map<string, string>();
  let openCheckpoint: OpenCheckpointDialog | null = null;
  let openShare: { checkpointId: string; dialog: Dialog; redraw(links: ReviewerLink[]): void } | null =
    null;

  const stateLabel = (checkpoint: Checkpoint): string =>
    checkpoint.state === 'saved'
      ? 'Saved'
      : checkpoint.state === 'pending_upload'
        ? 'Pending upload'
        : 'Failed';

  function render(): void {
    const seen = new Set<string>();
    clear(list);
    for (const checkpoint of store.checkpoints) {
      seen.add(checkpoint.id);
      const known = renderedStates.get(checkpoint.id);
      const label = el('span', { class: 'state' }, [stateLabel(checkpoint)]);
      if (known !== undefined && known !== checkpoint.state) label.classList.add('state-change');
      renderedStates.set(checkpoint.id, checkpoint.state);

      const buttons: HTMLElement[] = [
        action(`Open ${checkpoint.name}`, 'Open', () => void openCheckpointDialog(checkpoint)),
        action(`Restore ${checkpoint.name}`, 'Restore', () => void restore(checkpoint)),
      ];
      if (store.isMentor) {
        buttons.push(
          action(`Share ${checkpoint.name}`, 'Share', () => void openShareDialog(checkpoint)),
        );
      }

      const row = el('div', { role: 'listitem', class: 'checkpoint-row' }, [
        el('span', { class: 'name' }, [checkpoint.name]),
        el('span', { class: 'author' }, [checkpoint.created_by.name]),
        el('span', { class: 'numeral' }, [ledgerTime(checkpoint.created_at)]),
        el('span', { class: 'numeral' }, [String(checkpoint.file_count)]),
        label,
        ...buttons,
      ]);
      if (known === undefined && renderedStates.size > 1) row.classList.add('row-enter');
      list.append(row);
    }
    for (const id of [...renderedStates.keys()]) {
      if (!seen.has(id)) renderedStates.delete(id);
    }
  }

  function action(name: string, text: string, run: () => void): HTMLButtonElement {
    const button = el('button', { type: 'button', 'aria-label': name }, [text]);
    on(button, 'click', run);
    return button;
  }

  async function saveCheckpoint(): Promise<void> {
    const name = nameField.value.trim();
    if (name.length < 1 || name.length > 80) {
      statuses.error('Checkpoint status', copy.checkpoint.fieldError);
      return;
    }
    saveButton.disabled = true;
    statuses.pending('Checkpoint status', copy.checkpoint.pending);
    try {
      const saved = await api<{ checkpoint: Checkpoint }>(
        `/api/projects/${store.projectId}/checkpoints`,
        { method: 'POST', body: { name } },
      );
      nameField.value = '';
      await store.loadCheckpoints();
      announce(saved.checkpoint);
    } catch (cause) {
      if (!(cause instanceof RequestFailed)) throw cause;
      statuses.error(
        'Checkpoint status',
        cause.code === 'validation' ? copy.checkpoint.fieldError : copy.generic,
      );
    } finally {
      saveButton.disabled = false;
    }
  }

  function announce(checkpoint: Checkpoint): void {
    if (checkpoint.state === 'saved') {
      statuses.set('Checkpoint status', copy.checkpoint.saved(checkpoint.name));
    } else if (checkpoint.state === 'pending_upload') {
      statuses.set('Checkpoint status', copy.checkpoint.pendingUpload(checkpoint.name));
    } else {
      statuses.error('Checkpoint status', copy.checkpoint.failed(checkpoint.name));
    }
  }

  /** Only the saver's own Checkpoint status follows a checkpoint's later state. */
  function onPushedCheckpoint(checkpoint: Checkpoint): void {
    const mine = checkpoint.created_by.id === store.user.id;
    if (mine && checkpoint.state !== 'pending_upload') announce(checkpoint);
  }

  async function restore(checkpoint: Checkpoint): Promise<void> {
    statuses.pending('Restore status', copy.restore.pending(checkpoint.name));
    try {
      const done = await api<{ restore: { id: string } }>(
        `/api/checkpoints/${checkpoint.id}/restore`,
        { method: 'POST' },
      );
      store.lastRestore = { id: done.restore.id, name: checkpoint.name };
      await store.loadFiles();
      await store.reloadOpenFiles();
      showRestored(checkpoint.name);
    } catch (cause) {
      if (!(cause instanceof RequestFailed)) throw cause;
      statuses.error('Restore status', restoreError(cause.code));
    }
  }

  function restoreError(code: string): string {
    if (code === 'checkpoint_not_saved') return copy.restore.notSaved;
    if (code === 'checkpoint_damaged') return copy.restore.damaged;
    if (code === 'storage_unavailable') return copy.restore.storageOutage;
    if (code === 'restore_superseded') return copy.restore.superseded;
    return copy.generic;
  }

  function showRestored(name: string): void {
    const undo = el('button', { type: 'button' }, ['Undo restore']);
    on(undo, 'click', () => void undoRestore());
    statuses.set('Restore status', copy.restore.success(name), undo);
  }

  async function undoRestore(): Promise<void> {
    const restoreId = store.lastRestore?.id;
    if (restoreId === undefined) return;
    statuses.pending('Restore status', copy.restore.undoPending);
    try {
      await api(`/api/restores/${restoreId}/undo`, { method: 'POST' });
      store.lastRestore = null;
      await store.loadFiles();
      await store.reloadOpenFiles();
      statuses.set('Restore status', copy.restore.undoSuccess);
    } catch (cause) {
      if (!(cause instanceof RequestFailed)) throw cause;
      statuses.error('Restore status', restoreError(cause.code));
    }
  }

  async function openCheckpointDialog(checkpoint: Checkpoint): Promise<void> {
    const body = el('div', {});
    const dialog = openDialog(
      { role: 'dialog', name: `Checkpoint ${checkpoint.name}`, heading: checkpoint.name },
      () => [body],
    );
    const redraw = (files: CheckpointFileRow[]): void => {
      clear(body);
      const rows = el('div', { role: 'list', 'aria-label': 'Files' });
      for (const file of files) {
        const note =
          file.current_path === null
            ? ' deleted since'
            : file.current_path === file.path
              ? ''
              : ` now ${file.current_path}`;
        rows.append(el('div', { role: 'listitem', class: 'mono' }, [`${file.path}${note}`]));
      }
      body.append(rows);
    };
    openCheckpoint = { checkpointId: checkpoint.id, redraw, dialog };
    try {
      const loaded = await api<{ checkpoint: { files: CheckpointFileRow[] } }>(
        `/api/checkpoints/${checkpoint.id}`,
      );
      redraw(loaded.checkpoint.files);
    } catch {
      body.append(el('p', {}, [copy.generic]));
    }
  }

  async function refreshOpenCheckpointDialog(): Promise<void> {
    const open = openCheckpoint;
    if (open === null || !open.dialog.panel.isConnected) {
      openCheckpoint = null;
      return;
    }
    const loaded = await api<{ checkpoint: { files: CheckpointFileRow[] } }>(
      `/api/checkpoints/${open.checkpointId}`,
    );
    open.redraw(loaded.checkpoint.files);
  }

  async function openShareDialog(checkpoint: Checkpoint): Promise<void> {
    const hours = el('input', {
      type: 'number',
      id: 'share-hours',
      min: '1',
      max: '336',
      value: '48',
      'aria-label': 'Expires in hours',
    });
    const email = el('input', {
      type: 'email',
      id: 'share-email',
      'aria-label': 'Reviewer email (optional)',
    });
    const linkField = el('input', {
      type: 'text',
      readonly: true,
      id: 'share-link',
      'aria-label': 'Reviewer link',
    });
    const copyButton = el('button', { type: 'button' }, ['Copy link']);
    const createButton = el('button', { type: 'button' }, ['Create link']);
    const links = el('div', { role: 'list', 'aria-label': 'Reviewer links' });

    const dialog = openDialog(
      { role: 'dialog', name: 'Share with a reviewer', heading: 'Share with a reviewer' },
      () => [
        el('div', { class: 'field' }, [
          el('label', { for: 'share-hours' }, ['Expires in hours']),
          hours,
        ]),
        el('div', { class: 'field' }, [
          el('label', { for: 'share-email' }, ['Reviewer email (optional)']),
          email,
        ]),
        createButton,
        el('div', { class: 'field' }, [
          el('label', { for: 'share-link' }, ['Reviewer link']),
          linkField,
        ]),
        copyButton,
        links,
      ],
    );

    const redraw = (rows: ReviewerLink[]): void => {
      clear(links);
      for (const link of rows) {
        const label = link.state === 'active' ? 'Active' : link.state === 'expired' ? 'Expired' : 'Revoked';
        const revoke = el('button', { type: 'button' }, ['Revoke']);
        const regenerate = el('button', { type: 'button' }, ['Regenerate']);
        on(revoke, 'click', () => void act(link.id, 'revoke'));
        on(regenerate, 'click', () => void act(link.id, 'regenerate'));
        links.append(
          el('div', { role: 'listitem', class: 'link-row' }, [
            el('span', { class: 'link-state' }, [label]),
            revoke,
            regenerate,
          ]),
        );
      }
    };

    const reload = async (): Promise<void> => {
      const loaded = await api<{ links: ReviewerLink[] }>(
        `/api/checkpoints/${checkpoint.id}/reviewer-links`,
      );
      redraw(loaded.links);
    };

    const act = async (linkId: string, move: 'revoke' | 'regenerate'): Promise<void> => {
      try {
        const updated = await api<{ link: ReviewerLink }>(
          `/api/reviewer-links/${linkId}/${move}`,
          { method: 'POST' },
        );
        if (move === 'regenerate') linkField.value = updated.link.url;
        statuses.set(
          'Share status',
          move === 'revoke' ? copy.share.revoked : copy.share.regenerated,
        );
      } catch (cause) {
        if (!(cause instanceof RequestFailed)) throw cause;
        statuses.error('Share status', copy.generic);
      }
      await reload();
    };

    on(createButton, 'click', () => {
      void (async () => {
        const wanted = Number(hours.value);
        if (!Number.isInteger(wanted) || wanted < 1 || wanted > 336) {
          statuses.error('Share status', copy.share.hoursError);
          return;
        }
        createButton.disabled = true;
        try {
          const body: Record<string, unknown> = { expires_in_hours: wanted };
          if (email.value.trim() !== '') body['email'] = email.value.trim();
          const created = await api<{ link: ReviewerLink }>(
            `/api/checkpoints/${checkpoint.id}/reviewer-links`,
            { method: 'POST', body, idempotencyKey: newIdempotencyKey() },
          );
          linkField.value = created.link.url;
          const chip =
            created.link.email_status === 'none'
              ? null
              : el('span', { class: 'chip' }, [
                  created.link.email_status === 'sent' ? 'Email sent' : 'Email queued',
                ]);
          const expiry = copy.share.created(stamp(created.link.expires_at));
          if (chip === null) statuses.set('Share status', expiry);
          else statuses.set('Share status', expiry, chip);
          await reload();
        } catch (cause) {
          if (!(cause instanceof RequestFailed)) throw cause;
          if (cause.code === 'checkpoint_not_saved') {
            statuses.error('Share status', copy.restore.notSaved);
          } else if (cause.field('email') !== undefined) {
            statuses.error('Share status', copy.signIn.fieldError);
          } else if (cause.field('expires_in_hours') !== undefined) {
            statuses.error('Share status', copy.share.hoursError);
          } else {
            statuses.error('Share status', copy.generic);
          }
        } finally {
          createButton.disabled = false;
        }
      })();
    });

    on(copyButton, 'click', () => {
      void navigator.clipboard?.writeText(linkField.value);
    });

    openShare = { checkpointId: checkpoint.id, dialog, redraw };
    await reload();
  }

  window.setInterval(() => {
    const share = openShare;
    if (share === null) return;
    if (!share.dialog.panel.isConnected) {
      openShare = null;
      return;
    }
    void api<{ links: ReviewerLink[] }>(
      `/api/checkpoints/${share.checkpointId}/reviewer-links`,
    ).then((loaded) => share.redraw(loaded.links));
  }, SHARE_REFRESH_MS);

  on(saveButton, 'click', () => void saveCheckpoint());
  on(nameField, 'keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveCheckpoint();
    }
  });

  function applyLayout(): void {
    panel.hidden = !store.ledgerOpen;
    toggle.setAttribute('aria-expanded', String(store.ledgerOpen));
  }

  on(toggle, 'click', () => {
    store.ledgerOpen = !store.ledgerOpen;
    applyLayout();
  });

  let dragStart = 0;
  on(handle, 'pointerdown', (event) => {
    dragStart = event.clientY;
  });
  on(handle, 'pointerup', (event) => {
    if (event.clientY - dragStart > 24) {
      store.ledgerOpen = false;
      applyLayout();
    }
  });

  store.on('ledger', render);
  store.on('layout', applyLayout);

  return { toggle, panel, applyLayout, onPushedCheckpoint, refreshOpenCheckpointDialog };
}
