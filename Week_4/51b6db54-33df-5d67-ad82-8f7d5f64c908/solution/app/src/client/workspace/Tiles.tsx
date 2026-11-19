import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { api, refusal } from '../api';
import { clearAlerts, Dialog, EmptyState, raise } from '../ui';
import { parseColour } from '../../shared/colour';
import { flipRows, flipStamp, type MapCell, type StampCell } from '../../shared/tiles';
import type { TilemapInfo, TilesetInfo } from '../../shared/types';
import type { Model } from './model';
import { useModel } from './use-model';

function TileCanvas({ m, rows, flipH = false, flipV = false, size }: { m: Model; rows: number[][]; flipH?: boolean; flipV?: boolean; size: number }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ref.current || !ctx) return;
    ctx.clearRect(0, 0, size, size);
    flipRows(rows, flipH, flipV).forEach((row, y) =>
      row.forEach((index, x) => {
        if (index === 0) return;
        const [r, g, b, a] = parseColour(m.colourAt(index));
        ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
        ctx.fillRect(x, y, 1, 1);
      }),
    );
  });
  return <canvas ref={ref} class="tile-canvas" width={size} height={size} />;
}

const cellText = (cell: MapCell | undefined, x: number, y: number): string =>
  `Cell ${x}, ${y}, tile ${cell?.tile ?? 0}${cell?.flip_h ? ', flip H' : ''}${cell?.flip_v ? ', flip V' : ''}`;

function TileEditor({ m, set, number, onClose }: { m: Model; set: TilesetInfo; number: number; onClose: () => void }): JSX.Element {
  const size = set.tile_size;
  const [rows, setRows] = useState<number[][]>(() => (set.tiles[number - 1] ?? []).map((row) => [...row]));
  const [at, setAt] = useState<[number, number]>([0, 0]);
  const ref = useRef<HTMLCanvasElement>(null);
  const cell = size === 8 ? 24 : 16;
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ref.current || !ctx) return;
    ctx.clearRect(0, 0, ref.current.width, ref.current.height);
    rows.forEach((row, y) =>
      row.forEach((index, x) => {
        const [r, g, b, a] = parseColour(m.colourAt(index));
        ctx.fillStyle = index === 0 ? ((x + y) % 2 === 0 ? '#1c1c22' : '#26262d') : `rgba(${r},${g},${b},${a / 255})`;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }),
    );
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(at[0] * cell + 1, at[1] * cell + 1, cell - 2, cell - 2);
  }, [rows, at]);
  const paint = (x: number, y: number): void => setRows((current) => current.map((row, ry) => (ry === y ? row.map((v, rx) => (rx === x ? m.primary : v)) : row)));
  const onKeyDown = (event: KeyboardEvent): void => {
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = step[event.key];
    if (move) {
      event.preventDefault();
      setAt([Math.max(0, Math.min(size - 1, at[0] + move[0])), Math.max(0, Math.min(size - 1, at[1] + move[1]))]);
    } else if (event.key === ' ') {
      event.preventDefault();
      paint(at[0], at[1]);
    }
  };
  const save = async (): Promise<void> => {
    const result = await api('PATCH', `/api/tilesets/${set.id}/tiles/${number}`, { rows });
    if (!result.ok) return raise(refusal(result).message);
    onClose();
  };
  return (
    <Dialog label="Edit tile" onClose={onClose}>
      <div class="stack">
        <h2>Edit tile {number}</h2>
        <canvas
          ref={ref}
          class="tile-editor"
          role="application"
          aria-label="Tile editor"
          tabIndex={0}
          width={size * cell}
          height={size * cell}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            const box = (event.currentTarget as HTMLCanvasElement).getBoundingClientRect();
            const x = Math.max(0, Math.min(size - 1, Math.floor(((event.clientX - box.left) / box.width) * size)));
            const y = Math.max(0, Math.min(size - 1, Math.floor(((event.clientY - box.top) / box.height) * size)));
            setAt([x, y]);
            paint(x, y);
          }}
        />
        <div class="row">
          <button type="button" class="pill" onClick={() => void save()}>
            Save tile
          </button>
          <button type="button" class="pill ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function Tiles({ m }: { m: Model }): JSX.Element {
  useModel(m);
  const set = m.tilesets.find((t) => t.id === m.tilesetId);
  const map: TilemapInfo | undefined = m.tilemaps.find((t) => t.id === m.tilemapId);
  const [tileSize, setTileSize] = useState(8);
  const [edgeText, setEdgeText] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<[number, number]>([0, 0]);
  const [mark, setMark] = useState<{ x: number; y: number } | null>(null);
  const [stamp, setStamp] = useState<StampCell[][] | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const wantFocus = useRef(false);
  useLayoutEffect(() => setEdgeText(set ? set.edge_table.join(', ') : ''), [set?.id, set?.edge_table.join(',')]);
  useLayoutEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-x="${focus[0]}"][data-y="${focus[1]}"]`)?.focus();
  });

  const guard = (): boolean => {
    if (m.online) return true;
    raise('You are offline');
    return false;
  };

  const fail = (result: Parameters<typeof refusal>[0]): void => {
    const { message, fields } = refusal(result);
    setErrors(fields);
    raise(message);
  };

  const cellAt = (x: number, y: number): MapCell | undefined => map?.cells.find((c) => c.x === x && c.y === y);
  const uses = (n: number): number => m.counts.uses[m.tilesetId]?.[n] ?? 0;

  const place = async (x: number, y: number, erase: boolean): Promise<void> => {
    if (!map || !guard()) return;
    clearAlerts();
    const result = await api<{ changed: MapCell[] }>('POST', `/api/tilemaps/${map.id}/cells`, {
      x,
      y,
      tile: erase ? 0 : m.tileNumber,
      flip_h: false,
      flip_v: false,
      edge_matching: m.edgeMatching,
    });
    if (!result.ok) return fail(result);
    const done = result.body.changed.find((c) => c.x === x && c.y === y);
    m.announce(cellText(done ?? { x, y, tile: 0, flip_h: false, flip_v: false }, x, y));
  };

  const flip = async (x: number, y: number, axis: 'h' | 'v'): Promise<void> => {
    const cell = cellAt(x, y);
    if (!map || !cell || !guard()) return;
    const next = { flip_h: axis === 'h' ? !cell.flip_h : cell.flip_h, flip_v: axis === 'v' ? !cell.flip_v : cell.flip_v };
    const result = await api('PATCH', `/api/tilemaps/${map.id}/cells/${x}/${y}`, next);
    if (!result.ok) return fail(result);
    m.announce(cellText({ ...cell, ...next }, x, y));
  };

  const putStamp = async (x: number, y: number): Promise<void> => {
    if (!map || !stamp || !guard()) return;
    const result = await api('POST', `/api/tilemaps/${map.id}/stamp`, { x, y, cells: stamp });
    if (!result.ok) return fail(result);
    m.announce(`Stamped ${stamp[0]?.length ?? 0} by ${stamp.length} at ${x}, ${y}`);
  };

  const copyStamp = (x: number, y: number): void => {
    if (!mark) return;
    const [x0, x1] = [Math.min(mark.x, x), Math.max(mark.x, x)];
    const [y0, y1] = [Math.min(mark.y, y), Math.max(mark.y, y)];
    const rowsOut: StampCell[][] = [];
    for (let row = y0; row <= y1; row++) {
      const line: StampCell[] = [];
      for (let col = x0; col <= x1; col++) {
        const cell = cellAt(col, row);
        line.push({ tile: cell?.tile ?? 0, flip_h: cell?.flip_h ?? false, flip_v: cell?.flip_v ?? false });
      }
      rowsOut.push(line);
    }
    setStamp(rowsOut);
    setMark(null);
    m.announce(`Stamp ${rowsOut[0]?.length ?? 0} by ${rowsOut.length}`);
  };

  const onCellKey = (event: KeyboardEvent, x: number, y: number): void => {
    if (!map) return;
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = step[event.key];
    if (move) {
      event.preventDefault();
      const next: [number, number] = [Math.max(0, Math.min(map.width - 1, x + move[0])), Math.max(0, Math.min(map.height - 1, y + move[1]))];
      if (event.shiftKey && m.canEdit) setMark(mark ?? { x, y });
      else setMark(null);
      wantFocus.current = true;
      setFocus(next);
      return;
    }
    if (!m.canEdit) return;
    const key = event.key.toLowerCase();
    if (event.key === 'Enter') {
      event.preventDefault();
      void (stamp ? putStamp(x, y) : place(x, y, false));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      void place(x, y, true);
    } else if (key === 'h' || key === 'v') {
      event.preventDefault();
      if (stamp) setStamp(flipStamp(stamp, key));
      else void flip(x, y, key);
    } else if (key === 'c' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      copyStamp(x, y);
    } else if (event.key === 'Escape' && stamp) {
      event.stopPropagation();
      setStamp(null);
    }
  };

  const createTileset = async (): Promise<void> => {
    if (!guard()) return;
    const result = await api<{ id: number }>('POST', `/api/sprites/${m.spriteId}/tilesets`, { name: `Tileset ${m.tilesets.length + 1}`, tile_size: tileSize });
    if (!result.ok) return fail(result);
    m.tilesetId = result.body.id;
    m.tilemapId = 0;
    m.tileNumber = 1;
    m.changed();
  };

  const createMap = async (): Promise<void> => {
    if (!set || !guard()) return;
    const result = await api<{ id: number }>('POST', `/api/sprites/${m.spriteId}/tilemaps`, { name: `Map ${m.tilemaps.length + 1}`, tileset: set.id, width: 12, height: 8 });
    if (!result.ok) return fail(result);
    m.tilemapId = result.body.id;
    m.changed();
  };

  const importFrame = async (): Promise<void> => {
    if (!set || !guard() || !m.layer) return;
    clearAlerts();
    const result = await api('POST', `/api/tilesets/${set.id}/import`, { frame: m.frameNumber, layer: m.layer.name, ...(map ? { tilemap: map.id } : {}) });
    if (!result.ok) fail(result);
  };

  const saveEdges = async (): Promise<void> => {
    if (!set || !guard()) return;
    clearAlerts();
    const table = edgeText.split(/[\s,]+/).filter(Boolean).map(Number);
    const result = await api('PATCH', `/api/tilesets/${set.id}/edges`, { table });
    if (!result.ok) fail(result);
    else setErrors({});
  };

  const marked = (x: number, y: number): boolean => {
    if (!mark) return false;
    return x >= Math.min(mark.x, focus[0]) && x <= Math.max(mark.x, focus[0]) && y >= Math.min(mark.y, focus[1]) && y <= Math.max(mark.y, focus[1]);
  };

  const cellsOut: JSX.Element[] = [];
  if (map) {
    for (let y = 0; y < map.height; y++) {
      const cols: JSX.Element[] = [];
      for (let x = 0; x < map.width; x++) {
        const cell = cellAt(x, y);
        const tile = cell && cell.tile > 0 ? set?.tiles[cell.tile - 1] : undefined;
        cols.push(
          <div
            key={x}
            role="gridcell"
            class="map-cell"
            data-x={x}
            data-y={y}
            data-tile={cell?.tile ?? 0}
            data-flip-h={String(cell?.flip_h ?? false)}
            data-flip-v={String(cell?.flip_v ?? false)}
            data-marked={marked(x, y) || undefined}
            tabIndex={focus[0] === x && focus[1] === y ? 0 : -1}
            onFocus={() => {
              setFocus([x, y]);
              m.announce(cellText(cell, x, y));
            }}
            onKeyDown={(event) => onCellKey(event, x, y)}
            onClick={(event) => (event.currentTarget as HTMLElement).focus()}
          >
            {tile && set && <TileCanvas m={m} rows={tile} flipH={cell?.flip_h} flipV={cell?.flip_v} size={set.tile_size} />}
          </div>,
        );
      }
      cellsOut.push(
        <div role="row" class="map-row" key={y} aria-rowindex={y + 1}>
          {cols}
        </div>,
      );
    }
  }

  return (
    <section class="panel orange" aria-label="Tiles">
      <h2 class="panel-title">Tiles</h2>
      <div class="panel-body">
        {!set ? (
          <EmptyState text="No tiles yet" />
        ) : (
          <div role="listbox" aria-label="Tiles" class="tile-list">
            {set.tiles.map((rows, i) => (
              <div
                key={i}
                role="option"
                aria-label={`Tile ${i + 1}`}
                aria-selected={m.tileNumber === i + 1}
                class="tile-option"
                tabIndex={m.tileNumber === i + 1 ? 0 : -1}
                onClick={() => {
                  m.tileNumber = i + 1;
                  m.changed();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    m.tileNumber = i + 1;
                    m.changed();
                  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    (event.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
                  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    (event.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
                  }
                }}
              >
                <TileCanvas m={m} rows={rows} size={set.tile_size} />
                <span class="small">Used {m.plural(uses(i + 1), 'time')}</span>
              </div>
            ))}
          </div>
        )}
        {map && (
          <div role="grid" aria-label="Tilemap" aria-rowcount={map.height} aria-colcount={map.width} class="map-grid" data-stamp={stamp ? `${stamp[0]?.length ?? 0},${stamp.length}` : undefined} ref={gridRef}>
            {cellsOut}
          </div>
        )}
        {m.canEdit && (
          <div class="controls">
            <label class="check">
              <input type="checkbox" checked={m.edgeMatching} onChange={(event) => { m.edgeMatching = (event.currentTarget as HTMLInputElement).checked; m.changed(); }} />
              Edge matching
            </label>
            <div class="row">
              <label class="field-label compact">
                Tile size
                <select class="input" value={tileSize} onChange={(event) => setTileSize(Number((event.currentTarget as HTMLSelectElement).value))}>
                  <option value={8}>8</option>
                  <option value={16}>16</option>
                </select>
              </label>
              <button type="button" class="pill" onClick={() => void createTileset()}>
                New tileset
              </button>
              <button type="button" class="pill" disabled={!set} onClick={() => void createMap()}>
                New tilemap
              </button>
            </div>
            <div class="row">
              <button type="button" class="pill" disabled={!set} onClick={() => void importFrame()}>
                Import frame as tiles
              </button>
              <button type="button" class="pill" disabled={!set || set.tiles.length === 0} onClick={() => { m.tileEditorOpen = true; m.changed(); }}>
                Edit tile
              </button>
            </div>
            {set && (
              <>
                <label class="field-label">
                  Edge table
                  <input class="input mono" type="text" value={edgeText} onInput={(event) => setEdgeText((event.currentTarget as HTMLInputElement).value)} />
                </label>
                {errors.table && <p class="field-error">{errors.table}</p>}
                <button type="button" class="pill" onClick={() => void saveEdges()}>
                  Save edge table
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {m.tileEditorOpen && set && <TileEditor m={m} set={set} number={m.tileNumber} onClose={() => { m.tileEditorOpen = false; m.changed(); }} />}
    </section>
  );
}
