import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { strokeWrites, type Point } from '../../shared/engine';
import { compositeHash } from '../../shared/composite';
import { parseColour } from '../../shared/colour';
import { applyAtCursor, cancelFloating, commitFloating, commitStroke, moveFloating, openComment, pick, rectOf, rectText, setCursor, strokeOptions, zoomBy } from './draw';
import type { Model } from './model';
import { onionTint, paintPixels } from './paint';
import { sendCursor } from './sync';
import { Icon } from '../icons';
import { useModel } from './use-model';
import { configSignal } from '../config';

const hashes = new WeakMap<Uint8Array, string>();
const hashOf = (rgba: Uint8Array): string => {
  let hash = hashes.get(rgba);
  if (!hash) hashes.set(rgba, (hash = compositeHash(rgba)));
  return hash;
};

interface Gesture {
  pointer: number;
  type: string;
  start: Point;
  last: Point;
  points: Point[];
  picked: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Preview {
  points: Point[];
}

/** The largest zoom of 8, 4, 2, 1 that fits the space, defaulting to 8. */
function fitZoom(m: Model, width: number, height: number): number {
  return [8, 4, 2, 1].find((zoom) => m.width * zoom <= width && m.height * zoom <= height) ?? 1;
}

export function Stage({ m, narrow }: { m: Model; narrow: boolean }): JSX.Element {
  useModel(m);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const touches = useRef(new Set<number>());
  const ignoring = useRef(false);
  const preview = useRef<Preview | null>(null);
  const run = useRef<Point[] | null>(null);
  const sized = useRef(false);

  const redraw = (): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!sized.current) {
      sized.current = true;
      const box = viewportRef.current?.parentElement;
      m.zoom = fitZoom(m, box?.clientWidth ?? 640, Math.max(256, innerHeight * 0.62));
      queueMicrotask(() => m.changed());
    }
    const zoom = m.zoom;
    const rgba = m.frameRgba(m.frameId, 'stage');
    let under: Uint8Array | null = null;
    if (m.onion.on) {
      const base = new Uint8Array(m.width * m.height * 4);
      for (let k = m.onion.frames; k >= 1; k--) {
        const frame = m.frames[m.frameNumber - 1 - k];
        if (!frame) continue;
        const tinted = onionTint(m.frameRgba(frame.id, 'final'), 0.5 / k + 0.15);
        for (let at = 0; at < tinted.length; at += 4) if ((tinted[at + 3] ?? 0) > 0) base.set(tinted.subarray(at, at + 4), at);
      }
      under = base;
    }
    paintPixels(canvas, rgba, m.width, m.height, zoom, under);
    const ctx = canvas.getContext('2d');
    if (ctx) overlays(ctx, m, zoom, preview.current, gesture.current?.type === 'touch');
    canvas.dataset.spriteId = String(m.spriteId);
    canvas.dataset.frame = String(m.frameNumber);
    canvas.dataset.layer = m.layer?.name ?? '';
    canvas.dataset.zoom = String(zoom);
    canvas.dataset.cursorX = String(m.cursor[0]);
    canvas.dataset.cursorY = String(m.cursor[1]);
    canvas.dataset.seq = String(m.seq);
    canvas.dataset.compositeHash = hashOf(m.frameRgba(m.frameId, 'final'));
    setOptional(canvas, 'selection', m.selection ? rectText(m.selection) : null);
    setOptional(canvas, 'floating', m.floating ? rectText(m.floating) : null);
    setOptional(canvas, 'floodRadius', m.flood?.rings ? String(m.flood.radius) : null);
    canvas.style.width = `${m.width * zoom}px`;
    canvas.style.height = `${m.height * zoom}px`;
  };

  useLayoutEffect(() => {
    redraw();
    return m.subscribeStage(redraw);
  }, [m]);

  const cellAt = (event: PointerEvent): Point => {
    const box = (canvasRef.current as HTMLCanvasElement).getBoundingClientRect();
    return [Math.max(0, Math.min(m.width - 1, Math.floor((event.clientX - box.left) / m.zoom))), Math.max(0, Math.min(m.height - 1, Math.floor((event.clientY - box.top) / m.zoom)))];
  };

  const endGesture = (): void => {
    const g = gesture.current;
    if (g?.timer) clearTimeout(g.timer);
    gesture.current = null;
    preview.current = null;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      touches.current.add(event.pointerId);
      if (touches.current.size > 1) {
        ignoring.current = true;
        endGesture();
        m.redrawStage();
        return;
      }
    }
    if (ignoring.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
    const cell = cellAt(event);
    m.cursor = cell;
    sendCursor(m);
    if (m.pinning) return openComment(m, cell[0], cell[1]);
    if (!m.canEdit) return m.changed();
    const tool = m.tool;
    if (tool === 'fill' || tool === 'dither') {
      commitStroke(m, tool, [cell]);
      return m.changed();
    }
    if (tool === 'picker') {
      pick(m, cell[0], cell[1]);
      return;
    }
    const g: Gesture = { pointer: event.pointerId, type: event.pointerType, start: cell, last: cell, points: [cell], picked: false, timer: null };
    gesture.current = g;
    if (event.pointerType === 'touch') {
      g.timer = setTimeout(() => {
        if (gesture.current !== g) return;
        g.picked = true;
        preview.current = null;
        pick(m, g.start[0], g.start[1]);
      }, configSignal.get()?.long_press_ms ?? 500);
    }
    preview.current = { points: [cell] };
    m.redrawStage();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (ignoring.current) return;
    const cell = cellAt(event);
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) {
      if (event.pointerType === 'mouse' && (cell[0] !== m.cursor[0] || cell[1] !== m.cursor[1])) {
        m.cursor = cell;
        m.redrawStage();
        sendCursor(m);
      }
      return;
    }
    if (cell[0] === g.last[0] && cell[1] === g.last[1]) return;
    g.last = cell;
    if (g.timer) {
      clearTimeout(g.timer);
      g.timer = null;
    }
    m.cursor = cell;
    if (m.tool === 'pencil' || m.tool === 'eraser') g.points.push(cell);
    else g.points = [g.start, cell];
    preview.current = { points: g.points };
    m.redrawStage();
    sendCursor(m);
  };

  const onPointerUp = (event: PointerEvent): void => {
    touches.current.delete(event.pointerId);
    if (touches.current.size === 0) ignoring.current = false;
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) return;
    endGesture();
    if (g.picked) return m.changed();
    const tool = m.tool;
    if (tool === 'selection') m.selection = rectOf(g.start, g.last);
    else if (tool === 'line' || tool === 'rectangle' || tool === 'ellipse') commitStroke(m, tool, [g.start, g.last]);
    else if (tool === 'pencil' || tool === 'eraser') commitStroke(m, tool, g.points);
    m.changed();
  };

  const onPointerCancel = (event: PointerEvent): void => {
    touches.current.delete(event.pointerId);
    if (touches.current.size === 0) ignoring.current = false;
    endGesture();
    m.redrawStage();
  };

  const commitRun = (): void => {
    const points = run.current;
    run.current = null;
    preview.current = null;
    if (points && points.length > 0 && (m.tool === 'pencil' || m.tool === 'eraser')) commitStroke(m, m.tool, points);
    m.changed();
  };

  useLayoutEffect(() => {
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Shift' && run.current) commitRun();
    };
    addEventListener('keyup', onKeyUp);
    return () => removeEventListener('keyup', onKeyUp);
  }, [m]);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const { key } = event;
    if (key === 'Tab') {
      if (m.drawing) event.preventDefault();
      return;
    }
    if (key === 'Escape') {
      event.preventDefault();
      if (m.floating) return cancelFloating(m);
      m.drawing = false;
      m.anchor = null;
      return m.announce('Left drawing mode');
    }
    if (key === 'Enter') {
      event.preventDefault();
      if (!m.drawing) {
        m.drawing = true;
        return m.changed();
      }
      if (m.floating) commitFloating(m);
      return;
    }
    if (!m.drawing) return;
    const arrow: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = arrow[key];
    if (step) {
      event.preventDefault();
      if (m.floating) return moveFloating(m, step[0], step[1]);
      const [x, y] = m.cursor;
      const next: Point = [Math.max(0, Math.min(m.width - 1, x + step[0])), Math.max(0, Math.min(m.height - 1, y + step[1]))];
      if (event.shiftKey && m.canEdit && (m.tool === 'pencil' || m.tool === 'eraser')) {
        if (!run.current) run.current = [[x, y]];
        const last = run.current[run.current.length - 1];
        if (last && (last[0] !== next[0] || last[1] !== next[1])) run.current.push(next);
        preview.current = { points: run.current };
      }
      return setCursor(m, next[0], next[1]);
    }
    if (key === ' ') {
      event.preventDefault();
      if (m.floating || !m.canEdit) return;
      applyAtCursor(m);
    }
  };

  const zoom = m.zoom;
  const frameCursors = [...m.cursors.values()].filter((c) => c.id !== m.me.id);
  const pins = m.comments.filter((c) => c.frame === m.frameNumber);
  return (
    <div class="stage-box">
      <div class="stage-viewport" ref={viewportRef}>
        <div class="stage-frame" style={{ width: `${m.width * zoom}px`, height: `${m.height * zoom}px` }}>
          <canvas
            ref={canvasRef}
            class="stage"
            role="application"
            aria-label="Sprite stage"
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onKeyDown={onKeyDown}
            onFocus={() => {
              m.drawing = true;
              m.changed();
            }}
            onBlur={() => {
              m.drawing = false;
              m.redrawStage();
            }}
            onContextMenu={(event) => event.preventDefault()}
          />
          <div class="stage-overlay">
            <div role="region" aria-label="Live cursors" class="live-cursors">
              {frameCursors.map((c) => (
                <div
                  key={c.id}
                  class="live-cursor"
                  data-person={c.name}
                  data-x={c.x}
                  data-y={c.y}
                  data-frame={c.frame}
                  style={{ left: `${c.x * zoom}px`, top: `${c.y * zoom}px`, width: `${zoom}px`, height: `${zoom}px`, visibility: c.frame === m.frameNumber ? 'visible' : 'hidden' }}
                >
                  <span class="live-cursor-name">{c.name}</span>
                </div>
              ))}
            </div>
            {pins.map((comment) => (
              <button
                key={comment.id}
                type="button"
                class="pin"
                aria-label={`Comment at ${comment.x}, ${comment.y}`}
                data-state={comment.state}
                style={{ left: `${(comment.x + 0.5) * zoom - 22}px`, top: `${(comment.y + 0.5) * zoom - 22}px` }}
                onClick={() => document.getElementById(`comment-${comment.id}`)?.scrollIntoView({ block: 'nearest' })}
              >
                <span class="pin-dot" />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div class="zoom-row">
        <button type="button" class="pill icon-only" aria-label="Zoom in" onClick={() => zoomBy(m, 1)}>
          <Icon name="plus" />
        </button>
        <button type="button" class="pill icon-only" aria-label="Zoom out" onClick={() => zoomBy(m, -1)}>
          <Icon name="minus" />
        </button>
        {narrow &&
          (['left', 'right', 'up', 'down'] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              class="pill icon-only"
              aria-label={`Pan ${direction}`}
              onClick={() => viewportRef.current?.scrollBy({ left: { left: -64, right: 64 }[direction as 'left' | 'right'] ?? 0, top: { up: -64, down: 64 }[direction as 'up' | 'down'] ?? 0 })}
            >
              <Icon name={direction} />
            </button>
          ))}
      </div>
    </div>
  );
}

function setOptional(canvas: HTMLCanvasElement, name: string, value: string | null): void {
  if (value === null) delete canvas.dataset[name];
  else canvas.dataset[name] = value;
}

function overlays(ctx: CanvasRenderingContext2D, m: Model, zoom: number, preview: Preview | null, touch: boolean): void {
  const box = (x: number, y: number, w: number, h: number, light: string, dark: string): void => {
    ctx.lineWidth = 1;
    ctx.strokeStyle = dark;
    ctx.strokeRect(x * zoom + 0.5, y * zoom + 0.5, w * zoom - 1, h * zoom - 1);
    ctx.strokeStyle = light;
    ctx.strokeRect(x * zoom + 1.5, y * zoom + 1.5, w * zoom - 3, h * zoom - 3);
  };
  const tool = m.tool;
  if (preview && (tool === 'pencil' || tool === 'eraser' || tool === 'line' || tool === 'rectangle' || tool === 'ellipse')) {
    const cel = m.celBuffer(m.frameId, m.layerId) ?? new Uint8Array(m.width * m.height);
    const writes = strokeWrites(cel, { width: m.width, height: m.height }, { tool, points: preview.points, swatch: tool === 'eraser' ? 0 : m.primary, size: m.size, mirror: m.mirror, options: strokeOptions(m) });
    const [r, g, b] = parseColour(m.colourAt(m.primary));
    ctx.fillStyle = tool === 'eraser' ? 'rgba(255,255,255,0.35)' : `rgba(${r},${g},${b},0.85)`;
    for (const [at] of writes) ctx.fillRect((at % m.width) * zoom, Math.floor(at / m.width) * zoom, zoom, zoom);
  }
  if (m.floating) {
    const f = m.floating;
    f.rows.forEach((row, ry) =>
      row.forEach((index, rx) => {
        if (index === 0) return;
        const [r, g, b, a] = parseColour(m.colourAt(index));
        ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
        ctx.fillRect((f.x + rx) * zoom, (f.y + ry) * zoom, zoom, zoom);
      }),
    );
    box(f.x, f.y, f.w, f.h, '#ffe66b', '#000000');
  } else if (m.selection) box(m.selection.x, m.selection.y, m.selection.w, m.selection.h, '#ffffff', '#000000');
  if (m.anchor) box(m.anchor[0], m.anchor[1], 1, 1, '#ffe66b', '#000000');
  if (m.drawing && !touch) box(m.cursor[0], m.cursor[1], 1, 1, '#ffffff', '#000000');
}

