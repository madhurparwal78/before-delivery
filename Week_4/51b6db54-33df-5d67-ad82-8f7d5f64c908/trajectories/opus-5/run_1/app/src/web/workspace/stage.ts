import { parseColour } from '../../shared/colour.js';
import { readRect } from '../../shared/selection.js';
import type { Point, StrokeTool, Tool } from '../../shared/types.js';
import { api } from '../api.js';
import { button, el, reducedMotion } from '../dom.js';
import { num } from '../session.js';
import { paintPixels, stepZoom } from '../stagepaint.js';
import type { Workspace } from './context.js';
import { colourMapOf, colourText, compositeOf, hashOf, sendSelection, sendStroke } from './model.js';

const TOOL_KEYS: Record<string, Tool> = {
  b: 'pencil',
  e: 'eraser',
  l: 'line',
  r: 'rectangle',
  o: 'ellipse',
  g: 'fill',
  d: 'dither',
  s: 'selection',
  i: 'picker',
};

const TOOL_LABELS: Record<Tool, string> = {
  pencil: 'Pencil',
  eraser: 'Eraser',
  line: 'Line',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  fill: 'Fill',
  dither: 'Dither',
  selection: 'Selection',
  picker: 'Picker',
};

const MIRRORS: ('none' | 'x' | 'y' | 'both')[] = ['none', 'x', 'y', 'both'];

export interface StageHandles {
  node: HTMLElement;
  canvas: HTMLCanvasElement;
  repaint(): void;
  setFlood(flood: FloodPaint | null): void;
  focus(): void;
  setCursors(cursors: { person: string; x: number; y: number; frame: number }[]): void;
  setPins(pins: { x: number; y: number; state: string }[]): void;
}

export interface FloodPaint {
  index: number;
  oldColour: string;
  radius: number;
  cursor: { x: number; y: number };
}

export function createStage(ctx: Workspace): StageHandles {
  const model = ctx.model;
  const canvas = el('canvas', {
    role: 'application',
    'aria-label': 'Sprite stage',
    class: 'stage-canvas',
    tabindex: '0',
  });
  const onion = el('canvas', { class: 'onion-canvas', 'aria-hidden': 'true' });
  const cursorRegion = el('div', {
    role: 'region',
    'aria-label': 'Live cursors',
    class: 'live-cursors',
  });
  const pinHost = el('div', { class: 'pin-host' });
  const marquee = el('div', { class: 'marquee', 'aria-hidden': 'true' });
  marquee.hidden = true;
  const stack = el('div', { class: 'stage-stack' }, [onion, canvas, pinHost, cursorRegion, marquee]);
  const viewport = el('div', { class: 'stage-viewport' }, [stack]);

  let flood: FloodPaint | null = null;
  let anchor: Point | null = null;
  let drawing = false;
  let samples: Point[] = [];
  let shiftRun: Point[] | null = null;
  let drawingMode = false;
  let longPress = 0;
  let touchCells = 0;

  const colours = (): Map<number, string> => colourMapOf(model.palette);

  const repaint = (): void => {
    const map = colours();
    const bytes = compositeOf(model, model.activeFrame, map);
    const hash = hashOf(model, model.activeFrame);
    const shown = new Uint8Array(bytes);
    if (flood !== null) {
      const old = parseColour(flood.oldColour);
      const layers = [...model.sprite.layers].sort((l, r) => r.position - l.position);
      for (let y = 0; y < model.sprite.height; y += 1) {
        for (let x = 0; x < model.sprite.width; x += 1) {
          const distance = Math.max(Math.abs(x - flood.cursor.x), Math.abs(y - flood.cursor.y));
          if (distance <= flood.radius) continue;
          const top = layers
            .filter((layer) => layer.visible)
            .map((layer) => model.cels.get(model.activeFrame)?.get(layer.name))
            .filter((indices): indices is Uint8Array => indices !== undefined);
          const usesIndex = top.some((indices) => indices[y * model.sprite.width + x] === flood?.index);
          if (!usesIndex) continue;
          const at = (y * model.sprite.width + x) * 4;
          shown[at] = old[0];
          shown[at + 1] = old[1];
          shown[at + 2] = old[2];
          shown[at + 3] = old[3];
        }
      }
    }
    if (model.floating !== null) {
      const { rect, cells } = model.floating;
      cells.forEach((row, y) => {
        row.forEach((index, x) => {
          if (index === 0) return;
          const atX = rect.x + x;
          const atY = rect.y + y;
          if (atX < 0 || atY < 0 || atX >= model.sprite.width || atY >= model.sprite.height) return;
          const colour = parseColour(colourText(model, index));
          const at = (atY * model.sprite.width + atX) * 4;
          shown[at] = colour[0];
          shown[at + 1] = colour[1];
          shown[at + 2] = colour[2];
          shown[at + 3] = colour[3];
        });
      });
    }
    paintPixels(canvas, shown, model.sprite.width, model.sprite.height, model.zoom);
    paintOnion();

    canvas.setAttribute('data-sprite-id', String(model.sprite.id));
    canvas.setAttribute('data-frame', String(model.activeFrame));
    canvas.setAttribute('data-layer', model.activeLayer);
    canvas.setAttribute('data-zoom', String(model.zoom));
    canvas.setAttribute('data-cursor-x', String(model.cursor.x));
    canvas.setAttribute('data-cursor-y', String(model.cursor.y));
    canvas.setAttribute('data-seq', String(model.sprite.seq));
    canvas.setAttribute('data-composite-hash', hash);
    if (model.selection === null) canvas.removeAttribute('data-selection');
    else {
      const rect = model.selection;
      canvas.setAttribute('data-selection', `${rect.x},${rect.y},${rect.w},${rect.h}`);
    }
    if (model.floating === null) canvas.removeAttribute('data-floating');
    else {
      const rect = model.floating.rect;
      canvas.setAttribute('data-floating', `${rect.x},${rect.y},${rect.w},${rect.h}`);
    }
    if (flood === null) canvas.removeAttribute('data-flood-radius');
    else canvas.setAttribute('data-flood-radius', String(flood.radius));
    drawMarquee();
  };

  const paintOnion = (): void => {
    onion.width = canvas.width;
    onion.height = canvas.height;
    onion.style.width = canvas.style.width;
    onion.style.height = canvas.style.height;
    const context = onion.getContext('2d');
    if (context === null) return;
    context.clearRect(0, 0, onion.width, onion.height);
    if (!model.onionSkin) return;
    context.imageSmoothingEnabled = false;
    for (let back = model.onionFrames; back >= 1; back -= 1) {
      const number = model.activeFrame - back;
      if (number < 1) continue;
      const bytes = compositeOf(model, number);
      context.globalAlpha = 0.35 / back;
      for (let y = 0; y < model.sprite.height; y += 1) {
        for (let x = 0; x < model.sprite.width; x += 1) {
          const at = (y * model.sprite.width + x) * 4;
          if (bytes[at + 3] === 0) continue;
          context.fillStyle = `rgb(${bytes[at]},${bytes[at + 1]},${bytes[at + 2]})`;
          context.fillRect(x * model.zoom, y * model.zoom, model.zoom, model.zoom);
        }
      }
    }
    context.globalAlpha = 1;
  };

  const drawMarquee = (): void => {
    const rect = model.floating?.rect ?? model.selection;
    if (rect === null || rect === undefined) {
      marquee.hidden = true;
      return;
    }
    marquee.hidden = false;
    marquee.style.left = `${rect.x * model.zoom}px`;
    marquee.style.top = `${rect.y * model.zoom}px`;
    marquee.style.width = `${rect.w * model.zoom}px`;
    marquee.style.height = `${rect.h * model.zoom}px`;
  };

  const announceCursor = (): void => {
    const index =
      model.cels.get(model.activeFrame)?.get(model.activeLayer)?.[
        model.cursor.y * model.sprite.width + model.cursor.x
      ] ?? 0;
    ctx.announceStage(
      `Pixel ${model.cursor.x}, ${model.cursor.y}, ${colourText(model, index)}, layer ${model.activeLayer}`,
    );
  };

  const postCursor = (): void => {
    void api.post(`/api/sprites/${model.spriteId}/cursor`, {
      x: model.cursor.x,
      y: model.cursor.y,
      frame: model.activeFrame,
    });
  };

  const moveCursor = (x: number, y: number): void => {
    model.cursor = {
      x: Math.min(Math.max(x, 0), model.sprite.width - 1),
      y: Math.min(Math.max(y, 0), model.sprite.height - 1),
    };
    repaint();
    announceCursor();
    postCursor();
  };

  const cellFromEvent = (event: { clientX: number; clientY: number }): Point => {
    const box = canvas.getBoundingClientRect();
    return {
      x: Math.floor((event.clientX - box.left) / model.zoom),
      y: Math.floor((event.clientY - box.top) / model.zoom),
    };
  };

  const strokeOf = async (tool: StrokeTool, points: Point[]): Promise<void> => {
    const outcome = await sendStroke(model, { tool, points });
    repaint();
    ctx.afterStroke(outcome);
    ctx.refreshPanels();
  };

  const pickColour = (cell: Point): void => {
    const index =
      model.cels.get(model.activeFrame)?.get(model.activeLayer)?.[
        cell.y * model.sprite.width + cell.x
      ] ?? 0;
    model.primary = index;
    ctx.announceStage(`Picked swatch ${index}`);
    ctx.refreshPanels();
  };

  const applyAt = async (cell: Point): Promise<void> => {
    if (ctx.pinMode) {
      ctx.pinMode = false;
      ctx.openComment(cell.x, cell.y);
      return;
    }
    if (model.role === 'reviewer') {
      ctx.regions.alert("Reviewers can't draw");
      return;
    }
    if (model.tool === 'picker') {
      pickColour(cell);
      return;
    }
    if (model.tool === 'selection') {
      if (anchor === null) {
        anchor = cell;
        return;
      }
      const rect = {
        x: Math.min(anchor.x, cell.x),
        y: Math.min(anchor.y, cell.y),
        w: Math.abs(cell.x - anchor.x) + 1,
        h: Math.abs(cell.y - anchor.y) + 1,
      };
      anchor = null;
      model.selection = rect;
      ctx.announceStage(`Selection ${rect.w} by ${rect.h} at ${rect.x}, ${rect.y}`);
      repaint();
      return;
    }
    if (model.tool === 'line' || model.tool === 'rectangle' || model.tool === 'ellipse') {
      if (anchor === null) {
        anchor = cell;
        return;
      }
      const corners = [anchor, cell];
      anchor = null;
      await strokeOf(model.tool, corners);
      return;
    }
    await strokeOf(model.tool, [cell]);
  };

  const commitFloating = async (): Promise<void> => {
    const floating = model.floating;
    if (floating === null) return;
    model.floating = null;
    const outcome = await sendSelection(model, 'move', floating.origin, {
      x: floating.rect.x,
      y: floating.rect.y,
    });
    model.selection = { ...floating.rect };
    repaint();
    ctx.afterStroke(outcome);
    ctx.announceStage(`Selection placed at ${floating.rect.x}, ${floating.rect.y}`);
    ctx.refreshPanels();
  };

  const liftFloating = (): void => {
    if (model.selection === null) return;
    const rect = { ...model.selection };
    const cells = readRect(
      { width: model.sprite.width, height: model.sprite.height, indices: model.cels.get(model.activeFrame)?.get(model.activeLayer) ?? new Uint8Array(model.sprite.width * model.sprite.height) },
      rect,
    );
    model.floating = { rect, cells, origin: { ...rect } };
    ctx.announceStage(`Selection ${rect.w} by ${rect.h} at ${rect.x}, ${rect.y}`);
    repaint();
  };

  const moveFloating = (dx: number, dy: number): void => {
    const floating = model.floating;
    if (floating === null) return;
    const rect = floating.rect;
    rect.x = Math.min(Math.max(rect.x + dx, -(rect.w - 1)), model.sprite.width - 1);
    rect.y = Math.min(Math.max(rect.y + dy, -(rect.h - 1)), model.sprite.height - 1);
    ctx.announceStage(`Selection ${rect.w} by ${rect.h} at ${rect.x}, ${rect.y}`);
    repaint();
  };

  const onKey = async (event: KeyboardEvent): Promise<void> => {
    const key = event.key;
    if (key === 'Tab') {
      if (drawingMode) event.preventDefault();
      return;
    }
    if (key === 'Escape') {
      if (model.floating !== null) {
        model.floating = null;
        ctx.announceStage('Selection cancelled');
        repaint();
        event.preventDefault();
        return;
      }
      drawingMode = false;
      ctx.announceStage('Left drawing mode');
      event.preventDefault();
      return;
    }
    if (key === 'Enter') {
      if (model.floating !== null) {
        event.preventDefault();
        await commitFloating();
        return;
      }
      drawingMode = true;
      event.preventDefault();
      return;
    }
    if (key.startsWith('Arrow')) {
      event.preventDefault();
      const delta =
        key === 'ArrowLeft'
          ? { x: -1, y: 0 }
          : key === 'ArrowRight'
            ? { x: 1, y: 0 }
            : key === 'ArrowUp'
              ? { x: 0, y: -1 }
              : { x: 0, y: 1 };
      if (model.floating !== null) {
        moveFloating(delta.x, delta.y);
        return;
      }
      if (event.shiftKey && (model.tool === 'pencil' || model.tool === 'eraser')) {
        if (shiftRun === null) shiftRun = [{ ...model.cursor }];
        moveCursor(model.cursor.x + delta.x, model.cursor.y + delta.y);
        shiftRun.push({ ...model.cursor });
        return;
      }
      moveCursor(model.cursor.x + delta.x, model.cursor.y + delta.y);
      return;
    }
    if (key === ' ') {
      event.preventDefault();
      if (model.floating !== null) return;
      await applyAt({ ...model.cursor });
      announceCursor();
      return;
    }
    if (key === 'f' || key === 'F') {
      event.preventDefault();
      liftFloating();
    }
  };

  const onKeyUp = async (event: KeyboardEvent): Promise<void> => {
    if (event.key !== 'Shift' || shiftRun === null) return;
    const run = shiftRun;
    shiftRun = null;
    if (run.length < 2) return;
    await strokeOf(model.tool === 'eraser' ? 'eraser' : 'pencil', run);
  };

  canvas.addEventListener('keydown', (event) => void onKey(event));
  canvas.addEventListener('keyup', (event) => void onKeyUp(event));
  canvas.addEventListener('focus', () => {
    drawingMode = true;
    repaint();
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') return;
    canvas.focus();
    const cell = cellFromEvent(event);
    model.cursor = cell;
    if (model.tool === 'pencil' || model.tool === 'eraser') {
      drawing = true;
      samples = [cell];
      repaint();
      announceCursor();
      return;
    }
    if (model.tool === 'line' || model.tool === 'rectangle' || model.tool === 'ellipse' || model.tool === 'selection') {
      anchor = cell;
      drawing = true;
      repaint();
      return;
    }
    void applyAt(cell);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const cell = cellFromEvent(event);
    if (cell.x === model.cursor.x && cell.y === model.cursor.y) return;
    model.cursor = {
      x: Math.min(Math.max(cell.x, 0), model.sprite.width - 1),
      y: Math.min(Math.max(cell.y, 0), model.sprite.height - 1),
    };
    if (drawing && (model.tool === 'pencil' || model.tool === 'eraser')) samples.push({ ...model.cursor });
    repaint();
    announceCursor();
    postCursor();
  });

  const finishPointer = (event: PointerEvent): void => {
    if (!drawing) return;
    drawing = false;
    const cell = cellFromEvent(event);
    if (model.tool === 'pencil' || model.tool === 'eraser') {
      const points = samples.length > 0 ? samples : [cell];
      samples = [];
      void strokeOf(model.tool, points);
      return;
    }
    if (anchor === null) return;
    const start = anchor;
    anchor = null;
    if (model.tool === 'selection') {
      const rect = {
        x: Math.min(start.x, cell.x),
        y: Math.min(start.y, cell.y),
        w: Math.abs(cell.x - start.x) + 1,
        h: Math.abs(cell.y - start.y) + 1,
      };
      model.selection = rect;
      ctx.announceStage(`Selection ${rect.w} by ${rect.h} at ${rect.x}, ${rect.y}`);
      repaint();
      return;
    }
    if (model.tool === 'line' || model.tool === 'rectangle' || model.tool === 'ellipse') {
      void strokeOf(model.tool, [start, cell]);
    }
  };

  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerType === 'touch') return;
    finishPointer(event);
  });

  canvas.addEventListener('click', () => {
    if (!ctx.pinMode) return;
    ctx.pinMode = false;
    ctx.openComment(model.cursor.x, model.cursor.y);
  });

  canvas.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length > 1) {
        window.clearTimeout(longPress);
        drawing = false;
        samples = [];
        return;
      }
      const touch = event.touches[0];
      const cell = cellFromEvent(touch);
      model.cursor = cell;
      touchCells = 0;
      samples = [cell];
      drawing = true;
      repaint();
      longPress = window.setTimeout(() => {
        drawing = false;
        samples = [];
        pickColour(cell);
      }, Number(canvas.dataset.longPressMs ?? '500'));
      event.preventDefault();
    },
    { passive: false },
  );

  canvas.addEventListener(
    'touchmove',
    (event) => {
      if (!drawing || event.touches.length !== 1) return;
      const cell = cellFromEvent(event.touches[0]);
      if (cell.x === model.cursor.x && cell.y === model.cursor.y) return;
      window.clearTimeout(longPress);
      touchCells += 1;
      model.cursor = {
        x: Math.min(Math.max(cell.x, 0), model.sprite.width - 1),
        y: Math.min(Math.max(cell.y, 0), model.sprite.height - 1),
      };
      samples.push({ ...model.cursor });
      repaint();
      event.preventDefault();
    },
    { passive: false },
  );

  canvas.addEventListener('touchend', (event) => {
    window.clearTimeout(longPress);
    if (!drawing) return;
    drawing = false;
    const points = samples;
    samples = [];
    if (points.length === 0) return;
    void strokeOf(
      model.tool === 'eraser' ? 'eraser' : 'pencil',
      touchCells === 0 ? [points[0]] : points,
    );
    event.preventDefault();
  });

  const zoomRow = el('div', { class: 'row zoom-row' }, [
    button('Zoom in', () => {
      model.zoom = stepZoom(model.zoom, 1);
      repaint();
    }),
    button('Zoom out', () => {
      model.zoom = stepZoom(model.zoom, -1);
      repaint();
    }),
  ]);
  const panRow = el('div', { class: 'row pan-row' }, [
    button('Pan left', () => {
      viewport.scrollLeft -= model.zoom * 4;
    }),
    button('Pan right', () => {
      viewport.scrollLeft += model.zoom * 4;
    }),
    button('Pan up', () => {
      viewport.scrollTop -= model.zoom * 4;
    }),
    button('Pan down', () => {
      viewport.scrollTop += model.zoom * 4;
    }),
  ]);

  const node = el('div', { class: 'stage-wrap' }, [viewport, zoomRow, panRow]);

  return {
    node,
    canvas,
    repaint,
    setFlood: (next) => {
      flood = next;
      repaint();
    },
    focus: () => canvas.focus(),
    setCursors: (cursors) => {
      cursorRegion.replaceChildren(
        ...cursors.map((cursor) => {
          const mark = el('div', {
            class: 'live-cursor',
            'data-person': cursor.person,
            'data-x': String(cursor.x),
            'data-y': String(cursor.y),
            'data-frame': String(cursor.frame),
          });
          mark.style.left = `${cursor.x * model.zoom}px`;
          mark.style.top = `${cursor.y * model.zoom}px`;
          return mark;
        }),
      );
    },
    setPins: (pins) => {
      pinHost.replaceChildren(
        ...pins.map((pin) => {
          const mark = button(
            `Comment at ${pin.x}, ${pin.y}`,
            () => moveCursor(pin.x, pin.y),
            { class: 'pin', 'data-state': pin.state },
          );
          mark.style.left = `${pin.x * model.zoom}px`;
          mark.style.top = `${pin.y * model.zoom}px`;
          return mark;
        }),
      );
    },
  };
}

/** Hotkeys that work from any non-text workspace control. */
export function workspaceHotkey(ctx: Workspace, event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (target !== null) {
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' && (target as HTMLInputElement).type === 'text') return false;
    if (tag === 'textarea') return false;
    if (target.closest('[role="dialog"]') !== null) return false;
    if (
      target.closest('[aria-label="Tilemap"]') !== null &&
      ['h', 'v', 'c', 'H', 'V', 'C'].includes(event.key)
    ) {
      return false;
    }
  }
  const model = ctx.model;
  const lower = event.key.toLowerCase();
  if (TOOL_KEYS[lower] !== undefined) {
    model.tool = TOOL_KEYS[lower];
    ctx.announceStage(`Tool: ${TOOL_LABELS[model.tool]}`);
    ctx.refreshPanels();
    ctx.repaint();
    return true;
  }
  if (lower === 'm') {
    const at = MIRRORS.indexOf(model.mirror);
    model.mirror = MIRRORS[(at + 1) % MIRRORS.length];
    ctx.announceStage(`Mirror: ${model.mirror}`);
    ctx.refreshPanels();
    return true;
  }
  if (lower === 'x') {
    const held = model.primary;
    model.primary = model.secondary;
    model.secondary = held;
    ctx.announceStage('Swatches swapped');
    ctx.refreshPanels();
    return true;
  }
  if (event.key === '[' || event.key === ']') {
    model.brushSize = Math.min(Math.max(model.brushSize + (event.key === ']' ? 1 : -1), 1), 8);
    ctx.announceStage(`Brush size ${model.brushSize}`);
    ctx.refreshPanels();
    return true;
  }
  if (event.key === ',' || event.key === '.') {
    const next = model.activeFrame + (event.key === '.' ? 1 : -1);
    model.activeFrame = Math.min(Math.max(next, 1), model.sprite.frames.length);
    ctx.announceStage(`Frame ${model.activeFrame} of ${num(model.sprite.frames.length)}`);
    ctx.repaint();
    ctx.refreshPanels();
    return true;
  }
  if (lower === 'p') {
    model.pixelPerfect = !model.pixelPerfect;
    ctx.announceStage(model.pixelPerfect ? 'Pixel perfect on' : 'Pixel perfect off');
    ctx.refreshPanels();
    return true;
  }
  if (lower === 'c' && (event.target as HTMLElement | null)?.classList.contains('stage-canvas')) {
    ctx.openComment(model.cursor.x, model.cursor.y);
    return true;
  }
  return false;
}

export function motionStep(): boolean {
  return reducedMotion();
}
