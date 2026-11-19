import { api, refusalText, type ApiFailure } from '../api.js';
import {
  button,
  checkbox,
  clear,
  combobox,
  el,
  field,
  reducedMotion,
  spinbutton,
  trapDialog,
} from '../dom.js';
import { openChannel } from '../live.js';
import { mountRegions } from '../regions.js';
import { go, onLeave } from '../router.js';
import { fitZoom } from '../stagepaint.js';
import { num, person } from '../session.js';
import type { FloodRequest, Workspace } from './context.js';
import { openCommandPalette, openExportDialog } from './dialogs.js';
import {
  applyStrokeEvent,
  loadModel,
  refreshModel,
  sendSelection,
  type Model,
  type StrokeOutcome,
} from './model.js';
import { layersPanel, palettePanel, type Panel } from './panels/palette.js';
import { framesPanel, previewPanel } from './panels/frames.js';
import { tilesPanel } from './panels/tiles.js';
import { activityPanel, commentsPanel, snapshotsPanel } from './panels/review.js';
import { createStage, workspaceHotkey } from './stage.js';

const PHONE = 700;
const DESKTOP = 1100;

interface ProjectBody {
  id: number;
  name: string;
  role: string;
  members: { id: number; name: string; role: string }[];
}

export async function workspacePage(params: string[]): Promise<HTMLElement> {
  if (person() === null) {
    go(`/signin?next=${window.location.pathname}`);
    return el('main', { class: 'column' });
  }
  const projectId = Number(params[0]);
  const spriteId = Number(params[1]);
  const projectResult = await api.get<ProjectBody>(`/api/projects/${projectId}`);
  if (!projectResult.ok) {
    return el('main', { class: 'column' }, [
      el('div', { class: 'card' }, [el('h1', { text: 'That sprite is not here' })]),
    ]);
  }
  const project = projectResult.body;
  const loaded = await loadModel(spriteId, projectId, project.role);
  if (loaded === null) {
    return el('main', { class: 'column' }, [
      el('div', { class: 'card' }, [el('h1', { text: 'That sprite is not here' })]),
    ]);
  }
  return mountWorkspace(project, loaded);
}

async function mountWorkspace(project: ProjectBody, model: Model): Promise<HTMLElement> {
  const projectId = model.projectId;
  const spriteId = model.spriteId;
  const regions = mountRegions();
  const presenceList = el('div', { role: 'list', 'aria-label': 'On this sprite', class: 'presence' });
  const reviewerLine = el('p', { class: 'reviewer-line' });
  reviewerLine.hidden = project.role !== 'reviewer';
  if (project.role === 'reviewer') reviewerLine.textContent = "Reviewers can't draw";

  const panels: Panel[] = [];
  const ctx: Workspace = {
    model,
    regions,
    pinMode: false,
    repaint: () => stage.repaint(),
    refreshPanels: () => {
      for (const panel of panels) panel.refresh();
      stage.setPins(
        comments
          .comments()
          .filter((comment) => comment.frame === model.activeFrame)
          .map((comment) => ({ x: comment.x, y: comment.y, state: comment.state })),
      );
    },
    reload: async () => {
      await refreshModel(model);
      stage.repaint();
      ctx.refreshPanels();
    },
    announceStage: (text) => regions.stage(text),
    announceList: (text) => regions.list(text),
    teamStroke: (name, pixels) => noteTeamStroke(name, pixels),
    afterStroke: (outcome) => handleOutcome(outcome),
    startFlood: (request) => runFlood(request),
    openComment: (x, y) => comments.openDialog(x, y),
    focusStage: () => stage.focus(),
  };

  const stage = createStage(ctx);
  const palette = palettePanel(ctx);
  const layers = layersPanel(ctx);
  const frames = framesPanel(ctx);
  const preview = previewPanel(ctx);
  const tiles = tilesPanel(ctx);
  const comments = commentsPanel(ctx);
  const snapshots = snapshotsPanel(ctx);
  const activity = activityPanel(ctx);
  panels.push(palette, layers, frames, preview, tiles, comments, snapshots, activity);

  const limits = await api.get<{ long_press_ms: number; autosave_ms: number }>('/api/config');
  if (limits.ok) {
    stage.canvas.dataset.longPressMs = String(limits.body.long_press_ms);
    document.documentElement.dataset.autosaveMs = String(limits.body.autosave_ms);
  }

  const toolbar = buildToolbar(ctx);
  const topBar = el('header', { class: 'top-bar' }, [
    el('div', { class: 'top-names' }, [
      el('a', { href: `/projects/${projectId}`, class: 'project-name' }, [project.name]),
      el('span', { class: 'sprite-name', text: model.sprite.name }),
    ]),
    presenceList,
    regions.root,
    button('Export', () => openExportDialog(ctx), { class: 'pill edit-only' }),
  ]);

  const layoutHost = el('div', { class: 'workspace-layout' });
  const page = el('main', { class: 'workspace', 'data-role': project.role }, [topBar, layoutHost]);

  let activeTab = 'Canvas';
  const centrePiece = (): HTMLElement =>
    el('div', { class: 'centre' }, [toolbar, reviewerLine, stage.node]);

  const drawLayout = (): void => {
    clear(layoutHost);
    const width = window.innerWidth;
    if (width < PHONE) {
      const panelHost = el('div', { class: 'phone-panel' });
      const tabs = el('div', { role: 'tablist', 'aria-label': 'Workspace', class: 'tab-dock' });
      const names = ['Canvas', 'Layers', 'Frames', 'Palette'];
      for (const name of names) {
        const tab = el('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': name === activeTab ? 'true' : 'false',
          class: 'pill tab',
          text: name,
        });
        tab.addEventListener('click', () => {
          activeTab = name;
          drawLayout();
        });
        tabs.append(tab);
      }
      if (activeTab === 'Canvas') panelHost.append(centrePiece());
      else if (activeTab === 'Layers') panelHost.append(layers.node);
      else if (activeTab === 'Frames') panelHost.append(frames.node, preview.node);
      else panelHost.append(palette.node);
      layoutHost.append(
        panelHost,
        button('More panels', () => openMorePanels()),
        tabs,
      );
      return;
    }
    if (width < DESKTOP) {
      layoutHost.append(
        centrePiece(),
        el('div', { class: 'dock' }, [palette.node, layers.node, el('div', { class: 'dock-frames' }, [frames.node, preview.node])]),
        button('More panels', () => openMorePanels()),
      );
      return;
    }
    layoutHost.append(
      el('div', { class: 'pane left' }, [palette.node, layers.node]),
      el('div', { class: 'pane centre-pane' }, [centrePiece(), frames.node]),
      el('div', { class: 'pane right' }, [
        preview.node,
        tiles.node,
        comments.node,
        snapshots.node,
        activity.node,
      ]),
    );
  };

  const openMorePanels = (): void => {
    const dialog = el('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'More panels',
      class: 'dialog sheet',
    });
    const shade = el('div', { class: 'shade' }, [dialog]);
    let release: (() => void) | null = null;
    const close = (): void => {
      release?.();
      shade.remove();
      drawLayout();
    };
    dialog.append(
      el('h2', { text: 'More panels' }),
      tiles.node,
      comments.node,
      snapshots.node,
      activity.node,
      button('Close', close),
    );
    document.body.append(shade);
    release = trapDialog(dialog, close);
  };

  drawLayout();
  const onResize = (): void => drawLayout();
  window.addEventListener('resize', onResize);

  const viewportBox = { w: Math.min(window.innerWidth - 40, 900), h: Math.min(window.innerHeight - 260, 700) };
  model.zoom = fitZoom(model.sprite.width, model.sprite.height, viewportBox);
  stage.repaint();
  ctx.refreshPanels();

  const teamWindows = new Map<string, { sum: number; timer: number }>();
  function noteTeamStroke(name: string, pixels: number): void {
    const held = teamWindows.get(name);
    if (held === undefined) {
      regions.team(`${name} painted ${num(pixels)} ${pixels === 1 ? 'pixel' : 'pixels'}`);
      const timer = window.setTimeout(() => {
        const current = teamWindows.get(name);
        teamWindows.delete(name);
        if (current !== undefined && current.sum > 0) {
          regions.team(
            `${name} painted ${num(current.sum)} ${current.sum === 1 ? 'pixel' : 'pixels'}`,
          );
        }
      }, 2000);
      teamWindows.set(name, { sum: 0, timer });
      return;
    }
    held.sum += pixels;
  }

  let queuedRefusals: string[] = [];
  function handleOutcome(outcome: StrokeOutcome): void {
    if (outcome.refusal !== null) {
      regions.alert(outcome.refusal);
      return;
    }
    if (outcome.queued) {
      regions.sync([`Offline · ${num(model.queue.length)} ${model.queue.length === 1 ? 'stroke' : 'strokes'} queued`]);
      return;
    }
    const me = person();
    if (me !== null) noteTeamStroke(me.name, outcome.pixels);
    regions.sync(['Synced']);
  }

  let floodTimer = 0;
  function runFlood(request: FloodRequest): void {
    const swatch = model.palette.swatches.find((entry) => entry.index === request.index);
    const countBefore = swatch?.used_by ?? request.usedBy;
    if (swatch !== undefined) {
      swatch.color = request.newColour;
      swatch.used_by = request.usedBy;
      swatch.frames = request.frames;
    }
    model.sprite.seq = Math.max(model.sprite.seq, request.seq);
    regions.stage(
      `Swatch ${request.index} now ${request.newColour}, used by ${num(request.usedBy)} ${
        request.usedBy === 1 ? 'pixel' : 'pixels'
      } in ${num(request.frames)} ${request.frames === 1 ? 'frame' : 'frames'}`,
    );
    if (reducedMotion()) {
      stage.setFlood(null);
      for (const frame of model.sprite.frames) model.thumbSeq.set(frame.number, request.seq);
      ctx.refreshPanels();
      return;
    }
    palette.refresh();
    stageThumbnails(request.seq);
    rollCount(request.index, countBefore, request.usedBy);
    const far = Math.max(
      Math.max(request.cursor.x, model.sprite.width - 1 - request.cursor.x),
      Math.max(request.cursor.y, model.sprite.height - 1 - request.cursor.y),
    );
    const started = performance.now();
    window.clearTimeout(floodTimer);
    const step = (): void => {
      const passed = performance.now() - started;
      const share = Math.min(1, passed / 420);
      const eased = 1 - (1 - share) * (1 - share);
      const radius = Math.round(eased * far);
      if (share >= 1) {
        stage.setFlood(null);
        ctx.refreshPanels();
        return;
      }
      stage.setFlood({
        index: request.index,
        oldColour: request.oldColour,
        radius,
        cursor: request.cursor,
      });
      floodTimer = window.setTimeout(step, 16);
    };
    step();
  }

  /** Thumbnails change left to right, thirty milliseconds apart. */
  function stageThumbnails(seq: number): void {
    model.sprite.frames.forEach((frame, at) => {
      window.setTimeout(() => frames.markThumb(frame.number, seq), at * 30);
    });
  }

  /** The visible count rolls up while data-used-by already holds the total. */
  function rollCount(index: number, from: number, to: number): void {
    const started = performance.now();
    const roll = (): void => {
      const share = Math.min(1, (performance.now() - started) / 320);
      const shown = Math.round(from + (to - from) * share);
      palette.showCount(index, shown);
      if (share < 1) window.setTimeout(roll, 32);
    };
    roll();
  }

  const applyRole = async (): Promise<void> => {
    const fresh = await api.get<ProjectBody>(`/api/projects/${projectId}`);
    if (!fresh.ok) {
      go('/projects');
      return;
    }
    model.role = fresh.body.role;
    page.dataset.role = model.role;
    reviewerLine.hidden = model.role !== 'reviewer';
    if (model.role === 'reviewer') reviewerLine.textContent = "Reviewers can't draw";
    drawLayout();
  };

  const channel = openChannel(
    `/api/sprites/${spriteId}/live`,
    (message) => {
      if (message.type === 'presence') {
        const people = message.people as {
          name: string;
          idle: boolean;
          cursor: { x: number; y: number; frame: number } | null;
        }[];
        const visible = Number(message.visible ?? 4);
        clear(presenceList);
        people.slice(0, visible).forEach((entry) => {
          presenceList.append(
            el('div', {
              role: 'listitem',
              'aria-label': entry.name,
              'data-idle': entry.idle ? 'true' : 'false',
              class: 'presence-entry',
              text: entry.name,
            }),
          );
        });
        if (people.length > visible) {
          presenceList.append(
            el('div', {
              role: 'listitem',
              'aria-label': `+${people.length - visible}`,
              'data-idle': 'false',
              class: 'presence-entry overflow',
              text: `+${people.length - visible}`,
            }),
          );
        }
        stage.setCursors(
          people
            .filter((entry) => entry.cursor !== null && entry.name !== person()?.name)
            .map((entry) => {
              const cursor = entry.cursor as { x: number; y: number; frame: number };
              return { person: entry.name, x: cursor.x, y: cursor.y, frame: cursor.frame };
            }),
        );
        return;
      }
      if (message.type === 'team') {
        regions.team(String(message.text));
        return;
      }
      if (message.type === 'cursor') {
        return;
      }
      if (message.type === 'comments') {
        void comments.reload().then(() => ctx.refreshPanels());
        return;
      }
      if (message.type === 'role') {
        regions.alert(`Your role is now ${String(message.role)}`);
        void applyRole();
        return;
      }
      if (message.type === 'removed') {
        go('/projects');
        return;
      }
      if (message.type === 'activity') {
        activity.refresh();
        return;
      }
      if (message.type !== 'op') return;

      const by = String(message.by ?? '');
      const mine = by === person()?.name;
      const seq = Number(message.seq ?? 0);
      const op = String(message.op ?? '');
      model.sprite.seq = Math.max(model.sprite.seq, seq);
      if (op === 'stroke' && !mine) {
        const data = message.data as {
          frame: number;
          layer: string;
          frames: number[];
          cells: [number, number, number][];
          pixels_changed: number;
        };
        applyStrokeEvent(model, data);
        noteTeamStroke(by, data.pixels_changed);
        stage.repaint();
        frames.refresh();
        palette.refresh();
        return;
      }
      if (op === 'swatch' && !mine) {
        const data = message.data as {
          index: number;
          color: string;
          used_by: number;
          frames: number;
          cursor: { x: number; y: number } | null;
        };
        const swatch = model.palette.swatches.find((entry) => entry.index === data.index);
        runFlood({
          index: data.index,
          oldColour: swatch?.color ?? '00000000',
          newColour: data.color,
          cursor: data.cursor ?? { x: 0, y: 0 },
          usedBy: data.used_by,
          frames: data.frames,
          seq,
          by,
        });
        return;
      }
      if (op === 'frame' && !mine) {
        const data = (message.data ?? {}) as { action?: string; number?: number };
        const keepFocus =
          document.activeElement !== null &&
          document.activeElement.closest('[aria-label="Frames"]') !== null;
        if (data.action === 'add' && Number(data.number) <= model.activeFrame) {
          model.activeFrame += 1;
        }
        void ctx.reload().then(() => {
          if (!keepFocus) return;
          const row = document.querySelector('.frame-row.active') as HTMLElement | null;
          row?.focus();
        });
        return;
      }
      if (op === 'layer') {
        const data = (message.data ?? {}) as { action?: string; into?: string; new_swatches?: number };
        if (data.action === 'merge') {
          regions.notice(
            `Merged into ${String(data.into)}, ${num(Number(data.new_swatches))} new ${
              Number(data.new_swatches) === 1 ? 'swatch' : 'swatches'
            }`,
          );
        }
      }
      if (op === 'restore') {
        const data = (message.data ?? {}) as { name?: string };
        if (!mine) regions.notice(`Restored ${String(data.name)}`);
      }
      void ctx.reload();
    },
    (connected) => {
      if (connected) {
        regions.sync(['Synced']);
        return;
      }
      regions.sync([
        `Offline · ${num(model.queue.length)} ${model.queue.length === 1 ? 'stroke' : 'strokes'} queued`,
      ]);
    },
  );

  const replay = async (): Promise<void> => {
    const since = model.sprite.seq;
    const missed = await api.get<{ events: { seq: number }[] }>(
      `/api/sprites/${spriteId}/events?since=${since}`,
    );
    const missedCount = missed.ok ? missed.body.events.length : 0;
    let accepted = 0;
    queuedRefusals = [];
    const queue = [...model.queue];
    model.queue = [];
    for (const stroke of queue) {
      const result = await api.post<ApiFailure & { seq: number }>(stroke.path, stroke.body);
      if (result.ok) accepted += 1;
      else queuedRefusals.push(refusalText(result));
    }
    await ctx.reload();
    const total = missedCount + accepted;
    const lines = [`Reconnected · ${num(total)} ${total === 1 ? 'update' : 'updates'} applied`];
    if (queuedRefusals.length > 0) {
      lines.push(
        `${num(queuedRefusals.length)} ${queuedRefusals.length === 1 ? 'stroke' : 'strokes'} refused: ${queuedRefusals[0]}`,
      );
    }
    regions.sync(lines);
  };

  const onOnline = (): void => void replay();
  const onOffline = (): void =>
    regions.sync([
      `Offline · ${num(model.queue.length)} ${model.queue.length === 1 ? 'stroke' : 'strokes'} queued`,
    ]);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  regions.sync(['Synced']);

  const onKey = (event: KeyboardEvent): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openCommandPalette(ctx);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      void undoOrRedo(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (workspaceHotkey(ctx, event)) event.preventDefault();
  };
  page.addEventListener('keydown', onKey);

  const undoOrRedo = async (which: 'undo' | 'redo'): Promise<void> => {
    const result = await api.post<ApiFailure & { seq: number }>(
      `/api/sprites/${spriteId}/${which}`,
    );
    if (!result.ok) {
      regions.alert(refusalText(result));
      return;
    }
    await ctx.reload();
    regions.stage(which === 'undo' ? 'Undone' : 'Redone');
  };

  toolbar.append(
    el('div', { class: 'row' }, [
      button('Undo', () => void undoOrRedo('undo')),
      button('Redo', () => void undoOrRedo('redo')),
    ]),
  );

  onLeave(() => {
    channel.close();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  });

  return page;
}

function buildToolbar(ctx: Workspace): HTMLElement {
  const model = ctx.model;
  const toolbar = el('div', { role: 'toolbar', 'aria-label': 'Tools', class: 'toolbar edit-only' });
  const tools: [string, Model['tool']][] = [
    ['Pencil', 'pencil'],
    ['Eraser', 'eraser'],
    ['Line', 'line'],
    ['Rectangle', 'rectangle'],
    ['Ellipse', 'ellipse'],
    ['Fill', 'fill'],
    ['Dither', 'dither'],
    ['Selection', 'selection'],
    ['Picker', 'picker'],
  ];
  const buttons = new Map<Model['tool'], HTMLButtonElement>();
  const markTools = (): void => {
    for (const [tool, node] of buttons) {
      node.setAttribute('aria-pressed', model.tool === tool ? 'true' : 'false');
    }
  };
  for (const [label, tool] of tools) {
    const node = button(label, () => {
      model.tool = tool;
      ctx.announceStage(`Tool: ${label}`);
      markTools();
    });
    buttons.set(tool, node);
    toolbar.append(node);
  }
  markTools();

  const pixelPerfect = checkbox('Pixel perfect', model.pixelPerfect);
  pixelPerfect.addEventListener('change', () => {
    model.pixelPerfect = pixelPerfect.checked;
    ctx.announceStage(model.pixelPerfect ? 'Pixel perfect on' : 'Pixel perfect off');
  });
  const filled = checkbox('Filled', model.filled);
  filled.addEventListener('change', () => {
    model.filled = filled.checked;
  });
  const contiguous = checkbox('Contiguous', model.contiguous);
  contiguous.addEventListener('change', () => {
    model.contiguous = contiguous.checked;
  });
  const ditherLevel = spinbutton('Dither level', model.ditherLevel, { min: '1', max: '16' });
  ditherLevel.addEventListener('change', () => {
    model.ditherLevel = Number(ditherLevel.value);
  });
  const brushSize = spinbutton('Brush size', model.brushSize, { min: '1', max: '8' });
  brushSize.addEventListener('change', () => {
    model.brushSize = Number(brushSize.value);
    ctx.announceStage(`Brush size ${model.brushSize}`);
  });
  const mirror = combobox(
    'Mirror',
    [
      { value: 'none', label: 'None' },
      { value: 'x', label: 'X' },
      { value: 'y', label: 'Y' },
      { value: 'both', label: 'Both' },
    ],
    model.mirror,
  );
  mirror.addEventListener('change', () => {
    model.mirror = mirror.value as Model['mirror'];
    ctx.announceStage(`Mirror: ${model.mirror}`);
  });
  const onionSkin = checkbox('Onion skin', model.onionSkin);
  onionSkin.addEventListener('change', () => {
    model.onionSkin = onionSkin.checked;
    ctx.repaint();
  });
  const onionFrames = spinbutton('Onion frames', model.onionFrames, { min: '1', max: '4' });
  onionFrames.addEventListener('change', () => {
    model.onionFrames = Number(onionFrames.value);
    ctx.repaint();
  });

  const selectionAction = async (
    op: 'move' | 'copy' | 'paste' | 'flip_h' | 'flip_v' | 'rotate',
  ): Promise<void> => {
    const rect = model.selection;
    if (rect === null) {
      ctx.regions.alert('Select some pixels first');
      return;
    }
    if (op === 'copy') {
      const indices = model.cels.get(model.activeFrame)?.get(model.activeLayer);
      const rows: number[][] = [];
      for (let y = 0; y < rect.h; y += 1) {
        const row: number[] = [];
        for (let x = 0; x < rect.w; x += 1) {
          row.push(indices?.[(rect.y + y) * model.sprite.width + rect.x + x] ?? 0);
        }
        rows.push(row);
      }
      model.clipboard = rows;
      return;
    }
    if (op === 'paste') {
      if (model.clipboard === null) return;
      const outcome = await sendSelection(model, 'paste', rect, { ...model.cursor }, model.clipboard);
      ctx.repaint();
      ctx.afterStroke(outcome);
      return;
    }
    if (op === 'move') {
      const outcome = await sendSelection(model, 'move', rect, { ...model.cursor });
      ctx.repaint();
      ctx.afterStroke(outcome);
      return;
    }
    const outcome = await sendSelection(model, op, rect);
    ctx.repaint();
    ctx.afterStroke(outcome);
  };

  toolbar.append(
    field('Pixel perfect', pixelPerfect),
    field('Filled', filled),
    field('Contiguous', contiguous),
    field('Dither level', ditherLevel),
    field('Brush size', brushSize),
    field('Mirror', mirror),
    field('Onion skin', onionSkin),
    field('Onion frames', onionFrames),
    el('div', { class: 'row' }, [
      button('Move selection', () => void selectionAction('move')),
      button('Copy selection', () => void selectionAction('copy')),
      button('Paste selection', () => void selectionAction('paste')),
      button('Flip horizontal', () => void selectionAction('flip_h')),
      button('Flip vertical', () => void selectionAction('flip_v')),
      button('Rotate 90', () => void selectionAction('rotate')),
    ]),
  );
  return toolbar;
}
