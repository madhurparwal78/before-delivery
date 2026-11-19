import { frameDurationMs, finalFrame, tagSequence, type PreviewSpeed } from '../../../shared/tags.js';
import type { TagDirection } from '../../../shared/types.js';
import { api, refusalText, type ApiFailure } from '../../api.js';
import {
  button,
  clear,
  combobox,
  el,
  field,
  keepingFocus,
  reducedMotion,
  spinbutton,
  textbox,
} from '../../dom.js';
import { average, num } from '../../session.js';
import { paintPixels } from '../../stagepaint.js';
import type { Workspace } from '../context.js';
import { compositeOf } from '../model.js';
import { wirePickup } from '../pickup.js';
import type { Panel } from './palette.js';

export interface FramesPanel extends Panel {
  markThumb(frameNumber: number, seq: number): void;
}

const MAX_ROWS = 40;

/** The Frames panel: a bounded grid, durations, links and tags. */
export function framesPanel(ctx: Workspace): FramesPanel {
  const totals = el('p', { class: 'frame-totals' });
  const grid = el('div', { role: 'grid', 'aria-label': 'Frames', class: 'frames-grid' });
  const duration = spinbutton('Frame duration', 100, { min: '1' });
  const tagName = textbox('Tag name');
  const tagFrom = spinbutton('Tag from', 1, { min: '1' });
  const tagTo = spinbutton('Tag to', 1, { min: '1' });
  const tagDirection = combobox('Tag direction', [
    { value: 'forward', label: 'Forward' },
    { value: 'reverse', label: 'Reverse' },
    { value: 'pingpong', label: 'Pingpong' },
  ]);
  const tagRepeat = spinbutton('Tag repeat', 0, { min: '0', max: '99' });
  const loadNewer = button('Load newer', async () => {
    const draft = await api.get<{ text: string; version: number }>(
      `/api/drafts/tag:${ctx.model.spriteId}`,
    );
    if (draft.ok) {
      tagName.value = draft.body.text;
      draftVersion = draft.body.version;
      ctx.regions.draft('Saved');
    }
  });
  loadNewer.hidden = true;

  let draftVersion = 0;
  let autosave = 0;
  const saveDraft = async (): Promise<void> => {
    ctx.regions.draft('Saving…');
    const result = await api.put<ApiFailure & { version: number; current?: { text: string; version: number } }>(
      `/api/drafts/tag:${ctx.model.spriteId}`,
      { text: tagName.value, version: draftVersion },
    );
    if (!result.ok) {
      ctx.regions.draft('A newer version exists');
      loadNewer.hidden = false;
      return;
    }
    draftVersion = result.body.version;
    ctx.regions.draft('Saved');
  };
  tagName.addEventListener('input', () => {
    window.clearTimeout(autosave);
    autosave = window.setTimeout(
      () => void saveDraft(),
      Number(document.documentElement.dataset.autosaveMs ?? '1000'),
    );
  });

  const addTag = button('Add tag', async () => {
    const result = await api.post<ApiFailure>(`/api/sprites/${ctx.model.spriteId}/tags`, {
      name: tagName.value.trim(),
      from: Number(tagFrom.value),
      to: Number(tagTo.value),
      direction: tagDirection.value,
      repeat: Number(tagRepeat.value),
    });
    if (!result.ok) {
      ctx.regions.alert(refusalText(result));
      return;
    }
    tagName.value = '';
    draftVersion = 0;
    await ctx.reload();
  });

  duration.addEventListener('change', async () => {
    const result = await api.patch<ApiFailure>(
      `/api/sprites/${ctx.model.spriteId}/frames/${ctx.model.activeFrame}`,
      { duration_ms: Number(duration.value) },
    );
    if (!result.ok) {
      ctx.regions.alert(refusalText(result));
      return;
    }
    await ctx.reload();
  });

  const refresh = (): void => {
    keepingFocus(grid, () => refreshNow(), () => {
      (grid.querySelector('.frame-row.active') as HTMLElement | null)?.focus();
    });
  };

  const refreshNow = (): void => {
    const model = ctx.model;
    const frames = model.sprite.frames;
    const total = frames.reduce((sum, frame) => sum + frame.duration_ms, 0);
    totals.textContent = `Total ${num(total)} ms · Average ${average(total, frames.length)} ms`;
    totals.setAttribute('data-total-ms', String(total));

    const focusedFrame = model.activeFrame;
    const start = Math.max(0, Math.min(focusedFrame - 1 - Math.floor(MAX_ROWS / 2), frames.length - MAX_ROWS));
    const from = Math.max(0, start);
    const shown = frames.slice(from, from + MAX_ROWS);
    clear(grid);
    grid.setAttribute('aria-rowcount', String(frames.length));
    const items = shown.map((frame) => {
      const row = el('div', {
        role: 'row',
        'aria-label': `Frame ${frame.number}`,
        'aria-rowindex': String(frame.number),
        class: frame.number === model.activeFrame ? 'frame-row active' : 'frame-row',
      });
      const thumb = el('canvas', {
        class: 'frame-thumb',
        'data-thumb-seq': String(model.thumbSeq.get(frame.number) ?? 0),
      });
      paintPixels(thumb, compositeOf(model, frame.number), model.sprite.width, model.sprite.height, 1);
      thumb.style.width = '48px';
      thumb.style.height = '48px';
      row.append(
        el('span', { role: 'gridcell', text: `Frame ${num(frame.number)}` }),
        el('span', { role: 'gridcell' }, [thumb]),
        el('span', { role: 'gridcell', text: `${num(frame.duration_ms)} ms` }),
      );
      if (frame.linked_layers.length > 0) {
        row.append(el('span', { role: 'gridcell', class: 'linked-note', text: 'Linked' }));
      }
      return { label: `Frame ${frame.number}`, node: row };
    });
    if (items.length === 0) {
      grid.append(el('p', { class: 'empty-line', text: 'No frames yet' }));
    } else {
      for (const item of items) grid.append(item.node);
      wirePickup({
        container: grid,
        items,
        announce: (text) => ctx.announceList(text),
        onSelect: (at) => {
          model.activeFrame = shown[at].number;
          ctx.announceStage(`Frame ${model.activeFrame} of ${num(frames.length)}`);
          ctx.repaint();
          refresh();
        },
        onDrop: async (order) => {
          for (let position = 0; position < order.length; position += 1) {
            const frame = shown[order[position]];
            await api.patch<ApiFailure>(
              `/api/sprites/${model.spriteId}/frames/${frame.number}`,
              { position: from + position + 1 },
            );
          }
          await ctx.reload();
        },
      });
    }
    const active = frames.find((frame) => frame.number === model.activeFrame);
    if (active !== undefined) duration.value = String(active.duration_ms);
    tagFrom.max = String(Math.max(1, frames.length));
    tagTo.max = String(Math.max(1, frames.length));
  };

  grid.addEventListener('keydown', (event) => {
    const model = ctx.model;
    const frames = model.sprite.frames;
    const jump = (to: number): void => {
      event.preventDefault();
      model.activeFrame = Math.min(Math.max(to, 1), frames.length);
      ctx.announceStage(`Frame ${model.activeFrame} of ${num(frames.length)}`);
      ctx.repaint();
      refresh();
      (grid.querySelector('.frame-row.active') as HTMLElement | null)?.focus();
    };
    if (event.key === 'Home') jump(1);
    else if (event.key === 'End') jump(frames.length);
    else if (event.key === 'PageDown') jump(model.activeFrame + 10);
    else if (event.key === 'PageUp') jump(model.activeFrame - 10);
  });

  const body = el('div', { class: 'panel-body' }, [
    totals,
    grid,
    el('div', { class: 'edit-only panel-controls' }, [
    button('Add frame', async () => {
      const result = await api.post<ApiFailure>(`/api/sprites/${ctx.model.spriteId}/frames`, {
        duration_ms: Number(duration.value),
      });
      if (!result.ok) {
        ctx.regions.alert(refusalText(result));
        return;
      }
      await ctx.reload();
    }),
    field('Frame duration', duration),
    el('div', { class: 'row' }, [
      button('Link cel', async () => {
        const model = ctx.model;
        const result = await api.post<ApiFailure>(
          `/api/sprites/${model.spriteId}/frames/${model.activeFrame}/cels/link`,
          { layer: model.activeLayer, to_frame: Math.max(1, model.activeFrame - 1) },
        );
        if (!result.ok) ctx.regions.alert(refusalText(result));
        await ctx.reload();
      }),
      button('Unlink cel', async () => {
        const model = ctx.model;
        const result = await api.post<ApiFailure>(
          `/api/sprites/${model.spriteId}/frames/${model.activeFrame}/cels/unlink`,
          { layer: model.activeLayer },
        );
        if (!result.ok) ctx.regions.alert(refusalText(result));
        await ctx.reload();
      }),
    ]),
    field('Tag name', tagName),
    field('Tag from', tagFrom),
    field('Tag to', tagTo),
    field('Tag direction', tagDirection),
    field('Tag repeat', tagRepeat),
    addTag,
    loadNewer,
    ]),
  ]);
  refresh();

  return {
    node: el('section', { role: 'region', 'aria-label': 'Frames', class: 'panel panel-lemon' }, [
      el('h2', { class: 'panel-title', text: 'Frames' }),
      body,
    ]),
    refresh,
    markThumb: (frameNumber, seq) => {
      ctx.model.thumbSeq.set(frameNumber, seq);
      const row = grid.querySelector(`[aria-rowindex="${frameNumber}"] .frame-thumb`);
      if (row === null) return;
      const thumb = row as HTMLCanvasElement;
      thumb.dataset.thumbSeq = String(seq);
      paintPixels(
        thumb,
        compositeOf(ctx.model, frameNumber),
        ctx.model.sprite.width,
        ctx.model.sprite.height,
        1,
      );
      thumb.style.width = '48px';
      thumb.style.height = '48px';
    },
  };
}

/** The Preview panel: the only continuous motion in the product. */
export function previewPanel(ctx: Workspace): Panel {
  const canvas = el('canvas', {
    class: 'preview-canvas',
    'data-preview-frame': '1',
    'data-preview-mode': reducedMotion() ? 'step' : 'autoplay',
    'data-preview-pass': '1',
  });
  const tagSelect = combobox('Preview tag', [{ value: 'all', label: 'All frames' }], 'all');
  const speedSelect = combobox(
    'Preview speed',
    [
      { value: 'Half', label: 'Half' },
      { value: 'Normal', label: 'Normal' },
      { value: 'Double', label: 'Double' },
    ],
    'Normal',
  );
  const pauseButton = button('Pause preview', () => {
    playing = !playing;
    pauseButton.textContent = playing ? 'Pause preview' : 'Play preview';
    pauseButton.setAttribute('aria-label', playing ? 'Pause preview' : 'Play preview');
    canvas.setAttribute('data-preview-mode', playing ? 'autoplay' : 'step');
    if (playing) tick();
    else window.clearTimeout(timer);
  });
  if (reducedMotion()) pauseButton.hidden = true;

  let playing = !reducedMotion();
  let at = 0;
  let pass = 1;
  let timer = 0;

  const sequenceOf = (): { frames: number[]; repeat: number; stopFrame: number | null } => {
    const model = ctx.model;
    if (tagSelect.value === 'all') {
      return {
        frames: model.sprite.frames.map((frame) => frame.number),
        repeat: 0,
        stopFrame: null,
      };
    }
    const tag = model.sprite.tags.find((entry) => String(entry.id) === tagSelect.value);
    if (tag === undefined) {
      return { frames: model.sprite.frames.map((frame) => frame.number), repeat: 0, stopFrame: null };
    }
    return {
      frames: tagSequence(tag.from, tag.to, tag.direction as TagDirection),
      repeat: tag.repeat,
      stopFrame: finalFrame(tag.from, tag.to, tag.direction as TagDirection),
    };
  };

  const show = (number: number): void => {
    const model = ctx.model;
    paintPixels(canvas, compositeOf(model, number), model.sprite.width, model.sprite.height, 4);
    canvas.setAttribute('data-preview-frame', String(number));
    canvas.setAttribute('data-preview-pass', String(pass));
  };

  const tick = (): void => {
    const model = ctx.model;
    const { frames, repeat, stopFrame } = sequenceOf();
    if (frames.length === 0) return;
    const number = frames[at % frames.length];
    show(number);
    const duration =
      model.sprite.frames.find((frame) => frame.number === number)?.duration_ms ?? 100;
    const shown = frameDurationMs(duration, speedSelect.value as PreviewSpeed);
    timer = window.setTimeout(() => {
      at += 1;
      if (at % frames.length === 0) {
        pass += 1;
        if (repeat > 0 && pass > repeat) {
          playing = false;
          canvas.setAttribute('data-preview-mode', 'step');
          pauseButton.textContent = 'Play preview';
          pauseButton.setAttribute('aria-label', 'Play preview');
          if (stopFrame !== null) show(stopFrame);
          ctx.regions.notice(`Finished after ${num(repeat)} ${repeat === 1 ? 'pass' : 'passes'}`);
          return;
        }
      }
      if (playing) tick();
    }, shown);
  };

  const stepBy = (step: number): void => {
    const { frames } = sequenceOf();
    if (frames.length === 0) return;
    at = (at + step + frames.length) % frames.length;
    show(frames[at]);
  };

  tagSelect.addEventListener('change', () => {
    at = 0;
    pass = 1;
    window.clearTimeout(timer);
    if (!reducedMotion()) {
      playing = true;
      canvas.setAttribute('data-preview-mode', 'autoplay');
      pauseButton.textContent = 'Pause preview';
      tick();
      return;
    }
    const { frames } = sequenceOf();
    if (frames.length > 0) show(frames[0]);
  });
  speedSelect.addEventListener('change', () => undefined);

  const refresh = (): void => {
    const model = ctx.model;
    const current = tagSelect.value;
    clear(tagSelect);
    tagSelect.append(el('option', { value: 'all' }, ['All frames']));
    for (const tag of model.sprite.tags) {
      tagSelect.append(el('option', { value: String(tag.id) }, [tag.name]));
    }
    tagSelect.value = model.sprite.tags.some((tag) => String(tag.id) === current) ? current : 'all';
    const { frames } = sequenceOf();
    if (frames.length > 0) show(frames[at % frames.length]);
  };

  refresh();
  if (playing) tick();

  const body = el('div', { class: 'panel-body' }, [
    canvas,
    field('Preview tag', tagSelect),
    field('Preview speed', speedSelect),
    el('div', { class: 'row' }, [
      button('Previous frame', () => stepBy(-1)),
      button('Next frame', () => stepBy(1)),
      pauseButton,
    ]),
  ]);

  return {
    node: el('section', { role: 'region', 'aria-label': 'Preview', class: 'panel panel-plain' }, [
      el('h2', { class: 'panel-title', text: 'Preview' }),
      body,
    ]),
    refresh,
  };
}
