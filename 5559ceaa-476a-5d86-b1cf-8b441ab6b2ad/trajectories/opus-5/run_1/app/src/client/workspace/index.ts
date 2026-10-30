import type {
  ProjectDetail,
  ServerFrame,
  Session,
  SessionState,
  User,
} from '../../shared/api.js';
import { copy } from '../copy.js';
import { clear, el, initials, on, prefersReducedMotion } from '../dom.js';
import { api, RequestFailed } from '../net.js';
import { openDialog } from '../dialog.js';
import { createEditorPane } from './editorPane.js';
import { createLedgerPane } from './ledgerPane.js';
import {
  openDeleteDialog,
  openImportDialog,
  openMembersDialog,
  openNewFileDialog,
  openRenameDialog,
  openScheduleDialog,
} from './dialogs.js';
import { StatusBoard } from './status.js';
import { bandOf, WorkspaceStore } from './store.js';

const FLIGHT_MS = 320;
const REMOVAL_REDIRECT_MS = 3000;

const STATE_LABELS: Record<SessionState, string> = {
  scheduled: 'Scheduled',
  live: 'Live',
  paused: 'Paused',
  ended: 'Ended',
};

export interface WorkspaceHandle {
  readonly node: HTMLElement;
  dispose(): void;
}

export async function mountWorkspace(
  user: User,
  projectId: string,
  navigate: (path: string) => void,
  accountMenu: (host: HTMLElement) => void,
): Promise<WorkspaceHandle> {
  const loaded = await api<{ project: ProjectDetail }>(`/api/projects/${projectId}`);
  const store = new WorkspaceStore(user, loaded.project);
  const statuses = new StatusBoard();

  const root = el('div', { class: 'workspace' });

  // --- top bar: skip link, then Account ---
  const skip = el('a', { href: '#code-editor', class: 'skip' }, ['Skip to editor']);
  const topbar = el('div', { class: 'topbar' }, [skip, el('span', { class: 'brand' }, ['Relay Bench'])]);
  accountMenu(topbar);

  // --- header: titles, session status, session controls, Members ---
  const heading = el('h1', {});
  const sessionStatus = statuses.create('Session status', 'session-status');
  const controls = el('div', { class: 'session-controls' });
  const membersButton = el('button', { type: 'button' }, ['Members']);
  const header = el('div', { class: 'project-header' }, [
    el('div', { class: 'titles' }, [
      el('div', { class: 'project-title' }, [store.project.title]),
      heading,
    ]),
    sessionStatus,
    controls,
  ]);
  if (store.isMentor) header.append(membersButton);

  // --- presence rail ---
  const participantList = el('div', { role: 'list', 'aria-label': 'Participants' });
  const rail = el('div', { class: 'rail', role: 'complementary', 'aria-label': 'Presence' }, [
    participantList,
  ]);
  const batonGlyph = el('img', {
    id: 'baton-glyph',
    alt: 'Baton',
    src:
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="11">' +
          '<rect width="26" height="11" rx="5.5" fill="#e8a33d"/></svg>',
      ),
  });

  // --- baton bar ---
  const takeButton = el('button', { type: 'button' }, ['Take the baton']);
  const passButton = el('button', { type: 'button' }, ['Pass the baton']);
  const passWrap = el('div', { class: 'menu-wrap' }, [passButton]);
  const batonStatus = statuses.create('Baton status', 'baton-status');
  const batonbar = el('div', { class: 'batonbar' }, [takeButton, passWrap, batonStatus]);

  // --- editor and ledger ---
  const editor = createEditorPane(store, statuses, { onFollowChange: () => renderRail() });
  const ledger = createLedgerPane(store, statuses);
  const importStatus = statuses.create('Import status');

  editor.codeArea.id = 'code-editor';
  const newFileButton = el('button', { type: 'button' }, ['New file']);
  const renameButton = el('button', { type: 'button' }, ['Rename']);
  const deleteButton = el('button', { type: 'button' }, ['Delete file']);
  const importButton = el('button', { type: 'button' }, ['Import zip']);
  editor.fileActions.append(newFileButton);
  if (store.isMentor) editor.fileActions.append(renameButton);
  editor.fileActions.append(deleteButton);
  if (store.isMentor) editor.fileActions.append(importButton, importStatus);

  const editorArea = el('div', { class: 'editor' }, [
    editor.showFilesButton,
    editor.filesPanel,
    editor.main,
  ]);

  root.append(topbar, header, rail, batonbar, editorArea, ledger.toggle, ledger.panel, batonGlyph);

  // ---------- rendering ----------

  function renderHeader(): void {
    const session = store.session;
    clear(heading);
    if (session === null) {
      heading.append('No session scheduled');
      heading.classList.add('empty');
    } else {
      heading.append(session.title);
      heading.classList.remove('empty');
    }
    clear(controls);
    if (!store.isMentor) return;
    const scheduleButton = el('button', { type: 'button' }, ['Schedule session']);
    on(scheduleButton, 'click', () => openScheduleDialog(store, statuses));
    controls.append(scheduleButton);
    const state = session?.state;
    if (state === 'scheduled') controls.append(transition('Start session', 'start'));
    if (state === 'live') controls.append(transition('Pause session', 'pause'));
    if (state === 'paused') controls.append(transition('Resume session', 'resume'));
    if (state === 'live' || state === 'paused') controls.append(transition('End session', 'end'));
  }

  function transition(label: string, move: string): HTMLButtonElement {
    const button = el('button', { type: 'button' }, [label]);
    on(button, 'click', () => {
      void (async () => {
        const session = store.session;
        if (session === null) return;
        button.disabled = true;
        statuses.pending('Session status', copy.session.pending);
        try {
          await api(`/api/sessions/${session.id}/${move}`, { method: 'POST' });
          await store.loadProject();
          describeSession();
        } catch (cause) {
          if (!(cause instanceof RequestFailed)) throw cause;
          if (cause.code === 'session_already_live') {
            statuses.error('Session status', copy.session.anotherLive);
          } else if (cause.code === 'illegal_transition') {
            const from = cause.extra['from'];
            statuses.error('Session status', copy.session.refused(String(from).toLowerCase()));
          } else {
            statuses.error('Session status', copy.generic);
          }
        } finally {
          button.disabled = false;
        }
      })();
    });
    return button;
  }

  function describeSession(): void {
    const session = store.session;
    statuses.set('Session status', session === null ? '' : STATE_LABELS[session.state]);
  }

  function renderRail(): void {
    clear(participantList);
    for (const member of store.participants) {
      const driving = member.user_id === store.driverId;
      const presence = driving ? 'driving' : member.online ? 'viewing' : 'offline';
      const avatar = el('div', { class: 'avatar', 'aria-hidden': 'true' }, [
        initials(member.name),
      ]);
      avatar.style.background = store.tintOf(member.user_id);
      const label = el('span', { class: 'hover-label', 'aria-hidden': 'true' });
      label.dataset['label'] = `${member.name} ${presence}`;
      const slot = el('div', { class: 'avatar-slot' }, [avatar, label]);
      if (driving) slot.dataset['driver'] = 'true';
      slot.dataset['user'] = member.user_id;

      const item = el('div', {
        role: 'listitem',
        class: `participant ${presence}`,
      });
      item.append(
        slot,
        el('span', { class: 'participant-label' }, [
          el('span', { class: 'pname' }, [member.name]),
          ' ',
          el('span', { class: 'vh' }, [presence]),
        ]),
      );
      if (member.role === 'student' && member.email_status === 'none') {
        item.append(el('span', { class: 'demo-tag' }, ['demo']));
      }
      if (member.user_id !== store.user.id) {
        const follow = el(
          'button',
          {
            type: 'button',
            class: 'follow-button quiet',
            'aria-label': `Follow ${member.name}`,
            'aria-pressed': String(store.following === member.user_id),
          },
          ['Follow'],
        );
        on(follow, 'click', () => {
          if (store.following === member.user_id) editor.stopFollowing();
          else void editor.startFollowing(member.user_id);
        });
        item.append(follow);
        if (store.band === 'narrow') {
          on(slot, 'click', () => openFollowSheet(member.name, member.user_id));
        }
      }
      participantList.append(item);
    }
    const target = participantList.querySelector<HTMLElement>('[data-driver="true"]');
    batonGlyph.hidden = target === null;
    if (target !== null) placeGlyph(target);
  }

  function openFollowSheet(name: string, userId: string): void {
    const follow = el('button', { type: 'button', 'aria-label': `Follow ${name}` }, [
      `Follow ${name}`,
    ]);
    const dialog = openDialog({ role: 'dialog', name: `Follow ${name}` }, () => [follow]);
    on(follow, 'click', () => {
      void editor.startFollowing(userId);
      dialog.close();
    });
  }

  function renderBatonControls(): void {
    const live = store.liveSession !== null;
    takeButton.hidden = !live || store.isDriving;
    passWrap.hidden = !(live && (store.isMentor || store.isDriving));
  }

  function placeGlyph(slot: HTMLElement): void {
    const box = slot.getBoundingClientRect();
    batonGlyph.style.left = `${box.left + box.width / 2 - 13}px`;
    batonGlyph.style.top = `${box.top + box.height / 2 - 5}px`;
  }

  /** Baton Pass: the glyph flies from the old driver's avatar to the new one's. */
  function playBatonPass(previousDriverId: string | null): void {
    const target = participantList.querySelector<HTMLElement>('[data-driver="true"]');
    if (target === null) {
      batonGlyph.hidden = true;
      return;
    }
    batonGlyph.hidden = false;
    const from =
      previousDriverId === null
        ? null
        : participantList.querySelector<HTMLElement>(`[data-user="${previousDriverId}"]`);
    if (from === null || prefersReducedMotion()) {
      placeGlyph(target);
      return;
    }
    const start = from.getBoundingClientRect();
    const end = target.getBoundingClientRect();
    placeGlyph(from);
    batonGlyph.animate(
      [
        { transform: 'translate(0, 0)' },
        {
          transform: `translate(${(end.left - start.left) / 2}px, ${
            (end.top - start.top) / 2 - 26
          }px)`,
        },
        { transform: `translate(${end.left - start.left}px, ${end.top - start.top}px)` },
      ],
      { duration: FLIGHT_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
    ).addEventListener('finish', () => {
      batonGlyph.getAnimations().forEach((animation) => animation.cancel());
      placeGlyph(target);
    });
  }

  // ---------- actions ----------

  on(takeButton, 'click', () => {
    void (async () => {
      const session = store.liveSession;
      if (session === null) {
        statuses.error('Baton status', copy.baton.notLive);
        return;
      }
      takeButton.disabled = true;
      statuses.pending('Baton status', copy.baton.pending);
      try {
        await api(`/api/sessions/${session.id}/baton/claim`, {
          method: 'POST',
          body: { version: session.version },
        });
      } catch (cause) {
        if (!(cause instanceof RequestFailed)) throw cause;
        if (cause.code === 'baton_taken') {
          statuses.error('Baton status', copy.baton.lost(String(cause.extra['driver_name'])));
        } else if (cause.code === 'session_not_live') {
          statuses.error('Baton status', copy.baton.notLive);
        } else if (cause.code !== 'already_driving') {
          statuses.error('Baton status', copy.generic);
        }
      } finally {
        takeButton.disabled = false;
      }
    })();
  });

  on(passButton, 'click', () => {
    const existing = passWrap.querySelector('[role="menu"]');
    if (existing !== null) {
      existing.remove();
      return;
    }
    const menu = el('div', { role: 'menu', 'aria-label': 'Pass to' });
    const items = store.participants
      .filter((member) => member.user_id !== store.driverId)
      .map((member) => {
        const item = el(
          'button',
          { type: 'button', role: 'menuitem', 'aria-label': member.name, tabindex: '-1' },
          [member.name],
        );
        on(item, 'click', () => {
          menu.remove();
          passButton.focus();
          void pass(member.user_id);
        });
        return item;
      });
    menu.append(...items);
    passWrap.append(menu);
    items[0]?.focus();
    on(menu, 'keydown', (event) => {
      const index = items.findIndex((item) => item === document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        menu.remove();
        passButton.focus();
      }
    });
  });

  async function pass(toUserId: string): Promise<void> {
    const session = store.liveSession;
    if (session === null) {
      statuses.error('Baton status', copy.baton.notLive);
      return;
    }
    statuses.pending('Baton status', copy.baton.pending);
    try {
      await api(`/api/sessions/${session.id}/baton/pass`, {
        method: 'POST',
        body: { to_user_id: toUserId, version: session.version },
      });
    } catch (cause) {
      if (!(cause instanceof RequestFailed)) throw cause;
      if (cause.code === 'baton_taken') {
        statuses.error('Baton status', copy.baton.lost(String(cause.extra['driver_name'])));
      } else if (cause.code === 'session_not_live') {
        statuses.error('Baton status', copy.baton.notLive);
      } else {
        statuses.error('Baton status', copy.generic);
      }
    }
  }

  on(membersButton, 'click', () => openMembersDialog(store, statuses));
  on(newFileButton, 'click', () => openNewFileDialog(store, statuses));
  on(renameButton, 'click', () => openRenameDialog(store, statuses));
  on(deleteButton, 'click', () => openDeleteDialog(store, statuses));
  on(importButton, 'click', () => openImportDialog(store, statuses));

  // ---------- pushed updates ----------

  function onFrame(frame: ServerFrame): void {
    if (frame.type === 'hello' || frame.type === 'presence') {
      store.participants = frame.participants;
      if (frame.type === 'hello' && frame.session !== null) applySession(frame.session);
      store.emit('rail');
      return;
    }
    if (frame.type === 'session') {
      applySession(frame.session);
      return;
    }
    if (frame.type === 'file') {
      const existing = store.files.find((file) => file.id === frame.file.id);
      const openFile = store.open.get(frame.file.id);
      if (existing === undefined) store.files.push(frame.file);
      else Object.assign(existing, frame.file);
      if (openFile !== undefined && !openFile.dirty && openFile.revision !== frame.file.revision) {
        void store.openFile(frame.file.id);
      }
      if (openFile !== undefined) openFile.revision = Math.max(openFile.revision, frame.file.revision);
      if (store.activeFileId === null) void store.openFile(frame.file.id);
      for (const cursor of store.cursors.values()) {
        if (cursor.file_id === frame.file.id) cursor.path = frame.file.path;
      }
      store.emit('tree', 'tabs', 'cursors');
      void ledger.refreshOpenCheckpointDialog();
      return;
    }
    if (frame.type === 'file_deleted') {
      store.files = store.files.filter((file) => file.id !== frame.file_id);
      if (store.open.has(frame.file_id)) store.closeFile(frame.file_id);
      store.emit('tree', 'tabs');
      void ledger.refreshOpenCheckpointDialog();
      return;
    }
    if (frame.type === 'checkpoint') {
      const existing = store.checkpoints.find((item) => item.id === frame.checkpoint.id);
      if (existing === undefined) store.checkpoints.unshift(frame.checkpoint);
      else Object.assign(existing, frame.checkpoint);
      store.emit('ledger');
      ledger.onPushedCheckpoint(frame.checkpoint);
      return;
    }
    if (frame.type === 'cursor') {
      store.cursors.set(frame.user_id, frame);
      store.emit('cursors');
      return;
    }
    if (frame.type === 'edit_rejected') {
      const path = store.pathOf(frame.file_id);
      if (frame.code === 'stale_revision') {
        void store.openFile(frame.file_id);
        statuses.error('Editor status', copy.editor.stale(path));
      } else if (frame.code === 'validation') {
        statuses.error('Editor status', copy.editor.tooLarge(path));
      } else {
        editor.describe();
      }
      return;
    }
    store.removed = true;
    store.emit('access', 'code');
    window.setTimeout(() => navigate('/'), REMOVAL_REDIRECT_MS);
  }

  function applySession(incoming: Session): void {
    const previousDriver = store.driverId;
    const known = store.sessions.find((item) => item.id === incoming.id);
    if (known === undefined) store.sessions.push(incoming);
    else Object.assign(known, incoming);
    renderHeader();
    describeSession();
    renderRail();
    renderBatonControls();
    store.emit('baton');
    if (previousDriver !== store.driverId) {
      playBatonPass(previousDriver);
      if (store.driverId !== null) {
        statuses.set('Baton status', copy.baton.driving(store.nameOf(store.driverId)));
      }
    }
  }

  // ---------- layout ----------

  function applyLayout(): void {
    root.classList.toggle('ledger-closed', !store.ledgerOpen);
    editor.applyLayout();
    ledger.applyLayout();
  }

  const onResize = (): void => {
    const band = bandOf(window.innerWidth);
    if (band === store.band) return;
    store.band = band;
    store.ledgerOpen = band === 'wide';
    store.filesOverlayOpen = false;
    store.emit('layout', 'rail');
    applyLayout();
  };
  window.addEventListener('resize', onResize);

  store.on('rail', renderRail);
  store.on('header', renderHeader);
  store.on('baton', renderBatonControls);

  renderHeader();
  describeSession();
  renderRail();
  renderBatonControls();
  applyLayout();
  await store.loadFiles();
  await store.loadCheckpoints();
  store.emit('tree', 'tabs', 'code', 'ledger');
  const firstFile = store.files[0];
  if (firstFile !== undefined) await store.openFile(firstFile.id);
  store.connect(onFrame);

  return {
    node: root,
    dispose: () => window.removeEventListener('resize', onResize),
  };
}
