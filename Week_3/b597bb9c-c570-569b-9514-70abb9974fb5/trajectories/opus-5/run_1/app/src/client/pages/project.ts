/** The project page: the editor at 1100 px and up, the review layouts below it. */
import { ApiCallError, get, newOpId, post } from '../api.js';
import { clear, el, find, findAll, prefersReducedMotion } from '../dom.js';
import { announce, activityRegion, bandLinks, loadAllowance, loadStatus, mount, notice, noticesStrip, renderOutages, setAllowance, shared } from '../shell.js';
import { renderStage } from '../stage.js';
import { loadMediaIndex, type ProjectDetail } from '../sheet.js';
import {
  applyChanges,
  clipById,
  DEFAULT_ZOOM,
  freshLoupe,
  lastFrame,
  lockedRows,
  PX_PER_FRAME,
  rateOf,
  sendOp,
  stamp,
  timelineOrder,
  totalFrames,
  type PageState,
  type Panel,
} from './project-state.js';
import {
  blockLeft,
  centreOnPlayhead,
  firstClip,
  frameAtOffset,
  lastClip,
  pixelsPerFrame,
  groupOutline,
  renderLoupe,
  renderTimeline,
  snapFrame,
} from './project-timeline.js';
import { applyKit, renderClipsList, renderComments, renderExports, renderInspector, renderScrubber } from './project-panels.js';
import {
  captionsDialog,
  compareDialog,
  exportDialog,
  frameSizeDialog,
  membersDialog,
  nameCutDialog,
  shareDialog,
} from './project-dialogs.js';
import { exactRate } from '../../domain/rate.js';
import { FRAME_SIZES, type AllowanceRecord, type CommentRecord, type CutRecord, type ExportRecord, type KitRecord, type OpChanges, type Person, type ProjectRecord, type Role } from '../../shared/types.js';

function layoutFor(width: number): PageState['layout'] {
  if (width < 700) return 'review-list';
  return width < 1100 ? 'two-pane' : 'editor';
}

function readAddress(): { frame: number | null; zoom: number | null; clip: string | null; panel: Panel } {
  const params = new URLSearchParams(window.location.search);
  const whole = (name: string): number | null => {
    const raw = params.get(name);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : null;
  };
  const panel = params.get('panel');
  return {
    frame: whole('frame'),
    zoom: whole('zoom'),
    clip: params.get('clip'),
    panel: panel === 'inspector' || panel === 'comments' || panel === 'exports' ? panel : 'none',
  };
}

function writeAddress(state: PageState, replace: boolean): void {
  const params = new URLSearchParams();
  params.set('frame', String(state.playhead));
  params.set('zoom', String(state.zoom));
  if (state.currentClipId !== null) params.set('clip', state.currentClipId);
  params.set('panel', state.panel);
  const url = `${window.location.pathname}?${params.toString()}`;
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
}

export async function renderProject(projectId: string): Promise<void> {
  await Promise.all([loadAllowance(), loadStatus()]);
  const detail = await get<ProjectDetail & { members: { person: Person; role: Role }[] }>(`/api/projects/${projectId}`);
  shared.projects = [detail.project];
  const canLibrary = detail.project.role === 'owner' || detail.project.role === 'editor';
  const [media, comments, cuts, exports, kits] = await Promise.all([
    loadMediaIndex(canLibrary),
    get<{ items: CommentRecord[] }>(`/api/projects/${projectId}/comments`).catch(() => ({ items: [] })),
    get<{ items: CutRecord[] }>(`/api/projects/${projectId}/cuts`).catch(() => ({ items: [] })),
    get<{ items: ExportRecord[] }>(`/api/projects/${projectId}/exports`).catch(() => ({ items: [] })),
    canLibrary ? get<{ items: KitRecord[] }>('/api/kits').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
  ]);

  const address = readAddress();
  const state: PageState = {
    projectId,
    detail,
    media,
    comments: comments.items,
    cuts: cuts.items,
    exports: exports.items,
    kits: kits.items,
    members: detail.members,
    version: detail.project.version,
    playhead: 0,
    zoom: address.zoom !== null && address.zoom <= 5 ? address.zoom : DEFAULT_ZOOM,
    firstFrame: 0,
    visibleFrames: 1,
    currentClipId: null,
    selection: new Set(),
    panel: address.panel,
    layout: layoutFor(window.innerWidth),
    loupe: freshLoupe(),
    stageMode: 'playhead',
    stageFrame: 0,
    stageGuide: null,
    playing: false,
    playFrom: 0,
    playStartedAt: 0,
    rangeIn: null,
    rangeOut: null,
    remotePlayheads: new Map(),
    winners: new Map(),
    replyTo: null,
    noteVisibility: 'team',
    noteBody: '',
    scrubberFrame: 0,
  };
  state.playhead = Math.min(address.frame ?? 0, lastFrame(state));
  state.stageFrame = state.playhead;
  state.scrubberFrame = state.playhead;
  if (address.clip !== null && clipById(state, address.clip) !== undefined) state.currentClipId = address.clip;

  try {
    const draft = await get<{ draft: { body: string; visibility: string } | null }>(
      `/api/projects/${projectId}/comment-draft`,
    );
    if (draft.draft !== null) {
      state.noteBody = draft.draft.body;
      state.noteVisibility = draft.draft.visibility === 'review' ? 'review' : 'team';
    }
  } catch {
    /* a missing draft leaves the note box empty */
  }

  let redraw = (): void => undefined;

  const band = (): HTMLElement => {
    const role = state.detail.project.role;
    const owner = role === 'owner';
    const editor = owner || role === 'editor';
    const button = (label: string, key: string, gold = false): HTMLElement =>
      el('button', { type: 'button', class: gold ? 'primary' : '', 'data-band': key, text: label });
    return el('header', { class: 'band project-band' }, [
      el('div', { class: 'band-grid' }, [
        el('p', { class: 'brand', text: 'Gatecut' }),
        el('p', { text: state.detail.project.title }),
        el('p', { class: 'muted tabular', text: state.detail.project.frame_rate }),
        el('p', { class: 'muted', text: state.detail.project.aspect_ratio }),
        el('p', {
          class: 'tabular playhead-stamp',
          'data-playhead-timecode': stamp(state, state.playhead),
          text: stamp(state, state.playhead),
        }),
        el('div', { class: 'band-actions' }, [
          owner ? button('Export', 'export', true) : null,
          owner ? button('Name cut', 'name-cut') : null,
          owner ? button('Share', 'share') : null,
          button('Compare cuts', 'compare'),
          editor ? button('Captions', 'captions') : null,
          owner ? button('Members', 'members') : null,
          owner ? button('Frame size', 'frame-size') : null,
          editor ? button('Undo', 'undo') : null,
          editor ? button('Redo', 'redo') : null,
        ]),
        bandLinks(),
      ]),
      el('p', { class: 'band-allowance', 'data-allowance': '', text: shared.allowance?.text ?? '' }),
    ]);
  };

  const stageNode = (): HTMLElement =>
    renderStage(state.detail, state.media, {
      mode: state.stageMode,
      frame: state.stageFrame,
      interactive: state.layout === 'editor' && state.stageMode === 'playhead' && canEdit(),
      lockedRows: lockedRows(state),
      guide: state.stageGuide,
    });

  const body = (): HTMLElement => {
    const main = el('main', { class: 'project', 'data-layout': state.layout });
    if (state.layout === 'editor') {
      main.append(
        el('div', { class: 'stage-column' }, [stageNode()]),
        el('div', { class: 'inspector-column' }, [renderInspector(state)]),
        el('div', { class: 'comments-column' }, [renderComments(state, redraw)]),
        el('div', { class: 'timeline-column' }, [renderTimeline(state), renderExports(state, redraw)]),
      );
      return main;
    }
    main.append(
      el('div', { class: 'review-left' }, [stageNode(), renderScrubber(state, redraw), renderClipsList(state, redraw)]),
      el('div', { class: 'review-right' }, [renderComments(state, redraw)]),
      el('div', { class: 'fixed-bar' }, [
        el('button', { type: 'button', class: 'primary', 'data-band': 'pin-note', text: 'Pin note' }),
        state.detail.project.role === 'owner' || state.detail.project.role === 'commenter'
          ? el('button', { type: 'button', 'data-band': 'approve', text: 'Approve cut' })
          : null,
      ]),
    );
    return main;
  };

  const measure = (): void => {
    const canvas = find<HTMLElement>('[data-timeline-canvas]');
    if (canvas === null) return;
    const visible = Math.floor(canvas.clientWidth / pixelsPerFrame(state));
    if (visible !== state.visibleFrames && visible > 0) {
      state.visibleFrames = visible;
      canvas.dataset.visibleFrames = String(visible);
    }
  };

  redraw = (): void => {
    const dialogOpen = find<HTMLElement>('.dialog-backdrop') !== null;
    const active = document.activeElement as HTMLElement | null;
    const focusedClip = dialogOpen ? null : (active?.dataset?.clipId ?? null);
    const focusedBand = dialogOpen ? null : (active?.dataset?.band ?? null);
    mount(band(), noticesStrip(), activityRegion(), body());
    renderOutages();
    measure();
    wire();
    if (focusedClip !== null) find<HTMLElement>(`[data-clip-id="${focusedClip}"]`)?.focus();
    else if (focusedBand !== null) find<HTMLElement>(`[data-band="${focusedBand}"]`)?.focus();
    drawLoupe();
  };

  const drawLoupe = (): void => {
    for (const old of findAll<HTMLElement>('[data-loupe]')) old.remove();
    const loupe = renderLoupe(state);
    if (loupe !== null) document.body.append(loupe);
  };

  const refreshStage = (): void => {
    const host = find<HTMLElement>('.stage')?.parentElement ?? null;
    if (host === null) return;
    clear(host);
    host.append(stageNode());
    wireStage();
  };

  const refreshOutline = (): void => {
    for (const old of findAll<HTMLElement>('[data-group-outline]')) old.remove();
    const inner = find<HTMLElement>('.canvas-inner');
    const outline = groupOutline(state);
    if (inner !== null && outline !== null) inner.append(outline);
  };

  const refreshSnapGuide = (): void => {
    for (const old of findAll<HTMLElement>('.canvas-guide')) old.remove();
    const inner = find<HTMLElement>('.canvas-inner');
    if (inner === null || !state.loupe.visible || !state.loupe.snapped) return;
    inner.append(
      el('div', {
        class: 'snap-guide canvas-guide',
        'data-snap-guide': '',
        style: `left:${blockLeft(state, state.loupe.frame)}px`,
      }),
    );
  };

  const focusClip = (clipId: string | null, push = true): void => {
    state.currentClipId = clipId;
    writeAddress(state, !push);
    redraw();
    if (clipId !== null) find<HTMLElement>(`[data-clip-id="${clipId}"]`)?.focus();
  };

  const movePlayhead = (frame: number): void => {
    state.playhead = Math.max(0, Math.min(frame, lastFrame(state)));
    if (state.stageMode === 'playhead') state.stageFrame = state.playhead;
    writeAddress(state, true);
    redraw();
  };

  const zoomTo = (level: number): void => {
    const next = Math.max(0, Math.min(5, level));
    if (next === state.zoom) return;
    state.zoom = next;
    measure();
    const canvas = find<HTMLElement>('[data-timeline-canvas]');
    if (canvas !== null) state.visibleFrames = Math.floor(canvas.clientWidth / PX_PER_FRAME[next]) || state.visibleFrames;
    centreOnPlayhead(state);
    writeAddress(state, false);
    redraw();
  };

  const openPanel = (panel: Panel): void => {
    state.panel = panel;
    writeAddress(state, false);
    redraw();
  };

  const nudge = (frames: number): void => {
    const clip = clipById(state, state.currentClipId);
    if (clip === undefined) return;
    void sendOp(state, { type: 'move', clip_id: clip.id, start_frame: Math.max(0, clip.start_frame + frames), row_id: clip.row_id }, redraw);
  };

  const neighbourRow = (direction: -1 | 1): void => {
    const clip = clipById(state, state.currentClipId);
    if (clip === undefined) return;
    const rows = [...state.detail.rows].sort((a, b) => a.position - b.position);
    const at = rows.findIndex((row) => row.id === clip.row_id);
    const target = rows[at + direction];
    if (target === undefined) return;
    const candidates = state.detail.clips.filter((candidate) => candidate.row_id === target.id);
    if (candidates.length === 0) return;
    const nearest = candidates.reduce((best, candidate) =>
      Math.abs(candidate.start_frame - clip.start_frame) < Math.abs(best.start_frame - clip.start_frame) ? candidate : best,
    );
    focusClip(nearest.id);
  };

  const canEdit = (): boolean => state.detail.project.role === 'owner' || state.detail.project.role === 'editor';

  const onKey = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select') !== null) return;
    if (!canEdit() && !['Home', 'End', ',', '.', '+', '=', '-', '_', ' ', 'l', 'L'].includes(event.key)) return;
    const clip = clipById(state, state.currentClipId);
    const second = exactRate(state.detail.project.frame_rate).nominal;
    const control = event.metaKey || event.ctrlKey;
    if (state.loupe.pinned) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const step = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? second : 1);
        state.loupe.frame = Math.max(0, Math.min(lastFrame(state), state.loupe.frame + step));
        state.stageFrame = state.loupe.frame;
        redraw();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        movePlayhead(state.loupe.frame);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        const back = state.loupe.returnTo;
        state.loupe = freshLoupe();
        state.stageMode = 'playhead';
        state.stageFrame = state.playhead;
        redraw();
        if (back !== null) find<HTMLElement>(`[data-clip-id="${back}"]`)?.focus();
        else find<HTMLElement>('[data-timeline-canvas]')?.focus();
        return;
      }
    }
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        event.preventDefault();
        nudge((event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? second : 1));
        return;
      }
      case 'ArrowUp':
        event.preventDefault();
        neighbourRow(-1);
        return;
      case 'ArrowDown':
        event.preventDefault();
        neighbourRow(1);
        return;
      case 'Home': {
        event.preventDefault();
        state.playhead = 0;
        state.stageFrame = 0;
        state.firstFrame = 0;
        focusClip(firstClip(state), false);
        return;
      }
      case 'End': {
        event.preventDefault();
        state.playhead = lastFrame(state);
        state.stageFrame = state.playhead;
        state.firstFrame = Math.max(0, totalFrames(state) - state.visibleFrames);
        focusClip(lastClip(state), false);
        return;
      }
      case ',':
        event.preventDefault();
        movePlayhead(state.playhead - 1);
        return;
      case '.':
        event.preventDefault();
        movePlayhead(state.playhead + 1);
        return;
      case '+':
      case '=':
        event.preventDefault();
        zoomTo(state.zoom + 1);
        return;
      case '-':
      case '_':
        event.preventDefault();
        zoomTo(state.zoom - 1);
        return;
      case ' ':
        event.preventDefault();
        togglePlay();
        return;
      case 'Enter':
        if (clip !== undefined) {
          event.preventDefault();
          if (state.selection.has(clip.id)) state.selection.delete(clip.id);
          else state.selection.add(clip.id);
          redraw();
          find<HTMLElement>(`[data-clip-id="${clip.id}"]`)?.focus();
        }
        return;
      case 'Delete':
      case 'Backspace': {
        if (clip === undefined) return;
        event.preventDefault();
        const row = state.detail.clips
          .filter((candidate) => candidate.row_id === clip.row_id)
          .sort((a, b) => a.start_frame - b.start_frame);
        const at = row.findIndex((candidate) => candidate.id === clip.id);
        const next = row[at + 1] ?? row[at - 1] ?? null;
        void sendOp(state, { type: 'remove', clip_id: clip.id, ripple: event.shiftKey }, redraw).then((result) => {
          if (result !== null) focusClip(next === null ? null : next.id, false);
        });
        return;
      }
      default:
        break;
    }
    const key = event.key.toLowerCase();
    if (key === 's' && clip !== undefined && !control) {
      event.preventDefault();
      void sendOp(state, { type: 'split', clip_id: clip.id, at_frame: state.playhead }, redraw).then(() => {
        announceOwn(`split ${clip.name}`);
        focusClip(clip.id, false);
      });
      return;
    }
    if (key === 'h' && clip !== undefined) {
      event.preventDefault();
      void sendOp(state, { type: 'set_hidden', clip_id: clip.id, hidden: !clip.hidden }, redraw);
      return;
    }
    if (key === 'g' && control && clip !== undefined) {
      event.preventDefault();
      if (event.shiftKey) {
        if (clip.group_id !== null) void sendOp(state, { type: 'ungroup', group_id: clip.group_id }, redraw);
        return;
      }
      const ids = [...new Set([clip.id, ...state.selection])];
      if (ids.length >= 2) void sendOp(state, { type: 'group', clip_ids: ids }, redraw);
      return;
    }
    if (key === 'z' && control) {
      event.preventDefault();
      void undoRedo(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (key === 'm') {
      event.preventDefault();
      void sendOp(state, { type: 'add_marker', frame: state.playhead, label: '' }, redraw);
      return;
    }
    if (key === 'i') {
      event.preventDefault();
      state.rangeIn = state.playhead;
      if (state.rangeOut === state.playhead) {
        state.rangeIn = null;
        state.rangeOut = null;
      }
      return;
    }
    if (key === 'o') {
      event.preventDefault();
      if (state.rangeIn === state.playhead) {
        state.rangeIn = null;
        state.rangeOut = null;
        return;
      }
      state.rangeOut = state.playhead;
      return;
    }
    if (key === 'l') {
      event.preventDefault();
      state.loupe = {
        visible: true,
        pinned: true,
        frame: state.playhead,
        snapped: false,
        x: 0,
        y: 0,
        returnTo: state.currentClipId,
      };
      state.stageMode = 'skim';
      state.stageFrame = state.playhead;
      redraw();
      return;
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && clip !== undefined) {
      event.preventDefault();
      const row = state.detail.rows.find((candidate) => candidate.id === clip.row_id);
      if (row === undefined) return;
      void sendOp(
        state,
        { type: 'reorder_row', row_id: row.id, position: row.position + (event.key === 'ArrowUp' ? -1 : 1) },
        redraw,
      );
    }
  };

  const announceOwn = (what: string): void => {
    void what;
  };

  const undoRedo = async (mode: 'undo' | 'redo'): Promise<void> => {
    try {
      const result = await post<{ version: number; changes: OpChanges; removed: string[] }>(
        `/api/projects/${projectId}/${mode}`,
        { op_id: newOpId() },
      );
      state.version = result.version;
      applyChanges(state, result.changes, result.removed);
      const refreshed = await get<ProjectDetail>(`/api/projects/${projectId}`);
      state.detail = { ...refreshed, members: state.detail.members };
      state.version = refreshed.project.version;
      redraw();
    } catch (error) {
      if (error instanceof ApiCallError) notice(error.failure.message);
    }
  };

  let playTimer = 0;
  const togglePlay = (): void => {
    if (state.playing) {
      state.playing = false;
      window.clearInterval(playTimer);
      return;
    }
    state.playing = true;
    state.playFrom = state.playhead;
    state.playStartedAt = performance.now();
    const rate = exactRate(state.detail.project.frame_rate);
    playTimer = window.setInterval(() => {
      const elapsed = (performance.now() - state.playStartedAt) / 1000;
      let frame = state.playFrom + Math.floor((elapsed * Number(rate.num)) / Number(rate.den));
      if (state.rangeIn !== null && state.rangeOut !== null && frame >= state.rangeOut) {
        state.playFrom = state.rangeIn;
        state.playStartedAt = performance.now();
        frame = state.rangeIn;
      }
      if (frame >= lastFrame(state)) {
        frame = lastFrame(state);
        state.playing = false;
        window.clearInterval(playTimer);
      }
      state.playhead = frame;
      state.stageFrame = frame;
      const stamped = find<HTMLElement>('[data-playhead-timecode]');
      if (stamped !== null) {
        stamped.dataset.playheadTimecode = stamp(state, frame);
        stamped.textContent = stamp(state, frame);
      }
      const playhead = find<HTMLElement>('[data-playhead-frame]');
      if (playhead !== null) {
        playhead.dataset.playheadFrame = String(frame);
        playhead.style.left = `${blockLeft(state, frame)}px`;
      }
      const stage = find<HTMLElement>('.stage');
      if (stage !== null) {
        const host = stage.parentElement;
        if (host !== null) {
          clear(host);
          host.append(stageNode());
        }
      }
    }, 1000 / 30);
  };

  const wire = (): void => {
    const timeline = find<HTMLElement>('.timeline');
    timeline?.addEventListener('keydown', onKey);
    find<HTMLElement>('[data-zoom-in]')?.addEventListener('click', () => zoomTo(state.zoom + 1));
    find<HTMLElement>('[data-zoom-out]')?.addEventListener('click', () => zoomTo(state.zoom - 1));
    for (const clipButton of findAll<HTMLElement>('[data-clip-id]')) {
      clipButton.addEventListener('focus', () => {
        if (state.currentClipId !== clipButton.dataset.clipId) {
          state.currentClipId = clipButton.dataset.clipId ?? null;
          writeAddress(state, false);
          const host = find<HTMLElement>('.inspector')?.parentElement ?? null;
          if (host !== null) {
            clear(host);
            host.append(renderInspector(state));
          }
          refreshOutline();
        }
      });
      clipButton.addEventListener('click', (event) => {
        if (event.metaKey || event.ctrlKey) {
          const id = clipButton.dataset.clipId ?? '';
          if (state.selection.has(id)) state.selection.delete(id);
          else state.selection.add(id);
          redraw();
        }
      });
    }
    const canvas = find<HTMLElement>('[data-timeline-canvas]');
    if (canvas !== null) wireCanvas(canvas);
    wireStage();
    for (const button of findAll<HTMLElement>('[data-band]')) {
      button.addEventListener('click', () => {
        switch (button.dataset.band) {
          case 'export':
            exportDialog(state, redraw, button);
            return;
          case 'name-cut':
            nameCutDialog(state, redraw, button);
            return;
          case 'share':
            shareDialog(state, redraw, button);
            return;
          case 'compare':
            compareDialog(state, redraw, button);
            return;
          case 'captions':
            captionsDialog(state, redraw, button);
            return;
          case 'members':
            membersDialog(state, redraw, button);
            return;
          case 'frame-size':
            frameSizeDialog(state, redraw, button);
            return;
          case 'undo':
            void undoRedo('undo');
            return;
          case 'redo':
            void undoRedo('redo');
            return;
          case 'pin-note':
            find<HTMLElement>('[data-pin-note]')?.click();
            return;
          case 'approve':
            find<HTMLElement>('[data-approve-cut]')?.click();
            return;
          default:
            return;
        }
      });
    }
    find<HTMLElement>('[data-apply-kit]')?.addEventListener('click', () => {
      const select = find<HTMLSelectElement>('[data-kit-select]');
      if (select !== null && select.value !== '') applyKit(state, redraw, select.value);
    });
  };

  const wireCanvas = (canvas: HTMLElement): void => {
    const skim = (event: PointerEvent): void => {
      if (state.loupe.pinned) return;
      const rect = canvas.getBoundingClientRect();
      const frame = frameAtOffset(state, event.clientX - rect.left + canvas.scrollLeft);
      const snapped = snapFrame(state, frame);
      state.loupe = {
        visible: true,
        pinned: false,
        frame: snapped.frame,
        snapped: snapped.snapped,
        x: Math.max(0, Math.min(window.innerWidth - 360, event.clientX - 180)),
        y: Math.max(0, event.clientY - 96 - 16),
        returnTo: state.currentClipId,
      };
      state.stageMode = 'skim';
      state.stageFrame = snapped.frame;
      drawLoupe();
      refreshStage();
      refreshSnapGuide();
    };
    canvas.addEventListener('pointerenter', skim);
    canvas.addEventListener('pointermove', skim);
    canvas.addEventListener('pointerleave', () => {
      if (state.loupe.pinned) return;
      state.loupe = freshLoupe();
      state.stageMode = 'playhead';
      state.stageFrame = state.playhead;
      drawLoupe();
      refreshStage();
      refreshSnapGuide();
    });
    canvas.addEventListener('pointerdown', (event) => {
      const onClip = (event.target as HTMLElement).closest<HTMLElement>('[data-clip-id]');
      const rect = canvas.getBoundingClientRect();
      const frame = frameAtOffset(state, event.clientX - rect.left + canvas.scrollLeft);
      if (onClip === null) {
        movePlayhead(frame);
        return;
      }
      dragClip(onClip, event, canvas);
    });
  };

  const dragClip = (block: HTMLElement, start: PointerEvent, canvas: HTMLElement): void => {
    const clipId = block.dataset.clipId ?? '';
    const clip = clipById(state, clipId);
    if (clip === undefined) return;
    const rect = block.getBoundingClientRect();
    const nearStart = start.clientX - rect.left <= 6;
    const nearEnd = rect.right - start.clientX <= 6;
    const startFrame = frameAtOffset(state, start.clientX - canvas.getBoundingClientRect().left + canvas.scrollLeft);
    const finish = (event: PointerEvent): void => {
      window.removeEventListener('pointerup', finish);
      const endFrame = frameAtOffset(state, event.clientX - canvas.getBoundingClientRect().left + canvas.scrollLeft);
      const delta = endFrame - startFrame;
      if (delta === 0) return;
      if (nearStart || nearEnd) {
        void sendOp(
          state,
          { type: 'trim', clip_id: clipId, edge: nearStart ? 'start' : 'end', delta_frames: delta, ripple: false },
          redraw,
        );
        return;
      }
      void sendOp(
        state,
        { type: 'move', clip_id: clipId, start_frame: Math.max(0, clip.start_frame + delta), row_id: clip.row_id },
        redraw,
      );
    };
    window.addEventListener('pointerup', finish);
  };

  const wireStage = (): void => {
    const size = FRAME_SIZES[state.detail.project.aspect_ratio];
    for (const layer of findAll<HTMLElement>('[data-layer-box]')) {
      if (layer.tagName !== 'BUTTON') continue;
      const clipId = layer.dataset.layerBox ?? '';
      layer.addEventListener('focus', () => {
        if (state.currentClipId !== clipId) {
          state.currentClipId = clipId;
          const host = find<HTMLElement>('.inspector')?.parentElement ?? null;
          if (host !== null) {
            clear(host);
            host.append(renderInspector(state));
          }
        }
      });
      layer.addEventListener('keydown', (event) => {
        const clip = clipById(state, clipId);
        if (clip === undefined) return;
        const frame = state.playhead - clip.start_frame;
        const step = event.shiftKey ? 10 : 1;
        const properties: Record<string, number> = {};
        if (event.key === 'ArrowLeft') properties.x = Number(layer.dataset.x) - step;
        else if (event.key === 'ArrowRight') properties.x = Number(layer.dataset.x) + step;
        else if (event.key === 'ArrowUp') properties.y = Number(layer.dataset.y) - step;
        else if (event.key === 'ArrowDown') properties.y = Number(layer.dataset.y) + step;
        else if (event.key === '[') properties.scale = Number(layer.dataset.scale) - (event.shiftKey ? 10 : 1);
        else if (event.key === ']') properties.scale = Number(layer.dataset.scale) + (event.shiftKey ? 10 : 1);
        else if (event.key === 'Escape') {
          event.preventDefault();
          find<HTMLElement>(`[data-clip-id="${clipId}"]`)?.focus();
          return;
        } else return;
        event.preventDefault();
        void sendOp(state, { type: 'set_layer', clip_id: clipId, frame, ...properties }, redraw);
      });
      layer.addEventListener('pointerdown', (event) => {
        const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-handle]');
        const clip = clipById(state, clipId);
        if (clip === undefined) return;
        const stage = find<HTMLElement>('[data-stage-box]');
        if (stage === null) return;
        const scale = stage.clientWidth / size.width;
        const startX = event.clientX;
        const startY = event.clientY;
        const originalX = Number(layer.dataset.x);
        const originalY = Number(layer.dataset.y);
        const originalScale = Number(layer.dataset.scale);
        const box = layer.getBoundingClientRect();
        const centreX = box.left + box.width / 2;
        const centreY = box.top + box.height / 2;
        const startDistance = Math.hypot(startX - centreX, startY - centreY);
        let nextX = originalX;
        let nextY = originalY;
        let nextScale = originalScale;
        const move = (pointer: PointerEvent): void => {
          if (handle !== null) {
            const distance = Math.hypot(pointer.clientX - centreX, pointer.clientY - centreY);
            nextScale = Math.max(1, Math.min(1000, Math.round((originalScale * distance) / Math.max(1, startDistance) * 100) / 100));
            layer.dataset.scale = nextScale.toFixed(2);
            return;
          }
          nextX = Math.round(originalX + (pointer.clientX - startX) / scale);
          nextY = Math.round(originalY + (pointer.clientY - startY) / scale);
          state.stageGuide = null;
          if (Math.abs(nextX - size.width / 2) <= 8) {
            nextX = size.width / 2;
            state.stageGuide = 'centre-x';
          } else if (Math.abs(nextY - size.height / 2) <= 8) {
            nextY = size.height / 2;
            state.stageGuide = 'centre-y';
          } else {
            const width = Number(layer.dataset.width);
            const height = Number(layer.dataset.height);
            if (Math.abs(nextX - width / 2) <= 8) {
              nextX = width / 2;
              state.stageGuide = 'left';
            } else if (Math.abs(size.width - (nextX + width / 2)) <= 8) {
              nextX = size.width - width / 2;
              state.stageGuide = 'right';
            } else if (Math.abs(nextY - height / 2) <= 8) {
              nextY = height / 2;
              state.stageGuide = 'top';
            } else if (Math.abs(size.height - (nextY + height / 2)) <= 8) {
              nextY = size.height - height / 2;
              state.stageGuide = 'bottom';
            }
          }
          layer.dataset.x = nextX.toFixed(2);
          layer.dataset.y = nextY.toFixed(2);
          layer.style.left = `${((nextX - Number(layer.dataset.width) / 2) / size.width) * 100}%`;
          layer.style.top = `${((nextY - Number(layer.dataset.height) / 2) / size.height) * 100}%`;
          const guide = find<HTMLElement>('[data-stage-guide]');
          if (guide !== null) guide.remove();
          if (state.stageGuide !== null) {
            find<HTMLElement>('[data-stage-box]')?.append(
              el('div', { class: `stage-guide guide-${state.stageGuide}`, 'data-stage-guide': state.stageGuide }),
            );
          }
        };
        const up = (): void => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          const clipFrame = state.playhead - clip.start_frame;
          state.stageGuide = null;
          if (handle !== null) {
            if (nextScale !== originalScale) {
              void sendOp(state, { type: 'set_layer', clip_id: clipId, frame: clipFrame, scale: nextScale }, redraw);
            }
            return;
          }
          if (nextX !== originalX || nextY !== originalY) {
            void sendOp(state, { type: 'set_layer', clip_id: clipId, frame: clipFrame, x: nextX, y: nextY }, redraw);
          }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    }
  };

  redraw();
  if (state.panel !== 'none') openPanel(state.panel);
  writeAddress(state, true);
  if (state.currentClipId !== null) find<HTMLElement>(`[data-clip-id="${state.currentClipId}"]`)?.focus();

  window.addEventListener('resize', () => {
    const next = layoutFor(window.innerWidth);
    if (next !== state.layout) {
      state.layout = next;
      redraw();
      return;
    }
    measure();
  });
  window.addEventListener('popstate', () => {
    const back = readAddress();
    state.playhead = Math.min(back.frame ?? 0, lastFrame(state));
    state.zoom = back.zoom !== null && back.zoom <= 5 ? back.zoom : DEFAULT_ZOOM;
    state.panel = back.panel;
    state.currentClipId = back.clip !== null && clipById(state, back.clip) !== undefined ? back.clip : null;
    state.stageFrame = state.playhead;
    centreOnPlayhead(state);
    redraw();
  });
  if (prefersReducedMotion()) document.body.dataset.reducedMotion = 'true';

  openSocket(state, redraw);
}

function openSocket(state: PageState, redraw: () => void): void {
  let attempt = 0;
  const connect = (): void => {
    const socket = new WebSocket(`${window.location.origin.replace(/^http/, 'ws')}/api/live`);
    socket.addEventListener('open', () => {
      attempt = 0;
      socket.send(JSON.stringify({ type: 'subscribe', project_id: state.projectId, after_version: state.version }));
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string) as Record<string, unknown>;
      handleMessage(state, message, redraw);
    });
    socket.addEventListener('close', (event) => {
      if (event.code === 4401) {
        window.location.assign('/sign-in');
        return;
      }
      if (event.code === 4403) {
        notice(`Your role on ${state.detail.project.title} is now changed.`);
        window.setTimeout(() => window.location.reload(), 200);
        return;
      }
      const waits = [1000, 2000, 4000, 8000];
      const wait = waits[Math.min(attempt, waits.length - 1)];
      attempt += 1;
      window.setTimeout(connect, wait);
    });
    let lastSent = 0;
    window.setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (state.playhead === lastSent) return;
      lastSent = state.playhead;
      socket.send(JSON.stringify({ type: 'playhead', frame: state.playhead }));
    }, 250);
  };
  connect();
}

function activityCopy(state: PageState, message: Record<string, unknown>): string | null {
  const author = (message.author as { id: string; name: string } | undefined)?.name ?? '';
  const op = message.op as { type?: string; cut_name?: string; aspect_ratio?: string; clip_id?: string } | undefined;
  const changes = message.changes as OpChanges | undefined;
  const clip = changes?.clips?.[0];
  const name = clip?.name ?? '';
  switch (op?.type) {
    case 'move':
      return `${author} moved ${name} to ${stamp(state, clip?.start_frame ?? 0)}.`;
    case 'trim':
      return `${author} trimmed ${name}.`;
    case 'split':
      return `${author} split ${name} at ${stamp(state, clip?.end_frame ?? 0)}.`;
    case 'remove':
      return `${author} removed ${name}.`;
    case 'set_hidden':
      return clip?.hidden === true ? `${author} hid ${name}.` : `${author} showed ${name}.`;
    case 'set_layer':
      return `${author} shaped ${name}.`;
    case 'restore_cut':
      return `${author} restored ${op.cut_name ?? 'that cut'}.`;
    case 'set_aspect':
      return `${author} changed the frame to ${op.aspect_ratio ?? ''}.`;
    default:
      return `${author} edited the timeline.`;
  }
}

function handleMessage(state: PageState, message: Record<string, unknown>, redraw: () => void): void {
  switch (message.type) {
    case 'op': {
      const version = message.version as number;
      if (version <= state.version) return;
      state.version = version;
      applyChanges(state, message.changes as OpChanges, (message.removed as string[]) ?? []);
      if (message.project !== undefined) state.detail.project = message.project as ProjectRecord;
      const author = message.author as { id: string; name: string };
      redraw();
      if (author.id !== shared.session?.person.id) {
        const copy = activityCopy(state, message);
        if (copy !== null) announce(copy);
      }
      return;
    }
    case 'comment': {
      const comment = message.comment as CommentRecord;
      if (!state.comments.some((candidate) => candidate.id === comment.id)) {
        state.comments = [...state.comments, comment];
        redraw();
        announce(`${comment.author_name} pinned a note at ${stamp(state, comment.pin.live_frame)}.`);
      }
      return;
    }
    case 'export': {
      const record = message.export as ExportRecord;
      const at = state.exports.findIndex((candidate) => candidate.id === record.id);
      if (at >= 0) state.exports[at] = record;
      else state.exports = [record, ...state.exports];
      redraw();
      if (record.state === 'done') announce(`Export of ${record.cut_name} at ${record.size}p is ready.`);
      if (record.state === 'failed') announce(`Export of ${record.cut_name} at ${record.size}p failed.`);
      if (record.state === 'cancelled') announce(`Export of ${record.cut_name} at ${record.size}p was cancelled.`);
      return;
    }
    case 'allowance': {
      const record = message.allowance as AllowanceRecord;
      setAllowance(record);
      announce(`Allowance now: ${record.text}.`);
      return;
    }
    case 'playhead': {
      state.remotePlayheads.set(message.person as string, message.frame as number);
      redraw();
      return;
    }
    case 'cut_shared': {
      const cut = message.cut as CutRecord;
      const at = state.cuts.findIndex((candidate) => candidate.id === cut.id);
      if (at >= 0) state.cuts[at] = cut;
      else state.cuts = [...state.cuts, cut];
      announce(`${cut.name} is now shared for review.`);
      return;
    }
    case 'role_changed': {
      const role = message.role as Role | null;
      if (role === null) {
        notice(`You no longer have access to ${state.detail.project.title}.`);
        mount(el('main', {}, [el('p', { class: 'empty', text: `You no longer have access to ${state.detail.project.title}.` })]));
        return;
      }
      notice(`Your role on ${state.detail.project.title} is now ${role}.`);
      state.detail.project.role = role;
      redraw();
      return;
    }
    default:
      return;
  }
}

export { timelineOrder, rateOf };
