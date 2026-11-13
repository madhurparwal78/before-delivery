import { clear, el } from '../dom.js';
import { reducedMotion } from '../shell.js';
import { type CellLight, drawLoupe, drawWall } from '../wall.js';

const TOUCH_CELL_PIXELS = 44;
const LOUPE_SPAN_POINTER = 9;
const LOUPE_SPAN_TOUCH = 5;
const SHIFT_STEP = 5;
const GLIDE_MILLISECONDS = 125;
const MARKER_STEP_METRES = 0.5;

function cellName(column: number, row: number): string {
  let letters = '';
  let remaining = column;
  while (remaining > 0) {
    const index = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + index) + letters;
    remaining = (remaining - 1 - index) / 26;
  }
  return `${letters}${row}`;
}

export function cellPosition(name: string, columns: number, rows: number): { column: number; row: number } | null {
  const parts = /^([A-Z]+)([1-9][0-9]*)$/.exec(name);
  if (parts === null) return null;
  let column = 0;
  for (const letter of parts[1] as string) column = column * 26 + (letter.charCodeAt(0) - 64);
  const row = Number(parts[2]);
  return column > columns || row > rows ? null : { column, row };
}

interface MarkedPlacement {
  readonly id: string;
  readonly aimAcross: string;
  readonly aimDown: string;
}

interface WallGeometry {
  readonly columns: number;
  readonly rows: number;
  readonly widthMetres: number;
  readonly heightMetres: number;
}

interface WallHandlers {
  /** Runs after the frame has moved and relit: the sentence, the address and the announcement follow. */
  readonly arrived: (cell: string) => void;
  readonly shortcut: (key: 'place' | 'full') => void;
  readonly aimMoved: (placement: MarkedPlacement, across: string, down: string) => void;
}

interface WallView {
  readonly region: HTMLElement;
  readonly grid: HTMLElement;
  readonly caption: HTMLElement;
  readonly loupeSpan: () => number;
  readonly current: () => string | null;
  readonly setCells: (cells: readonly CellLight[]) => void;
  readonly setMarkers: (placements: readonly MarkedPlacement[]) => void;
  readonly arrive: (name: string) => void;
  readonly settle: (name: string | null) => void;
  readonly focusGrid: () => void;
  readonly stop: () => void;
}

/** The wall region: the dim wall, its APG grid, the show-night loupe, and the touch pan beneath a fixed loupe. */
export function createWallView(geometry: WallGeometry, handlers: WallHandlers): WallView {
  const { columns, rows } = geometry;
  const touchQuery = window.matchMedia('(max-width: 767px)');
  let touch = touchQuery.matches;
  let cells: readonly CellLight[] = [];
  let current: string | null = null;
  let offset = { x: 0, y: 0 };

  const backing = Math.max(6, Math.min(24, Math.floor(4096 / columns)));
  const wallCanvas = el('canvas', { class: 'wall', width: columns * backing, height: rows * backing });
  const loupeCanvas = el('canvas', { width: 320, height: 100 });
  const loupe = el('span', { class: 'loupe', role: 'img', 'aria-label': 'Show-night loupe' }, [loupeCanvas]);
  const grid = el('div', {
    class: 'cells',
    role: 'grid',
    'aria-label': 'Wall cells',
    'aria-rowcount': rows,
    'aria-colcount': columns,
  });
  grid.style.setProperty('--columns', String(columns));
  grid.style.setProperty('--rows', String(rows));
  const markers = el('div', { class: 'markers' });
  const panner = el('div', { class: 'wall-pan' }, [wallCanvas, grid, markers]);
  const caption = el('p', { class: 'caption', role: 'status', 'aria-label': 'Cell reading' });
  const region = el('div', { class: 'wall-region', role: 'region', 'aria-label': 'Wall' }, [panner, loupe, caption]);

  const html: string[] = [];
  for (let row = 1; row <= rows; row += 1) {
    html.push(`<div role="row" aria-rowindex="${row}">`);
    for (let column = 1; column <= columns; column += 1) {
      const index = (row - 1) * columns + column - 1;
      html.push(
        `<div role="gridcell" aria-colindex="${column}" aria-label="${cellName(column, row)}" data-i="${index}" tabindex="${index === 0 ? 0 : -1}"></div>`,
      );
    }
    html.push('</div>');
  }
  grid.innerHTML = html.join('');
  const nodes = [...grid.querySelectorAll<HTMLElement>('[role="gridcell"]')];

  const cellSize = (): number => (touch ? TOUCH_CELL_PIXELS : Math.max(4, region.clientWidth / columns));
  const frame = (): { width: number; height: number } => ({
    width: region.clientWidth,
    height: touch ? region.clientHeight : cellSize() * rows,
  });

  const paintLoupe = (): void => {
    drawLoupe(loupeCanvas, { columns, rows, cells, cell: current, span: touch ? LOUPE_SPAN_TOUCH : LOUPE_SPAN_POINTER });
  };

  const centreOn = (column: number, row: number): void => {
    const size = cellSize();
    const view = frame();
    offset = {
      x: Math.min(view.width / 2, Math.max(view.width / 2 - columns * size, view.width / 2 - (column - 0.5) * size)),
      y: Math.min(view.height / 2, Math.max(view.height / 2 - rows * size, view.height / 2 - (row - 0.5) * size)),
    };
    panner.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
  };

  let loupeAt = { x: 0, y: 0 };
  let gliding = 0;
  /** The frame glides to the cell in an eighth of a second, quick at first and soft at the end; it jumps under reduced motion. */
  const placeLoupe = (column: number, row: number, immediate = false): void => {
    if (touch) return;
    const size = cellSize();
    const view = frame();
    const target = {
      x: Math.min(view.width - loupe.offsetWidth, Math.max(0, (column - 0.5) * size - loupe.offsetWidth / 2)),
      y: Math.min(view.height - loupe.offsetHeight, Math.max(0, (row - 0.5) * size - loupe.offsetHeight / 2)),
    };
    cancelAnimationFrame(gliding);
    const from = loupeAt;
    const set = (x: number, y: number): void => {
      loupeAt = { x, y };
      loupe.style.transform = `translate(${x}px, ${y}px)`;
    };
    if (immediate || reducedMotion()) {
      set(target.x, target.y);
      return;
    }
    const started = performance.now();
    const step = (): void => {
      const progress = Math.min(1, (performance.now() - started) / GLIDE_MILLISECONDS);
      const eased = 1 - (1 - progress) ** 3;
      set(from.x + (target.x - from.x) * eased, from.y + (target.y - from.y) * eased);
      if (progress < 1) gliding = requestAnimationFrame(step);
    };
    gliding = requestAnimationFrame(step);
  };

  const layoutWall = (): void => {
    touch = touchQuery.matches;
    region.classList.toggle('touch', touch);
    const size = cellSize();
    panner.style.width = `${size * columns}px`;
    panner.style.height = `${size * rows}px`;
    loupe.style.transform = '';
    loupeAt = { x: 0, y: 0 };
    const position = current === null ? null : cellPosition(current, columns, rows);
    const target = position ?? { column: Math.ceil(columns / 2), row: Math.ceil(rows / 2) };
    if (touch) centreOn(target.column, target.row);
    else {
      panner.style.transform = '';
      placeLoupe(target.column, target.row, true);
    }
    paintLoupe();
  };

  const rovingFocus = (name: string): void => {
    const position = cellPosition(name, columns, rows);
    if (position === null) return;
    for (const node of nodes) if (node.tabIndex === 0) node.tabIndex = -1;
    (nodes[(position.row - 1) * columns + position.column - 1] as HTMLElement).tabIndex = 0;
  };

  /** The glide, then the relight; the caller's callback carries the rest of the sequence. */
  const arrive = (name: string): void => {
    const position = cellPosition(name, columns, rows);
    if (position === null || name === current) return;
    current = name;
    placeLoupe(position.column, position.row);
    paintLoupe();
    handlers.arrived(name);
  };

  const focusAt = (column: number, row: number): void => {
    const clampedColumn = Math.max(1, Math.min(columns, column));
    const clampedRow = Math.max(1, Math.min(rows, row));
    rovingFocus(cellName(clampedColumn, clampedRow));
    nodes[(clampedRow - 1) * columns + clampedColumn - 1]?.focus();
  };

  grid.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement;
    if (target.getAttribute('role') !== 'gridcell') return;
    arrive(target.getAttribute('aria-label') as string);
  });
  grid.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.getAttribute('role') !== 'gridcell') return;
    const index = Number(target.dataset['i']);
    focusAt((index % columns) + 1, Math.floor(index / columns) + 1);
  });
  grid.addEventListener('pointermove', (event) => {
    if (touch || (event.pointerType === 'touch' && event.buttons === 0)) return;
    const box = grid.getBoundingClientRect();
    const column = Math.floor(((event.clientX - box.left) / box.width) * columns) + 1;
    const row = Math.floor(((event.clientY - box.top) / box.height) * rows) + 1;
    if (column < 1 || column > columns || row < 1 || row > rows) return;
    arrive(cellName(column, row));
  });

  grid.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (target.getAttribute('role') !== 'gridcell') return;
    const index = Number(target.dataset['i']);
    const column = (index % columns) + 1;
    const row = Math.floor(index / columns) + 1;
    const step = event.shiftKey ? SHIFT_STEP : 1;
    const arrows: Record<string, [number, number]> = {
      ArrowRight: [step, 0],
      ArrowLeft: [-step, 0],
      ArrowDown: [0, step],
      ArrowUp: [0, -step],
    };
    const move = arrows[event.key];
    if (move !== undefined) {
      event.preventDefault();
      focusAt(column + move[0], row + move[1]);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAt(1, event.ctrlKey ? 1 : row);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAt(columns, event.ctrlKey ? rows : row);
    }
  });

  region.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'p' && key !== 'f') return;
    event.preventDefault();
    handlers.shortcut(key === 'p' ? 'place' : 'full');
  });

  let drag: { x: number; y: number; from: { x: number; y: number } } | null = null;
  const underLoupe = (): string => {
    const size = cellSize();
    const view = frame();
    const column = Math.max(1, Math.min(columns, Math.floor((view.width / 2 - offset.x) / size) + 1));
    const row = Math.max(1, Math.min(rows, Math.floor((view.height / 2 - offset.y) / size) + 1));
    return cellName(column, row);
  };
  region.addEventListener(
    'touchstart',
    (event) => {
      const point = event.touches[0];
      if (!touch || point === undefined || (event.target as HTMLElement).classList.contains('aim-marker')) return;
      drag = { x: point.clientX, y: point.clientY, from: offset };
    },
    { passive: true },
  );
  region.addEventListener(
    'touchmove',
    (event) => {
      const point = event.touches[0];
      if (drag === null || point === undefined) return;
      event.preventDefault();
      const size = cellSize();
      const view = frame();
      offset = {
        x: Math.min(view.width / 2, Math.max(view.width / 2 - columns * size, drag.from.x + point.clientX - drag.x)),
        y: Math.min(view.height / 2, Math.max(view.height / 2 - rows * size, drag.from.y + point.clientY - drag.y)),
      };
      panner.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
      arrive(underLoupe());
    },
    { passive: false },
  );
  const endDrag = (): void => {
    if (drag === null) return;
    drag = null;
    const position = current === null ? null : cellPosition(current, columns, rows);
    if (position !== null) centreOn(position.column, position.row);
  };
  region.addEventListener('touchend', endDrag);
  region.addEventListener('touchcancel', endDrag);

  const observer = new ResizeObserver(layoutWall);
  observer.observe(region);
  touchQuery.addEventListener('change', layoutWall);

  return {
    region,
    grid,
    caption,
    loupeSpan: () => (touch ? LOUPE_SPAN_TOUCH : LOUPE_SPAN_POINTER),
    current: () => current,
    setCells: (next) => {
      cells = next;
      drawWall(wallCanvas, { columns, rows, cells, mode: 'dim' });
      paintLoupe();
    },
    setMarkers: (placements) => {
      clear(markers);
      for (const placement of placements) markers.appendChild(marker(placement, geometry, panner, handlers));
    },
    arrive,
    settle: (name) => {
      current = name;
      const position = name === null ? null : cellPosition(name, columns, rows);
      if (name !== null && position !== null) rovingFocus(name);
      layoutWall();
    },
    focusGrid: () => {
      const roving = nodes.find((node) => node.tabIndex === 0);
      (roving ?? nodes[0])?.focus();
    },
    stop: () => {
      observer.disconnect();
      touchQuery.removeEventListener('change', layoutWall);
    },
  };
}

/** Dragging an aim marker moves it on the same half-metre steps the spinbuttons use. */
function marker(placement: MarkedPlacement, geometry: WallGeometry, panner: HTMLElement, handlers: WallHandlers): HTMLElement {
  const node = el('span', { class: 'aim-marker', 'aria-hidden': 'true', 'data-placement': placement.id });
  const put = (across: number, down: number): void => {
    node.style.left = `${(across / geometry.widthMetres) * 100}%`;
    node.style.top = `${(down / geometry.heightMetres) * 100}%`;
  };
  put(Number(placement.aimAcross), Number(placement.aimDown));
  let landed: { across: number; down: number } | null = null;
  let dragged = false;
  node.addEventListener('pointerdown', (event) => {
    landed = { across: Number(placement.aimAcross), down: Number(placement.aimDown) };
    dragged = false;
    node.setPointerCapture(event.pointerId);
  });
  node.addEventListener('pointermove', (event) => {
    if (landed === null) return;
    const box = panner.getBoundingClientRect();
    landed = {
      across: Math.round((((event.clientX - box.left) / box.width) * geometry.widthMetres) / MARKER_STEP_METRES) * MARKER_STEP_METRES,
      down: Math.round((((event.clientY - box.top) / box.height) * geometry.heightMetres) / MARKER_STEP_METRES) * MARKER_STEP_METRES,
    };
    put(landed.across, landed.down);
    dragged = dragged || landed.across !== Number(placement.aimAcross) || landed.down !== Number(placement.aimDown);
  });
  node.addEventListener('pointerup', () => {
    if (landed === null) return;
    const { across, down } = landed;
    landed = null;
    if (dragged) handlers.aimMoved(placement, String(across), String(down));
  });
  // A press that moves nothing is a press on the cell under the marker.
  node.addEventListener('click', (event) => {
    if (dragged) return;
    const cell = document.elementsFromPoint(event.clientX, event.clientY).find((under) => under.getAttribute('role') === 'gridcell');
    (cell as HTMLElement | undefined)?.click();
  });
  return node;
}
