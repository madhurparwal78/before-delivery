import { ApiFailure, firstFieldMessage, request } from '../../api.js';
import { copy, figures, mmss } from '../../../shared/copy.js';
import { lengthText } from '../../../shared/units.js';
import type {
  Placement,
  PlaytestSession,
  Room,
  RoomDetail,
  RoomVersion,
  SessionUser,
  Workspace,
} from '../../../shared/types.js';
import { ServerClock } from '../../clock.js';
import { button, clear, el, isTextField, prefersReducedMotion, trapTab } from '../../dom.js';
import { LiveStream } from '../../live.js';
import { SaveQueue } from '../../queue.js';
import { RoomStage } from '../../stage/stage.js';
import { thumbnailBlob } from '../../stage/thumbnail.js';
import { editorUnits, setEditorUnits } from '../../units.js';
import { buildChrome } from './chrome.js';
import { pickerColumns, pickerParts } from './picker.js';
import {
  applyVersionEvent,
  commandPalette,
  debriefSheet,
  forgetGraph,
  forgetPlaytests,
  forgetVersions,
  newRoomSheet,
  playtestsSheet,
  propLibrarySheet,
  propLockedSheet,
  repaintGraph,
  repaintPlaytests,
  shortcutsSheet,
  triggerGraphSheet,
  versionsSheet,
} from './sheets.js';
import { controlsSession, hooks, state, targetSession } from './state.js';
import type { DialogHandle } from './state.js';

export function editorView(
  root: HTMLElement,
  roomIdFromPath: string | null,
  go: (path: string) => void,
): void {
  document.body.className = 'fixed';
  const stage = new RoomStage();
  state.stage = stage;
  const chrome = buildChrome();
  root.append(stage.element, ...chrome.nodes);

  const dialogs: DialogHandle[] = [];
  let stream: LiveStream | null = null;
  let savedPose = stage.savedPose();
  let thumbnailTimer: number | null = null;
  let lockTimer: number | null = null;

  const clock = new ServerClock((text) => {
    chrome.clock.textContent = text;
  });

  const announce = (text: string): void => {
    chrome.editorStatus.textContent = text;
  };

  /* ------------------------------------------------------------- dialogs */

  const openDialog = (
    name: string,
    build: (body: HTMLElement) => void,
    opener: HTMLElement | null,
    variant: 'centred' | 'side' | 'small' | 'palette' = 'centred',
  ): DialogHandle => {
    const scrim = el('div', { class: 'scrim' });
    const body = el('div', {
      class: `sheet ${variant}`,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': name,
    });
    const close = button('Close', {}, [document.createTextNode('✕')]);
    close.addEventListener('click', () => closeDialog());
    if (name !== 'Open a room') {
      body.append(el('div', { class: 'sheet-header' }, [el('h2', { text: name }), close]));
    }
    build(body);
    body.addEventListener('keydown', (event) => trapTab(body, event));
    scrim.addEventListener('click', () => closeDialog());
    root.append(scrim, body);
    const handle: DialogHandle = { name, element: body, scrim, opener };
    dialogs.push(handle);
    const highlighted = body.querySelector<HTMLElement>('[aria-selected="true"]');
    const first = highlighted ?? body.querySelector<HTMLElement>('input, select, button, a[href]');
    first?.focus();
    return handle;
  };

  const closeDialog = (): void => {
    const handle = dialogs.pop();
    if (!handle) return;
    handle.element.remove();
    handle.scrim.remove();
    if (handle.name === 'Trigger graph') forgetGraph();
    if (handle.name === 'Versions') forgetVersions();
    if (handle.name === 'Playtests') forgetPlaytests();
    handle.onClose?.();
    if (handle.opener !== null && handle.opener.isConnected) handle.opener.focus();
    else stage.element.focus();
  };

  const closeAll = (): void => {
    while (dialogs.length > 0) closeDialog();
  };

  /* ------------------------------------------------------------- picker */

  const openPicker = (opener: HTMLElement | null): void => {
    const handle = openDialog(
      'Open a room',
      (body) => {
        const parts = pickerParts(() => closeDialog());
        body.append(parts.header, parts.content);
        body.addEventListener('keydown', (event) => {
          if (isTextField(event.target as Element)) return;
          const columns = pickerColumns();
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            parts.move(1);
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            parts.move(-1);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            parts.move(columns);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            parts.move(-columns);
          } else if (event.key === 'Home') {
            event.preventDefault();
            parts.jump(0);
          } else if (event.key === 'End') {
            event.preventDefault();
            parts.jump(state.rooms.length - 1);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            parts.openHighlighted();
          }
        });
        window.setTimeout(() => parts.focusHighlighted(), 0);
      },
      opener,
    );
    handle.onClose = (): void => undefined;
  };

  /* ------------------------------------------------------------- painting */

  const paintFigures = (): void => {
    const stats = state.room?.stats ?? { solved: 0, total: 0, longestRun: 0, props: 0 };
    const parts = [figures.solved(stats), figures.run(stats), figures.props(stats)];
    [...chrome.chainFigures.children].forEach((child, index) => {
      child.textContent = parts[index];
    });
  };

  const paintInspector = (): void => {
    const placement = state.placements.find((item) => item.id === state.selectedPlacement);
    if (!placement) {
      chrome.inspector.hidden = true;
      return;
    }
    chrome.inspector.hidden = false;
    clear(chrome.inspector);
    const rows: [string, string][] = [
      ['Label', placement.label],
      ['X', lengthText(placement.xMm, editorUnits())],
      ['Y', lengthText(placement.yMm, editorUnits())],
      ['Z', lengthText(placement.zMm, editorUnits())],
      ['Width', lengthText(placement.widthMm, editorUnits())],
      ['Depth', lengthText(placement.depthMm, editorUnits())],
      ['Height', lengthText(placement.heightMm, editorUnits())],
    ];
    const definitions = el('dl', {});
    for (const [name, value] of rows) {
      definitions.append(el('dt', { text: name }), el('dd', { text: value }));
    }
    chrome.rotation.value = String(placement.rotationDeg);
    chrome.inspector.append(
      el('h3', { text: 'Inspector' }),
      definitions,
      el('label', { class: 'field' }, [el('span', { text: 'Rotation' }), chrome.rotation]),
    );
  };

  const paintSceneTree = (): void => {
    const focused = document.activeElement;
    const keepFocusOn =
      focused instanceof HTMLElement && chrome.sceneTree.contains(focused)
        ? focused.getAttribute('data-placement-id')
        : null;
    clear(chrome.sceneTree);
    if (!state.room) return;
    const ordered = state.sceneOrder
      .map((id) => state.placements.find((item) => item.id === id))
      .filter((item): item is Placement => item !== undefined);
    const children = el('ul', { role: 'group' });
    ordered.forEach((placement, index) => {
      const holder = state.holders.get(`placement:${placement.id}`);
      const item = el('li', {
        role: 'treeitem',
        'aria-label': placement.label,
        'aria-level': '2',
        'aria-posinset': String(index + 1),
        'aria-setsize': String(ordered.length),
        'aria-selected': state.selectedPlacement === placement.id ? 'true' : 'false',
        tabindex: '-1',
        'data-placement-id': placement.id,
        'data-x-mm': String(Math.round(placement.xMm)),
        'data-y-mm': String(Math.round(placement.yMm)),
        'data-z-mm': String(Math.round(placement.zMm)),
        'data-rotation-deg': String(Math.round(placement.rotationDeg)),
        text: placement.label,
      });
      if (holder !== undefined) item.setAttribute('aria-description', `Locked by ${holder}`);
      const steps = state.simSteps.get(placement.id);
      if (steps !== undefined) item.setAttribute('data-sim-steps', String(steps));
      children.append(item);
    });
    const roomItem = el('li', {
      role: 'treeitem',
      'aria-label': state.room.name,
      'aria-level': '1',
      'aria-expanded': 'true',
      tabindex: '0',
    });
    roomItem.append(el('span', { text: state.room.name }), children);
    chrome.sceneTree.append(roomItem);
    if (keepFocusOn !== null) {
      const again = chrome.sceneTree.querySelector<HTMLElement>(
        `[data-placement-id="${keepFocusOn}"]`,
      );
      if (again) {
        roomItem.setAttribute('tabindex', '-1');
        again.setAttribute('tabindex', '0');
        again.focus();
      }
    }
  };

  const paintCueTimeline = (): void => {
    if (chrome.cueTimeline.hidden) return;
    clear(chrome.cueTimeline);
    const session = state.sessions.find((item) => item.id === state.latestSessionId);
    const list = el('ul', {});
    if (session && (session.state === 'running' || session.state === 'ended')) {
      for (const solve of session.solves) {
        list.append(el('li', { class: 'mono', text: `${mmss(solve.elapsedSeconds)} ${solve.title}` }));
      }
    } else {
      for (const node of state.nodes) {
        if (node.kind === 'lock' || node.kind === 'cue') {
          list.append(el('li', { text: node.title }));
        }
      }
    }
    chrome.cueTimeline.append(list);
  };

  const paintSession = (): void => {
    const session = state.sessions.find(
      (item) => item.state === 'running' && item.roomId === state.room?.id,
    );
    const mine = session !== undefined && controlsSession(session);
    chrome.clock.hidden = session === undefined;
    if (session) clock.sync(session.remainingSeconds, true);
    chrome.playButton.setAttribute(
      'aria-label',
      mine ? 'Stop playtest' : 'Start playtest',
    );
    const glyph = chrome.playButton.querySelector('.icon');
    if (glyph) {
      glyph.innerHTML = mine
        ? '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" /></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z" /></svg>';
    }
    const target = targetSession();
    chrome.inviteButton.disabled = chrome.inviteEmail.value === '' || target === null;
  };

  const paintBanners = (): void => {
    const banner = !state.liveAvailable
      ? copy.liveDown
      : !state.storageAvailable
        ? copy.storageDown
        : '';
    chrome.serviceStatus.textContent = banner;
    chrome.statusWord.textContent = state.liveAvailable ? 'Live' : 'Paused';
    chrome.statusDot.classList.toggle('paused', !state.liveAvailable);
  };

  const paint = (): void => {
    if (state.room) {
      chrome.roomCode.textContent = state.room.id.slice(0, 6).toUpperCase();
      stage.setRoom(state.room, state.placements);
      stage.setSelection(state.selectedPlacement);
    }
    paintFigures();
    paintInspector();
    paintSceneTree();
    paintCueTimeline();
    paintSession();
    paintBanners();
    chrome.presenceButton.textContent = `${Math.max(1, state.presence.length)} here`;
    if (state.me) {
      chrome.accountButton.textContent = state.me.displayName
        .split(' ')
        .map((part) => part.slice(0, 1))
        .join('')
        .slice(0, 2)
        .toUpperCase();
    }
    repaintGraph();
  };

  /* ------------------------------------------------------------- loading */

  const loadRooms = async (): Promise<void> => {
    const answer = await request<{ rooms: Room[] }>('GET', '/api/rooms');
    state.rooms = answer.rooms;
    for (const room of answer.rooms) {
      try {
        const detail = await request<RoomDetail>('GET', `/api/rooms/${room.id}`);
        state.roomDetails.set(room.id, { room: detail.room, placements: detail.placements });
        if (detail.room.thumbnailUrl === null) void storeThumbnail(detail.room, detail.placements);
      } catch {
        break;
      }
    }
  };

  const storeThumbnail = async (room: Room, placements: Placement[]): Promise<void> => {
    const blob = await thumbnailBlob(room, placements);
    if (blob === null) return;
    try {
      await request<void>('PUT', `/api/rooms/${room.id}/thumbnail`, { raw: blob });
    } catch {
      /* a storage outage leaves the card rendering its thumbnail live */
    }
  };

  const reloadRoom = async (): Promise<void> => {
    if (!state.room) return;
    const detail = await request<RoomDetail>('GET', `/api/rooms/${state.room.id}`);
    state.room = detail.room;
    state.placements = applyQueued(detail.placements);
    state.nodes = detail.nodes;
    state.sceneOrder = detail.sceneOrder;
    state.activeSession = detail.activeSession;
    state.latestSessionId = detail.latestSessionId;
    for (const placement of detail.placements) {
      state.queue?.knowVersion(placement.id, placement.version);
    }
    await loadSessions();
    paint();
  };

  const loadSessions = async (): Promise<void> => {
    if (!state.room) return;
    try {
      const answer = await request<{ sessions: PlaytestSession[] }>(
        'GET',
        `/api/rooms/${state.room.id}/playtests`,
      );
      state.sessions = answer.sessions;
    } catch {
      state.sessions = [];
    }
  };

  const applyQueued = (placements: Placement[]): Placement[] => {
    let next = [...placements];
    for (const change of state.queue?.waiting ?? []) {
      if (change.kind === 'patch') {
        next = next.map((placement) =>
          placement.id === change.placementId
            ? ({ ...placement, ...change.body } as Placement)
            : placement,
        );
      } else if (change.kind === 'delete') {
        next = next.filter((placement) => placement.id !== change.placementId);
      }
    }
    return next;
  };

  const openRoom = async (roomId: string, walkIn: boolean): Promise<void> => {
    closeAll();
    state.selectedPlacement = null;
    state.selectedNode = null;
    state.holders = new Map();
    const detail = await request<RoomDetail>('GET', `/api/rooms/${roomId}`);
    state.room = detail.room;
    state.queue = new SaveQueue(roomId, {
      onPlacement: (placement) => {
        state.placements = state.placements.map((item) =>
          item.id === placement.id ? placement : item,
        );
        stage.updatePlacement(placement);
        paintSceneTree();
        paintInspector();
        scheduleThumbnail();
      },
      onSceneOrder: (order) => {
        state.sceneOrder = order;
        paintSceneTree();
      },
      onDropped: (message) => {
        if (message !== null) announce(message);
      },
      onConnection: (text) => {
        chrome.connection.textContent = text;
      },
      onRedraw: () => void reloadRoom(),
    });
    state.placements = applyQueued(detail.placements);
    state.nodes = detail.nodes;
    state.sceneOrder = detail.sceneOrder;
    state.activeSession = detail.activeSession;
    state.latestSessionId = detail.latestSessionId;
    for (const placement of detail.placements) {
      state.queue.knowVersion(placement.id, placement.version);
    }
    await loadSessions();
    window.history.replaceState(null, '', `/app/rooms/${roomId}`);
    stage.setRoom(detail.room, state.placements);
    listen(roomId);
    void state.queue.pump();
    paint();
    if (walkIn) await startWalkIn();
    else {
      stage.setCamera(30, 35);
      stage.announce('Overview');
      savedPose = stage.savedPose();
    }
  };

  /* ------------------------------------------------------------- playtests */

  const startWalkIn = async (): Promise<void> => {
    if (!state.room) return;
    savedPose = stage.savedPose();
    try {
      const answer = await request<{ session: PlaytestSession }>(
        'POST',
        `/api/rooms/${state.room.id}/walk-in`,
      );
      state.sessions = [answer.session, ...state.sessions];
      state.latestSessionId = answer.session.id;
      await stage.walkIn(prefersReducedMotion());
      clock.sync(answer.session.remainingSeconds, true);
      announce(copy.playtestStarted);
      await reloadRoom();
    } catch (error) {
      stage.setCamera(30, 35);
      stage.announce('Overview');
      if (error instanceof ApiFailure && error.body.error === 'room_busy') {
        announce(copy.roomBusy);
        return;
      }
      if (error instanceof ApiFailure && error.body.error === 'live_unavailable') {
        announce(copy.liveDown);
        return;
      }
      announce(copy.roomBusy);
    }
  };

  const stopPlaytest = async (session: PlaytestSession): Promise<void> => {
    try {
      await request<unknown>('POST', `/api/playtests/${session.id}/end`);
    } catch {
      /* the server may already have ended it */
    }
    await stage.toOverview(prefersReducedMotion());
    stage.restorePose(savedPose, 'Overview');
    await reloadRoom();
    openDebrief(session.id);
  };

  const startStop = (): void => {
    const running = state.sessions.find(
      (item) => item.state === 'running' && item.roomId === state.room?.id,
    );
    if (running && controlsSession(running)) {
      void stopPlaytest(running);
      return;
    }
    const lobby = state.sessions.find(
      (item) => item.state === 'lobby' && item.roomId === state.room?.id,
    );
    if (lobby && controlsSession(lobby)) {
      void request<{ session: PlaytestSession }>('POST', `/api/playtests/${lobby.id}/start`)
        .then(async () => {
          announce(copy.playtestStarted);
          await reloadRoom();
        })
        .catch((error: unknown) => {
          announce(
            error instanceof ApiFailure && error.body.error === 'live_unavailable'
              ? copy.liveDown
              : copy.roomBusy,
          );
        });
      return;
    }
    void startWalkIn();
  };

  const debriefShown = new Set<string>();

  const openDebrief = (sessionId: string): void => {
    if (debriefShown.has(sessionId)) return;
    debriefShown.add(sessionId);
    const handle = openDialog('Debrief', (body) => debriefSheet(body, sessionId), null);
    handle.onClose = (): void => {
      chrome.playButton.focus();
    };
    announce(copy.playtestEnded);
  };

  /* ------------------------------------------------------------- locks */

  const takeLock = async (
    targetType: 'placement' | 'node',
    targetId: string,
    takeOver: boolean,
  ): Promise<boolean> => {
    if (!state.room) return false;
    try {
      await request<unknown>('POST', `/api/rooms/${state.room.id}/locks`, {
        body: { targetType, targetId, ...(takeOver ? { takeOver: true } : {}) },
      });
      state.holders.delete(`${targetType}:${targetId}`);
      return true;
    } catch (error) {
      if (error instanceof ApiFailure && error.body.error === 'locked' && error.body.holder) {
        state.holders.set(`${targetType}:${targetId}`, error.body.holder.displayName);
        announce(
          targetType === 'placement'
            ? copy.propHeld(error.body.holder.displayName)
            : copy.nodeHeld(error.body.holder.displayName),
        );
      }
      return false;
    }
  };

  const releaseLock = (targetType: 'placement' | 'node', targetId: string): void => {
    if (!state.room || !state.liveAvailable) return;
    void request<void>(
      'DELETE',
      `/api/rooms/${state.room.id}/locks/${targetType}/${targetId}`,
    ).catch(() => undefined);
  };

  const selectPlacement = (placementId: string | null): void => {
    const previous = state.selectedPlacement;
    if (previous !== null && previous !== placementId) releaseLock('placement', previous);
    state.selectedPlacement = placementId;
    if (lockTimer !== null) {
      window.clearInterval(lockTimer);
      lockTimer = null;
    }
    if (placementId !== null) {
      void takeLock('placement', placementId, false).then(() => {
        paintSceneTree();
        paintInspector();
      });
      lockTimer = window.setInterval(() => {
        if (state.selectedPlacement !== null) {
          void takeLock('placement', state.selectedPlacement, false);
        }
      }, 10_000);
    }
    stage.setSelection(placementId);
    paintInspector();
    paintSceneTree();
  };

  const selectNode = (nodeId: string | null): void => {
    const previous = state.selectedNode;
    if (previous !== null && previous !== nodeId) releaseLock('node', previous);
    state.selectedNode = nodeId;
    if (nodeId !== null) {
      void takeLock('node', nodeId, false).then(() => repaintGraph());
    }
    repaintGraph();
  };

  /* ------------------------------------------------------------- editing */

  const scheduleThumbnail = (): void => {
    if (thumbnailTimer !== null) window.clearTimeout(thumbnailTimer);
    thumbnailTimer = window.setTimeout(() => {
      thumbnailTimer = null;
      if (state.room) void storeThumbnail(state.room, state.placements);
    }, 2000);
  };

  const applyLocal = (placement: Placement): void => {
    state.placements = state.placements.map((item) =>
      item.id === placement.id ? placement : item,
    );
    stage.updatePlacement(placement);
    paintSceneTree();
    paintInspector();
  };

  const commit = (placement: Placement, patch: Partial<Placement>): void => {
    const holder = state.holders.get(`placement:${placement.id}`);
    if (holder !== undefined) {
      announce(copy.propHeld(holder));
      return;
    }
    const next = { ...placement, ...patch };
    applyLocal(next);
    scheduleThumbnail();
    state.queue?.add({
      id: state.queue.newId(),
      kind: 'patch',
      placementId: placement.id,
      body: { ...patch, version: placement.version },
    });
  };

  const selected = (): Placement | null =>
    state.placements.find((item) => item.id === state.selectedPlacement) ?? null;

  const clampNudge = (placement: Placement, patch: Partial<Placement>): Partial<Placement> | null => {
    const room = state.room;
    if (!room) return null;
    const limits: Record<string, [number, number]> = {
      xMm: [0, room.widthMm],
      zMm: [0, room.depthMm],
      yMm: [0, room.heightMm],
      widthMm: [10, room.widthMm],
      depthMm: [10, room.depthMm],
      heightMm: [10, room.heightMm],
    };
    const out: Record<string, number> = {};
    for (const [field, raw] of Object.entries(patch)) {
      const value = raw as number;
      const bound = limits[field];
      const clamped = bound ? Math.min(Math.max(value, bound[0]), bound[1]) : value;
      const current = (placement as unknown as Record<string, number>)[field];
      if (clamped === current) return null;
      out[field] = clamped;
    }
    return out as Partial<Placement>;
  };

  const nudge = (patch: Partial<Placement>): void => {
    const placement = selected();
    if (!placement) return;
    const clamped = clampNudge(placement, patch);
    if (clamped === null) return;
    commit(placement, clamped);
  };

  const deleteSelected = (): void => {
    const placement = selected();
    if (!placement || !state.queue) return;
    const holder = state.holders.get(`placement:${placement.id}`);
    if (holder !== undefined) {
      announce(copy.propHeld(holder));
      return;
    }
    state.placements = state.placements.filter((item) => item.id !== placement.id);
    state.sceneOrder = state.sceneOrder.filter((id) => id !== placement.id);
    stage.removePlacement(placement.id);
    state.selectedPlacement = null;
    paint();
    state.queue.add({
      id: state.queue.newId(),
      kind: 'delete',
      placementId: placement.id,
    });
  };

  /** The fixed-step fall: 120 steps a second, g = 9,810 mm/s², no bounce. */
  const dropSelected = (): void => {
    const placement = selected();
    if (!placement) return;
    const holder = state.holders.get(`placement:${placement.id}`);
    if (holder !== undefined) {
      announce(copy.propHeld(holder));
      return;
    }
    if (placement.kind === 'door' || placement.yMm <= 0) return;
    const start = placement.yMm;
    const began = performance.now();
    const step = (): void => {
      const elapsed = performance.now() - began;
      const steps = Math.floor((elapsed * 120) / 1000);
      const fallen = (109 * steps * (steps + 1)) / 320;
      const height = start - fallen;
      if (height <= 0) {
        let landing = 1;
        while (start - (109 * landing * (landing + 1)) / 320 > 0) landing += 1;
        state.simSteps.set(placement.id, landing);
        const current =
          state.placements.find((item) => item.id === placement.id) ?? placement;
        commit(current, { yMm: 0 });
        paintSceneTree();
        return;
      }
      state.simSteps.set(placement.id, steps);
      const item = chrome.sceneTree.querySelector<HTMLElement>(
        `[data-placement-id="${placement.id}"]`,
      );
      if (item) {
        item.setAttribute('data-y-mm', String(Math.round(height)));
        item.setAttribute('data-sim-steps', String(steps));
      }
      window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  };

  const undo = (): void => {
    if (!state.room) return;
    void request<{ undone: { label: string; field: string }; placement: Placement }>(
      'POST',
      `/api/rooms/${state.room.id}/undo`,
      { body: {} },
    )
      .then((answer) => {
        applyLocal(answer.placement);
        state.queue?.knowVersion(answer.placement.id, answer.placement.version);
        announce(copy.undoDone(answer.undone.field, answer.undone.label));
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) return;
        if (error.body.error === 'nothing_to_undo') {
          announce(copy.nothingToUndo);
          return;
        }
        if (error.body.error === 'undo_conflict' && error.body.label && error.body.deletedBy) {
          announce(copy.undoDeleted(error.body.label, error.body.deletedBy.displayName));
          return;
        }
        if (error.body.error === 'locked' && error.body.holder) {
          announce(copy.propHeld(error.body.holder.displayName));
        }
      });
  };

  const sceneMove = (placementId: string, direction: 'up' | 'down'): void => {
    if (!state.queue) return;
    const order = [...state.sceneOrder];
    const index = order.indexOf(placementId);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= order.length) return;
    const moved = state.placements.find((item) => item.id === placementId);
    const passed = state.placements.find((item) => item.id === order[swapWith]);
    order[index] = order[swapWith];
    order[swapWith] = placementId;
    state.sceneOrder = order;
    paintSceneTree();
    if (moved && passed) {
      announce(
        direction === 'up'
          ? copy.sceneMovedAbove(moved.label, passed.label)
          : copy.sceneMovedBelow(moved.label, passed.label),
      );
    }
    state.queue.add({
      id: state.queue.newId(),
      kind: 'move',
      placementId,
      direction,
    });
  };

  /* ------------------------------------------------------------- live */

  const listen = (roomId: string): void => {
    stream?.close();
    const live = new LiveStream(`/api/rooms/${roomId}/events`);
    stream = live;
    live.on('presence', (data) => {
      state.presence = (data as { members: { userId: string; displayName: string }[] }).members;
      chrome.presenceButton.textContent = `${Math.max(1, state.presence.length)} here`;
    });
    live.on('live', (data) => {
      state.liveAvailable = (data as { available: boolean }).available;
      paintBanners();
    });
    live.on('placement', (data) => {
      const payload = data as { placement?: Placement; deletedId?: string };
      if (payload.deletedId !== undefined) {
        state.placements = state.placements.filter((item) => item.id !== payload.deletedId);
        state.sceneOrder = state.sceneOrder.filter((id) => id !== payload.deletedId);
        stage.removePlacement(payload.deletedId);
        paint();
        return;
      }
      if (payload.placement === undefined) return;
      const placement = payload.placement;
      if (state.placements.some((item) => item.id === placement.id)) {
        applyLocal(placement);
      } else {
        state.placements = [...state.placements, placement];
        state.sceneOrder = [...state.sceneOrder, placement.id];
        stage.setRoom(state.room ?? placement, state.placements);
        paint();
      }
      state.queue?.knowVersion(placement.id, placement.version);
    });
    live.on('node', () => void reloadRoom());
    live.on('room', (data) => {
      const payload = data as { room: Room | null };
      if (payload.room === null) return;
      const ahead = state.room !== null && payload.room.revision > state.room.revision;
      state.room = payload.room;
      paintFigures();
      if (ahead) void reloadRoom();
    });
    live.on('lock', (data) => {
      const payload = data as {
        lock?: {
          targetType: string;
          targetId: string;
          holder: { userId: string; displayName: string };
        };
        takenFrom?: { userId: string; displayName: string };
        released?: { targetType: string; targetId: string };
      };
      if (payload.released) {
        state.holders.delete(`${payload.released.targetType}:${payload.released.targetId}`);
      } else if (payload.lock) {
        const key = `${payload.lock.targetType}:${payload.lock.targetId}`;
        if (payload.lock.holder.userId === state.me?.id) state.holders.delete(key);
        else state.holders.set(key, payload.lock.holder.displayName);
        if (
          payload.takenFrom !== undefined &&
          payload.takenFrom.userId === state.me?.id &&
          payload.lock.targetType === 'placement'
        ) {
          const placement = state.placements.find(
            (item) => item.id === payload.lock?.targetId,
          );
          if (placement) {
            announce(copy.takenOver(payload.lock.holder.displayName, placement.label));
          }
        }
      }
      paintSceneTree();
      repaintGraph();
    });
    live.on('version', (data) => {
      applyVersionEvent((data as { version: RoomVersion }).version);
    });
    live.on('session', (data) => {
      const payload = data as { session: PlaytestSession };
      state.sessions = [
        payload.session,
        ...state.sessions.filter((item) => item.id !== payload.session.id),
      ];
      if (payload.session.state === 'ended' && controlsSession(payload.session)) {
        if (!debriefShown.has(payload.session.id)) {
          void stage.toOverview(prefersReducedMotion()).then(() => {
            stage.restorePose(savedPose, 'Overview');
            openDebrief(payload.session.id);
          });
        }
      }
      if (state.room) state.latestSessionId = payload.session.id;
      paintSession();
      paintCueTimeline();
      repaintPlaytests();
    });
    live.on('solve', () => void reloadRoom());
    live.on('hint', () => repaintPlaytests());
    live.on('tester', (data) => {
      stage.setTesters([
        data as { displayName: string; xMm: number; zMm: number; headingDeg: number },
      ]);
    });
    live.on('restore', () => void reloadRoom());
  };

  /* ------------------------------------------------------------- keyboard */

  const insideDialog = (): boolean => dialogs.length > 0;

  const editorKeysAllowed = (): boolean => {
    if (insideDialog()) return false;
    const active = document.activeElement;
    if (isTextField(active)) return false;
    return active !== null && (active === stage.element || root.contains(active));
  };

  const onKey = (event: KeyboardEvent): void => {
    const top = dialogs[dialogs.length - 1] ?? null;
    if (event.key === 'Escape') {
      if (top) {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (state.selectedPlacement !== null) selectPlacement(null);
      return;
    }
    if (top && top.name === 'Trigger graph' && !isTextField(document.activeElement)) {
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        stepNode(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key === 't' || event.key === 'T') {
        event.preventDefault();
        closeDialog();
        return;
      }
    }
    if (!editorKeysAllowed()) return;
    const onTree = (document.activeElement as HTMLElement | null)?.closest('[role="tree"]') !== null
      && (document.activeElement as HTMLElement | null)?.getAttribute('role') === 'treeitem';
    if (onTree) {
      if (handleTreeKey(event)) return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
      event.preventDefault();
      openPalette(document.activeElement as HTMLElement | null);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
      event.preventDefault();
      undo();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const placement = selected();
    switch (event.key) {
      case 'g':
      case 'G':
        setMode('move');
        return;
      case 'r':
      case 'R':
        setMode('rotate');
        return;
      case 's':
      case 'S':
        setMode('scale');
        return;
      case ']':
        cycleSelection(1);
        return;
      case '[':
        cycleSelection(-1);
        return;
      case 'Delete':
        deleteSelected();
        return;
      case 'n':
      case 'N':
        stepNode(event.shiftKey ? -1 : 1);
        return;
      case 'p':
      case 'P':
        startStop();
        return;
      case 't':
      case 'T':
        openGraph(chrome.graphButton);
        return;
      case 'l':
      case 'L':
        openLibrary(chrome.libraryButton, false);
        return;
      case '?':
        openShortcuts(null);
        return;
      case 'd':
      case 'D':
        dropSelected();
        return;
      default:
        break;
    }
    const steps = event.shiftKey ? 100 : 10;
    if (!event.key.startsWith('Arrow')) return;
    if (placement === null) {
      if (document.activeElement !== stage.element) return;
      event.preventDefault();
      if (event.key === 'ArrowRight') stage.turn(15, 0);
      if (event.key === 'ArrowLeft') stage.turn(-15, 0);
      if (event.key === 'ArrowUp') stage.turn(0, 15);
      if (event.key === 'ArrowDown') stage.turn(0, -15);
      return;
    }
    event.preventDefault();
    if (state.mode === 'move') {
      if (event.key === 'ArrowRight') nudge({ xMm: placement.xMm + steps });
      if (event.key === 'ArrowLeft') nudge({ xMm: placement.xMm - steps });
      if (event.key === 'ArrowUp') nudge({ zMm: placement.zMm + steps });
      if (event.key === 'ArrowDown') nudge({ zMm: placement.zMm - steps });
      return;
    }
    if (state.mode === 'rotate') {
      if (event.key === 'ArrowRight') {
        commitRotation(placement, (placement.rotationDeg + 15) % 360);
      }
      if (event.key === 'ArrowLeft') {
        commitRotation(placement, (placement.rotationDeg - 15 + 360) % 360);
      }
      return;
    }
    if (event.key === 'ArrowRight') nudge({ widthMm: placement.widthMm + 10 });
    if (event.key === 'ArrowLeft') nudge({ widthMm: placement.widthMm - 10 });
    if (event.key === 'ArrowUp') nudge({ heightMm: placement.heightMm + 10 });
    if (event.key === 'ArrowDown') nudge({ heightMm: placement.heightMm - 10 });
  };

  const commitRotation = (placement: Placement, rotationDeg: number): void => {
    commit(placement, { rotationDeg });
  };

  const handleTreeKey = (event: KeyboardEvent): boolean => {
    const items = [...chrome.sceneTree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const current = document.activeElement as HTMLElement;
    const index = items.indexOf(current);
    const focusAt = (next: number): void => {
      const item = items[Math.min(Math.max(next, 0), items.length - 1)];
      if (!item) return;
      for (const other of items) other.setAttribute('tabindex', '-1');
      item.setAttribute('tabindex', '0');
      item.focus();
    };
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const placementId = current.getAttribute('data-placement-id');
      if (placementId !== null) sceneMove(placementId, event.key === 'ArrowUp' ? 'up' : 'down');
      const again = chrome.sceneTree.querySelector<HTMLElement>(
        `[data-placement-id="${placementId}"]`,
      );
      again?.setAttribute('tabindex', '0');
      again?.focus();
      return true;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusAt(index + 1);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusAt(index - 1);
      return true;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusAt(0);
      return true;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusAt(items.length - 1);
      return true;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const placementId = current.getAttribute('data-placement-id');
      if (placementId !== null) selectPlacement(placementId);
      current.focus();
      return true;
    }
    return false;
  };

  const setMode = (mode: 'move' | 'rotate' | 'scale'): void => {
    state.mode = mode;
    chrome.moveButton.setAttribute('aria-pressed', mode === 'move' ? 'true' : 'false');
    chrome.rotateButton.setAttribute('aria-pressed', mode === 'rotate' ? 'true' : 'false');
    chrome.scaleButton.setAttribute('aria-pressed', mode === 'scale' ? 'true' : 'false');
  };

  const cycleSelection = (delta: number): void => {
    if (state.placements.length === 0) return;
    const index = state.placements.findIndex((item) => item.id === state.selectedPlacement);
    const next =
      (((index === -1 ? 0 : index + delta) % state.placements.length) +
        state.placements.length) %
      state.placements.length;
    selectPlacement(state.placements[next].id);
  };

  const stepNode = (delta: number): void => {
    if (state.nodes.length === 0) return;
    if (!dialogs.some((handle) => handle.name === 'Trigger graph')) {
      openGraph(chrome.graphButton);
    }
    const index = state.nodes.findIndex((node) => node.id === state.selectedNode);
    const next =
      (((index === -1 ? 0 : index + delta) % state.nodes.length) + state.nodes.length) %
      state.nodes.length;
    selectNode(state.nodes[next].id);
  };

  /* ------------------------------------------------------------- sheets */

  const openPalette = (opener: HTMLElement | null): void => {
    openDialog('Command palette', (body) => commandPalette(body), opener, 'palette');
  };

  const openGraph = (opener: HTMLElement | null): void => {
    const already = dialogs.find((handle) => handle.name === 'Trigger graph');
    if (already) return;
    openDialog('Trigger graph', (body) => triggerGraphSheet(body), opener, 'side');
  };

  const openLibrary = (opener: HTMLElement | null, focusFile: boolean): void => {
    openDialog('Prop library', (body) => propLibrarySheet(body, focusFile), opener);
  };

  const openVersions = (opener: HTMLElement | null, focusLabel: boolean): void => {
    openDialog('Versions', (body) => versionsSheet(body, focusLabel), opener);
  };

  const openPlaytests = (opener: HTMLElement | null): void => {
    openDialog('Playtests', (body) => playtestsSheet(body), opener);
  };

  const openShortcuts = (opener: HTMLElement | null): void => {
    openDialog('Keyboard shortcuts', (body) => shortcutsSheet(body), opener);
  };

  const openNewRoom = (opener: HTMLElement | null): void => {
    openDialog('New room', (body) => newRoomSheet(body), opener, 'small');
  };

  /* ------------------------------------------------------------- wiring */

  chrome.roomsButton.addEventListener('click', () => openPicker(chrome.roomsButton));
  chrome.copyCode.addEventListener('click', () => {
    if (!state.room) return;
    void navigator.clipboard
      ?.writeText(state.room.id.slice(0, 6).toUpperCase())
      .catch(() => undefined);
    announce(copy.linkCopied);
  });
  chrome.inviteEmail.addEventListener('input', () => paintSession());
  chrome.inviteButton.addEventListener('click', () => {
    const target = targetSession();
    if (!target) return;
    const address = chrome.inviteEmail.value;
    void request<{ invite: { email: string; emailStatus: string } }>(
      'POST',
      `/api/playtests/${target.id}/invites`,
      { body: { email: address } },
    )
      .then((answer) => {
        const status = answer.invite.emailStatus;
        announce(
          status === 'sent'
            ? copy.inviteSent(answer.invite.email)
            : status === 'queued'
              ? copy.inviteQueued(answer.invite.email)
              : copy.inviteFailed(answer.invite.email),
        );
        chrome.inviteEmail.value = '';
        paintSession();
      })
      .catch((error: unknown) => {
        announce(firstFieldMessage(error) ?? copy.inviteFailed(address));
      });
  });
  chrome.playtestsButton.addEventListener('click', () => openPlaytests(chrome.playtestsButton));
  chrome.sessionMenuButton.addEventListener('click', () => {
    const open = chrome.sessionMenu.hidden;
    chrome.sessionMenu.hidden = !open;
    chrome.sessionMenuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) return;
    clear(chrome.sessionMenu);
    const entries: [string, () => void][] = [
      ['Freeze version', () => openVersions(null, true)],
      ['Versions', () => openVersions(null, false)],
      ['Prop library', () => openLibrary(null, false)],
      ['Keyboard shortcuts', () => openShortcuts(null)],
      [
        'Sign out',
        () => {
          void request<void>('POST', '/api/auth/logout').then(() => go('/'));
        },
      ],
    ];
    for (const [label, run] of entries) {
      const item = button(label, { role: 'menuitem' });
      item.textContent = label;
      item.addEventListener('click', () => {
        chrome.sessionMenu.hidden = true;
        chrome.sessionMenuButton.setAttribute('aria-expanded', 'false');
        run();
      });
      chrome.sessionMenu.append(item);
    }
    const first = chrome.sessionMenu.querySelector<HTMLElement>('button');
    first?.focus();
  });
  chrome.presenceButton.addEventListener('click', () => {
    announce(state.presence.map((member) => member.displayName).join(', '));
  });
  chrome.accountButton.addEventListener('click', () => {
    announce(state.me === null ? '' : `${state.me.displayName} — ${state.me.email}`);
  });
  chrome.moveButton.addEventListener('click', () => setMode('move'));
  chrome.rotateButton.addEventListener('click', () => setMode('rotate'));
  chrome.scaleButton.addEventListener('click', () => setMode('scale'));
  chrome.playButton.addEventListener('click', () => startStop());
  chrome.graphButton.addEventListener('click', () => openGraph(chrome.graphButton));
  chrome.libraryButton.addEventListener('click', () => openLibrary(chrome.libraryButton, false));
  chrome.nextNodeButton.addEventListener('click', () => stepNode(1));
  chrome.uploadProp.addEventListener('click', () => openLibrary(chrome.uploadProp, true));
  chrome.addPrimitive.addEventListener('click', () => {
    const open = chrome.primitiveMenu.hidden;
    chrome.primitiveMenu.hidden = !open;
    if (!open) return;
    clear(chrome.primitiveMenu);
    for (const kind of ['Door', 'Box', 'Cylinder'] as const) {
      const item = button(kind, { role: 'menuitem' });
      item.textContent = kind;
      item.addEventListener('click', () => {
        chrome.primitiveMenu.hidden = true;
        void addPrimitive(kind.toLowerCase() as 'door' | 'box' | 'cylinder');
      });
      chrome.primitiveMenu.append(item);
    }
    chrome.primitiveMenu.querySelector<HTMLElement>('button')?.focus();
  });
  const sceneMenuItem = button('Scene', { role: 'menuitem' });
  sceneMenuItem.textContent = 'Scene';
  sceneMenuItem.addEventListener('click', () => {
    chrome.toolsMenu.hidden = true;
    openDialog(
      'Scene',
      (body) => {
        body.append(chrome.scenePanel);
        chrome.scenePanel.style.display = 'block';
      },
      chrome.toolsButton,
    );
  });
  chrome.toolsMenu.append(sceneMenuItem);
  chrome.toolsButton.addEventListener('click', () => {
    chrome.toolsMenu.hidden = !chrome.toolsMenu.hidden;
  });
  chrome.cueTimelineButton.addEventListener('click', () => {
    chrome.cueTimeline.hidden = !chrome.cueTimeline.hidden;
    paintCueTimeline();
  });
  chrome.unitsButton.addEventListener('click', () => {
    const next = editorUnits() === 'ft' ? 'm' : 'ft';
    setEditorUnits(next);
    chrome.unitsButton.textContent = next;
    chrome.unitsButton.setAttribute('aria-pressed', next === 'ft' ? 'true' : 'false');
    paintInspector();
  });
  chrome.rotation.addEventListener('change', () => {
    const placement = selected();
    if (!placement) return;
    const holder = state.holders.get(`placement:${placement.id}`);
    const value = Number(chrome.rotation.value);
    if (!Number.isInteger(value)) return;
    if (holder !== undefined) {
      const handle = openDialog(
        'Prop locked',
        (body) =>
          propLockedSheet(
            body,
            holder,
            placement.label,
            () => {
              chrome.rotation.value = String(placement.rotationDeg);
              closeDialog();
              chrome.rotation.focus();
            },
            () => {
              void takeLock('placement', placement.id, true).then((taken) => {
                closeDialog();
                if (!taken) return;
                state.holders.delete(`placement:${placement.id}`);
                announce(copy.tookOver(placement.label));
                commit(placement, { rotationDeg: value });
              });
            },
          ),
        chrome.rotation,
      );
      handle.onClose = (): void => {
        chrome.rotation.value = String(placement.rotationDeg);
      };
      return;
    }
    commit(placement, { rotationDeg: value });
  });

  const addPrimitive = async (kind: 'door' | 'box' | 'cylinder'): Promise<void> => {
    if (!state.room) return;
    const label = kind === 'door' ? 'Door' : kind === 'box' ? 'Box' : 'Cylinder';
    try {
      await request<{ placement: Placement }>(
        'POST',
        `/api/rooms/${state.room.id}/placements`,
        {
          body: {
            kind,
            label,
            xMm: Math.round(state.room.widthMm / 2),
            yMm: 0,
            zMm: Math.round(state.room.depthMm / 2),
            rotationDeg: 0,
            widthMm: 600,
            depthMm: 600,
            heightMm: 900,
          },
        },
      );
      await reloadRoom();
      scheduleThumbnail();
    } catch (error) {
      announce(firstFieldMessage(error) ?? copy.playtestRunning);
    }
  };

  stage.onPick = (placementId) => selectPlacement(placementId);

  /** A drag draws at once and saves once, when the drag finishes. */
  let dragOrigin: Placement | null = null;
  let dragDraft: Placement | null = null;

  stage.onDragPlacement = (placementId, dx, dy) => {
    const room = state.room;
    if (!room) return;
    if (dragOrigin === null || dragOrigin.id !== placementId) {
      dragOrigin = state.placements.find((item) => item.id === placementId) ?? null;
      dragDraft = dragOrigin;
    }
    if (dragOrigin === null || dragDraft === null) return;
    const hold = (value: number, low: number, high: number): number =>
      Math.min(Math.max(Math.round(value), low), high);
    let next: Placement = dragDraft;
    if (state.mode === 'move') {
      next = {
        ...dragDraft,
        xMm: hold(dragDraft.xMm + dx * 10, 0, room.widthMm),
        zMm: hold(dragDraft.zMm - dy * 10, 0, room.depthMm),
      };
    } else if (state.mode === 'rotate') {
      next = {
        ...dragDraft,
        rotationDeg: ((Math.round(dragDraft.rotationDeg + dx) % 360) + 360) % 360,
      };
    } else {
      next = {
        ...dragDraft,
        widthMm: hold(dragDraft.widthMm + dx * 10, 10, room.widthMm),
        heightMm: hold(dragDraft.heightMm - dy * 10, 10, room.heightMm),
      };
    }
    dragDraft = next;
    applyLocal(next);
  };

  stage.onDragEnd = () => {
    const origin = dragOrigin;
    const draft = dragDraft;
    dragOrigin = null;
    dragDraft = null;
    if (origin === null || draft === null) return;
    const patch: Partial<Placement> = {};
    const fields: (keyof Placement)[] = [
      'xMm',
      'zMm',
      'yMm',
      'rotationDeg',
      'widthMm',
      'depthMm',
      'heightMm',
    ];
    for (const field of fields) {
      if (draft[field] !== origin[field]) {
        (patch as Record<string, unknown>)[field] = draft[field];
      }
    }
    if (Object.keys(patch).length === 0) return;
    commit(origin, patch);
  };

  window.addEventListener('keydown', onKey);

  /* ------------------------------------------------------------- hooks */

  hooks.announce = announce;
  hooks.paint = paint;
  hooks.reloadRoom = reloadRoom;
  hooks.reloadRooms = loadRooms;
  hooks.closeDialog = closeDialog;
  hooks.openGraph = openGraph;
  hooks.openLibrary = openLibrary;
  hooks.openVersions = openVersions;
  hooks.openShortcuts = openShortcuts;
  hooks.openNewRoom = openNewRoom;
  hooks.selectNode = selectNode;
  hooks.openRoom = openRoom;
  hooks.startStop = startStop;

  /* ------------------------------------------------------------- boot */

  void (async (): Promise<void> => {
    try {
      const me = await request<{ user: SessionUser; workspace: Workspace }>('GET', '/api/me');
      state.me = me.user;
      state.workspace = me.workspace;
    } catch {
      go('/signin');
      return;
    }
    await loadRooms();
    paint();
    if (roomIdFromPath !== null && state.rooms.some((room) => room.id === roomIdFromPath)) {
      await openRoom(roomIdFromPath, false);
    }
    openPicker(null);
    void checkHealth();
    window.setInterval(() => void checkHealth(), 5000);
    // The clock counts down locally but resyncs with the server's figure.
    window.setInterval(() => {
      const running = state.sessions.find(
        (item) => item.state === 'running' && item.roomId === state.room?.id,
      );
      if (!running) return;
      void request<{ session: PlaytestSession }>('GET', `/api/playtests/${running.id}`)
        .then((answer) => {
          state.sessions = [
            answer.session,
            ...state.sessions.filter((item) => item.id !== answer.session.id),
          ];
          paintSession();
        })
        .catch(() => undefined);
    }, 10_000);
  })();

  async function checkHealth(): Promise<void> {
    try {
      const health = await request<{
        services: { valkey: string; minio: string };
      }>('GET', '/api/health');
      state.liveAvailable = health.services.valkey === 'up';
      state.storageAvailable = health.services.minio === 'up';
      paintBanners();
    } catch {
      /* health is the only source of the banners */
    }
  }
}
