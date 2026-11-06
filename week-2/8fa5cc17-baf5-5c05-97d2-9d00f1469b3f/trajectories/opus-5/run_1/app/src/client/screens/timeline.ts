import { api } from '../api';
import { clear, el, prefersReducedMotion } from '../dom';
import { frame } from '../frame';
import { Screen } from '../router';
import { TimelineDto } from '../types';
import { onLive } from '../live';
import { UndoStack, activeUndoStack, setActiveUndoStack } from '../components/undo';
import { dateHeading } from '../../shared/homeclock';
import { THEME_TOKENS } from '../../shared/tokens';
import { theme } from '../state';
import { tween } from '../anim';
import {
  COPY,
  blockMovedCopy,
  heatCaption,
} from '../../shared/copy';
import {
  DRAG_THRESHOLD_PX,
  HEAT_FULL_BLOCKS,
  TIMELINE_COAST_CUTOFF,
  TIMELINE_SNAP_MS,
  TIMELINE_VELOCITY_WINDOW_MS,
  coastOffset,
  coastVelocity,
  snapTarget,
} from '../../shared/motion';

function heatColour(count: number): string {
  const tokens = THEME_TOKENS[theme()];
  const mix = Math.min(1, count / HEAT_FULL_BLOCKS);
  const channels = [0, 1, 2].map((index) =>
    Math.round(tokens.paper[index] + (tokens.accent[index] - tokens.paper[index]) * mix),
  );
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

export function timelineScreen(): Screen {
  let stopLive: (() => void) | null = null;
  const undo = new UndoStack(() => Promise.resolve({ ok: false, reason: 'gone' }));
  let data: TimelineDto | null = null;
  const region = el('div', {
    className: 'timeline',
    attrs: { role: 'region', 'aria-label': 'Daily timeline' },
  });
  const list = el('ol', { className: 'timeline-days', attrs: { 'aria-label': 'Days' } });
  region.append(list);

  async function load(keepScroll = true): Promise<void> {
    const offset = region.scrollLeft;
    const result = await api.get<TimelineDto>('/api/timeline');
    if (!result.ok) return;
    data = result.data;
    render();
    region.scrollLeft = keepScroll ? offset : region.scrollWidth;
  }

  function render(): void {
    if (data === null) return;
    clear(list);
    data.days.forEach((day) => {
      const column = el('li', { className: 'timeline-day', attrs: { 'data-date': day.date } });
      column.append(el('h2', { text: dateHeading(day.date) }));
      const band = el('div', { className: 'heat-band', attrs: { 'data-heat': String(day.block_count) } });
      band.style.backgroundColor = heatColour(day.block_count);
      column.append(band, el('p', { className: 'heat-caption', text: heatCaption(day.block_count) }));
      if (day.object_id === null) {
        column.append(el('p', { className: 'no-note', text: 'No note' }));
      } else {
        for (const block of day.blocks) {
          const excerpt = block.excerpt;
          const entry = el('div', { className: 'timeline-block' });
          entry.append(el('span', { className: 'timeline-excerpt', text: excerpt }));
          if (block.movable) {
            const handle = el('button', {
              className: 'move-handle',
              text: 'Move',
              attrs: { type: 'button', 'aria-label': `Move "${excerpt}"`, 'data-block': block.id },
            });
            handle.addEventListener('keydown', (event) => {
              if (!event.altKey) return;
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                void moveByKeyboard(block.id, day.date, event.key === 'ArrowLeft' ? -1 : 1);
              }
            });
            installBlockDrag(handle, block.id);
            entry.append(handle);
          }
          column.append(entry);
        }
      }
      list.append(column);
    });
  }

  async function moveBlock(blockId: string, targetDate: string): Promise<void> {
    if (data === null) return;
    const day = data.days.find((candidate) => candidate.date === targetDate);
    if (day === undefined || day.object_id === null) return;
    const fromDay = data.days.find((candidate) => candidate.blocks.some((block) => block.id === blockId));
    const fromObjectId = fromDay?.object_id ?? null;
    const fromIndex = fromDay?.blocks.findIndex((block) => block.id === blockId) ?? -1;
    const afterInSource = fromIndex > 0 ? fromDay?.blocks[fromIndex - 1].id ?? null : null;
    const result = await api.post(`/api/blocks/${blockId}/move`, {
      object_id: day.object_id,
      after_block_id: null,
    });
    if (!result.ok) {
      frame().showAlert(COPY.blockMoveRefused);
      return;
    }
    await load();
    const handle = list.querySelector<HTMLElement>(`[data-block="${blockId}"]`);
    if (handle !== null) {
      handle.focus();
      handle.closest('.timeline-day')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    frame().announce(blockMovedCopy(dateHeading(targetDate)));
    if (fromObjectId !== null) {
      activeUndoStack()?.push({
        kind: 'block move',
        undo: async () => {
          const back = await api.post(`/api/blocks/${blockId}/move`, {
            object_id: fromObjectId,
            after_block_id: afterInSource,
          });
          if (!back.ok) return { ok: false, reason: back.status === 409 ? 'conflict' : 'gone' };
          await load();
          return { ok: true };
        },
        redo: async () => {
          const again = await api.post(`/api/blocks/${blockId}/move`, {
            object_id: day.object_id,
            after_block_id: null,
          });
          if (!again.ok) return { ok: false, reason: again.status === 409 ? 'conflict' : 'gone' };
          await load();
          return { ok: true };
        },
      });
    }
  }

  async function moveByKeyboard(blockId: string, fromDate: string, direction: -1 | 1): Promise<void> {
    if (data === null) return;
    const index = data.days.findIndex((day) => day.date === fromDate);
    if (index === -1) return;
    for (let step = index + direction; step >= 0 && step < data.days.length; step += direction) {
      const day = data.days[step];
      if (day.object_id === null) continue;
      await moveBlock(blockId, day.date);
      return;
    }
  }

  function installBlockDrag(handle: HTMLElement, blockId: string): void {
    let startX = 0;
    let startY = 0;
    let dragging = false;
    handle.addEventListener('pointerdown', (event) => {
      startX = event.clientX;
      startY = event.clientY;
      dragging = false;
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) >= DRAG_THRESHOLD_PX) dragging = true;
    });
    handle.addEventListener('pointerup', (event) => {
      if (!dragging) return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const column = target?.closest<HTMLElement>('.timeline-day');
      const date = column?.getAttribute('data-date');
      if (date === null || date === undefined) return;
      const day = data?.days.find((candidate) => candidate.date === date);
      if (day === undefined || day.object_id === null) return;
      void moveBlock(blockId, date);
    });
  }

  /** A drag scrolls the timeline one for one, then it coasts and snaps. */
  function installScroll(): void {
    type Sample = { time: number; offset: number };
    let samples: Sample[] = [];
    let dragging = false;
    let startX = 0;
    let startOffset = 0;
    let cancelCoast: (() => void) | null = null;

    region.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('button, a') !== null) return;
      dragging = true;
      startX = event.clientX;
      startOffset = region.scrollLeft;
      samples = [{ time: event.timeStamp, offset: region.scrollLeft }];
      if (cancelCoast !== null) cancelCoast();
      region.setPointerCapture(event.pointerId);
    });
    region.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      region.scrollLeft = startOffset - (event.clientX - startX);
      samples.push({ time: event.timeStamp, offset: region.scrollLeft });
      if (samples.length > 60) samples.shift();
    });
    const release = (): void => {
      if (!dragging) return;
      dragging = false;
      const last = samples[samples.length - 1];
      let reference = samples[0];
      for (const sample of samples) {
        if (last.time - sample.time >= TIMELINE_VELOCITY_WINDOW_MS) reference = sample;
      }
      const span = last.time - reference.time;
      const velocity = span === 0 ? 0 : (last.offset - reference.offset) / span;
      const releaseOffset = region.scrollLeft;
      if (prefersReducedMotion() || velocity === 0) {
        snap(region.scrollLeft);
        return;
      }
      let frameId = 0;
      const started = performance.now();
      const step = (now: number): void => {
        const elapsed = now - started;
        const current = coastVelocity(velocity, elapsed);
        region.scrollLeft = coastOffset(releaseOffset, velocity, elapsed);
        if (Math.abs(current) < TIMELINE_COAST_CUTOFF) {
          snap(region.scrollLeft);
          return;
        }
        frameId = requestAnimationFrame(step);
      };
      frameId = requestAnimationFrame(step);
      cancelCoast = () => cancelAnimationFrame(frameId);
    };
    region.addEventListener('pointerup', release);
    region.addEventListener('pointercancel', release);
  }

  function snap(from: number): void {
    const target = Math.max(0, Math.min(region.scrollWidth - region.clientWidth, snapTarget(from)));
    if (prefersReducedMotion()) {
      region.scrollLeft = target;
      return;
    }
    tween(TIMELINE_SNAP_MS, (eased) => {
      region.scrollLeft = from + (target - from) * eased;
    });
  }

  function keyHandler(event: KeyboardEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      void undo.undo();
      return;
    }
    if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      void undo.redo();
    }
  }

  return {
    async mount(): Promise<void> {
      const main = frame().main;
      clear(main);
      clear(frame().margin);
      frame().setTopTitle('Timeline');
      main.append(el('h1', { text: 'Timeline', attrs: { tabindex: '-1' } }), region);
      await load(false);
      installScroll();
      setActiveUndoStack(undo);
      document.addEventListener('keydown', keyHandler);
      stopLive = onLive((type) => {
        if (type === 'block.saved' || type === 'block.removed' || type === 'object.saved') void load();
      });
    },
    unmount(): void {
      setActiveUndoStack(null);
      document.removeEventListener('keydown', keyHandler);
      if (stopLive !== null) stopLive();
    },
  };
}
