import { api, refusalText, type ApiFailure } from '../../api.js';
import {
  button,
  checkbox,
  clear,
  combobox,
  el,
  field,
  keepingFocus,
  textbox,
  trapDialog,
} from '../../dom.js';
import { num } from '../../session.js';
import type { Workspace } from '../context.js';
import { colourText } from '../model.js';
import type { Panel } from './palette.js';

interface TileView {
  id: number;
  rows: number[][];
  uses: number;
}

interface TilesetView {
  id: number;
  name: string;
  tile_size: number;
  edge_table: number[];
  tiles: TileView[];
}

interface TilemapView {
  id: number;
  name: string;
  tileset: number;
  width: number;
  height: number;
  cells: { x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }[];
}

interface StampCell {
  tile: number;
  flip_h: boolean;
  flip_v: boolean;
}

/** The Tiles panel: tilesets, the map grid, edge matching and stamps. */
export function tilesPanel(ctx: Workspace): Panel {
  const listbox = el('div', { role: 'listbox', 'aria-label': 'Tiles', class: 'tile-list' });
  const grid = el('div', { role: 'grid', 'aria-label': 'Tilemap', class: 'tilemap-grid' });
  const edgeMatching = checkbox('Edge matching', false);
  const tileSize = combobox('Tile size', [
    { value: '8', label: '8' },
    { value: '16', label: '16' },
  ]);
  const edgeTableInput = textbox('Edge table');

  let tileset: TilesetView | null = null;
  let tilemap: TilemapView | null = null;
  let selectedTile = 1;
  let focusCell = { x: 0, y: 0 };
  let marked: { x: number; y: number } | null = null;
  let stamp: StampCell[][] | null = null;

  const cellKey = (x: number, y: number): string => `${x},${y}`;

  const focusMapCell = (): void => {
    const node = grid.querySelector(
      `[data-x="${focusCell.x}"][data-y="${focusCell.y}"]`,
    ) as HTMLElement | null;
    node?.focus();
  };

  const announceCell = (x: number, y: number): void => {
    const cell = tilemap?.cells.find((entry) => entry.x === x && entry.y === y);
    let text = `Cell ${x}, ${y}, tile ${cell?.tile ?? 0}`;
    if (cell?.flip_h === true) text += ', flip H';
    if (cell?.flip_v === true) text += ', flip V';
    ctx.announceStage(text);
  };

  let loadToken = 0;
  const load = async (): Promise<void> => {
    const model = ctx.model;
    const token = loadToken + 1;
    loadToken = token;
    const tilesetId = model.sprite.tilesets[0];
    const tilemapId = model.sprite.tilemaps[0];
    let freshTileset: TilesetView | null = null;
    let freshTilemap: TilemapView | null = null;
    if (tilesetId !== undefined) {
      const result = await api.get<TilesetView>(`/api/tilesets/${tilesetId}`);
      if (result.ok) freshTileset = result.body;
    }
    if (tilemapId !== undefined) {
      const result = await api.get<TilemapView>(`/api/tilemaps/${tilemapId}`);
      if (result.ok) freshTilemap = result.body;
    }
    if (token !== loadToken) return;
    tileset = freshTileset;
    tilemap = freshTilemap;
    draw();
  };

  const placeAt = async (x: number, y: number, tile: number): Promise<void> => {
    if (tilemap === null) return;
    const result = await api.post<ApiFailure>(`/api/tilemaps/${tilemap.id}/cells`, {
      x,
      y,
      tile,
      flip_h: false,
      flip_v: false,
      edge_matching: edgeMatching.checked,
    });
    if (!result.ok) {
      ctx.regions.alert(refusalText(result));
      return;
    }
    await load();
    focusMapCell();
    announceCell(x, y);
    ctx.refreshPanels();
  };

  const flipAt = async (x: number, y: number, axis: 'h' | 'v'): Promise<void> => {
    if (tilemap === null) return;
    const cell = tilemap.cells.find((entry) => entry.x === x && entry.y === y);
    if (cell === undefined) return;
    const result = await api.patch<ApiFailure>(`/api/tilemaps/${tilemap.id}/cells/${x}/${y}`, {
      flip_h: axis === 'h' ? !cell.flip_h : cell.flip_h,
      flip_v: axis === 'v' ? !cell.flip_v : cell.flip_v,
    });
    if (!result.ok) {
      ctx.regions.alert(refusalText(result));
      return;
    }
    await load();
    focusMapCell();
    announceCell(x, y);
  };

  const copyStamp = (): void => {
    if (tilemap === null || marked === null) return;
    const x0 = Math.min(marked.x, focusCell.x);
    const x1 = Math.max(marked.x, focusCell.x);
    const y0 = Math.min(marked.y, focusCell.y);
    const y1 = Math.max(marked.y, focusCell.y);
    const rows: StampCell[][] = [];
    for (let y = y0; y <= y1; y += 1) {
      const row: StampCell[] = [];
      for (let x = x0; x <= x1; x += 1) {
        const cell = tilemap.cells.find((entry) => entry.x === x && entry.y === y);
        row.push({
          tile: cell?.tile ?? 0,
          flip_h: cell?.flip_h ?? false,
          flip_v: cell?.flip_v ?? false,
        });
      }
      rows.push(row);
    }
    stamp = rows;
    grid.setAttribute('data-stamp', `${x1 - x0 + 1},${y1 - y0 + 1}`);
    ctx.announceStage(`Stamp ${x1 - x0 + 1} by ${y1 - y0 + 1}`);
  };

  const mirrorStamp = (axis: 'h' | 'v'): void => {
    if (stamp === null) return;
    if (axis === 'h') {
      stamp = stamp.map((row) =>
        [...row].reverse().map((cell) => ({ ...cell, flip_h: !cell.flip_h })),
      );
      return;
    }
    stamp = [...stamp].reverse().map((row) => row.map((cell) => ({ ...cell, flip_v: !cell.flip_v })));
  };

  const placeStamp = async (): Promise<void> => {
    if (tilemap === null || stamp === null) return;
    const width = stamp[0]?.length ?? 0;
    const height = stamp.length;
    const result = await api.post<ApiFailure>(`/api/tilemaps/${tilemap.id}/stamp`, {
      x: focusCell.x,
      y: focusCell.y,
      cells: stamp,
    });
    if (!result.ok) {
      ctx.regions.alert(refusalText(result));
      return;
    }
    ctx.announceStage(`Stamped ${width} by ${height} at ${focusCell.x}, ${focusCell.y}`);
    stamp = null;
    marked = null;
    grid.removeAttribute('data-stamp');
    await load();
    focusMapCell();
  };

  const draw = (): void => {
    keepingFocus(grid, () => drawNow(), focusMapCell);
  };

  const drawNow = (): void => {
    const model = ctx.model;
    clear(listbox);
    for (const tile of tileset?.tiles ?? []) {
      const option = el('div', {
        role: 'option',
        'aria-label': `Tile ${tile.id}`,
        'aria-selected': tile.id === selectedTile ? 'true' : 'false',
        class: 'tile-row',
        tabindex: '-1',
      });
      const preview = el('canvas', { class: 'tile-preview', width: 32, height: 32 });
      const context = preview.getContext('2d');
      if (context !== null) {
        const size = tileset?.tile_size ?? 8;
        const cell = 32 / size;
        context.imageSmoothingEnabled = false;
        tile.rows.forEach((row, y) => {
          row.forEach((index, x) => {
            if (index === 0) return;
            context.fillStyle = `#${colourText(model, index).slice(0, 6)}`;
            context.fillRect(x * cell, y * cell, cell, cell);
          });
        });
      }
      option.append(
        preview,
        el('span', { text: `Tile ${num(tile.id)}` }),
        el('span', { class: 'tile-uses', text: `Used ${num(tile.uses)} ${tile.uses === 1 ? 'time' : 'times'}` }),
      );
      option.addEventListener('click', () => {
        selectedTile = tile.id;
        draw();
      });
      listbox.append(option);
    }
    if ((tileset?.tiles ?? []).length === 0) {
      listbox.append(el('p', { class: 'empty-line', text: 'No tiles yet' }));
    }

    clear(grid);
    if (tilemap === null) {
      grid.append(el('p', { class: 'empty-line', text: 'No tilemap yet' }));
      return;
    }
    const byKey = new Map(tilemap.cells.map((cell) => [cellKey(cell.x, cell.y), cell]));
    grid.setAttribute('aria-rowcount', String(tilemap.height));
    grid.style.setProperty('--map-columns', String(tilemap.width));
    for (let y = 0; y < tilemap.height; y += 1) {
      const row = el('div', { role: 'row', 'aria-rowindex': String(y + 1), class: 'map-row' });
      for (let x = 0; x < tilemap.width; x += 1) {
        const cell = byKey.get(cellKey(x, y));
        const node = el('div', {
          role: 'gridcell',
          'aria-label': `Cell ${x}, ${y}`,
          class: 'map-cell',
          'data-x': String(x),
          'data-y': String(y),
          'data-tile': String(cell?.tile ?? 0),
          'data-flip-h': cell?.flip_h === true ? 'true' : 'false',
          'data-flip-v': cell?.flip_v === true ? 'true' : 'false',
          tabindex: x === focusCell.x && y === focusCell.y ? '0' : '-1',
        });
        node.textContent = cell === undefined ? '' : String(cell.tile);
        node.addEventListener('focus', () => {
          focusCell = { x, y };
        });
        node.addEventListener('click', () => {
          focusCell = { x, y };
          announceCell(x, y);
          draw();
          focusMapCell();
        });
        row.append(node);
      }
      grid.append(row);
    }
  };

  grid.addEventListener('keydown', (event) => {
    if (tilemap === null) return;
    const key = event.key;
    const move = (dx: number, dy: number): void => {
      event.preventDefault();
      focusCell = {
        x: Math.min(Math.max(focusCell.x + dx, 0), (tilemap as TilemapView).width - 1),
        y: Math.min(Math.max(focusCell.y + dy, 0), (tilemap as TilemapView).height - 1),
      };
      draw();
      focusMapCell();
      announceCell(focusCell.x, focusCell.y);
    };
    if (key === 'ArrowLeft') {
      if (event.shiftKey && marked === null) marked = { ...focusCell };
      move(-1, 0);
      return;
    }
    if (key === 'ArrowRight') {
      if (event.shiftKey && marked === null) marked = { ...focusCell };
      move(1, 0);
      return;
    }
    if (key === 'ArrowUp') {
      if (event.shiftKey && marked === null) marked = { ...focusCell };
      move(0, -1);
      return;
    }
    if (key === 'ArrowDown') {
      if (event.shiftKey && marked === null) marked = { ...focusCell };
      move(0, 1);
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      if (stamp !== null) {
        void placeStamp();
        return;
      }
      void placeAt(focusCell.x, focusCell.y, selectedTile);
      return;
    }
    if (key === 'Delete') {
      event.preventDefault();
      void placeAt(focusCell.x, focusCell.y, 0);
      return;
    }
    if (key === 'h' || key === 'H') {
      event.preventDefault();
      if (stamp !== null) {
        mirrorStamp('h');
        return;
      }
      void flipAt(focusCell.x, focusCell.y, 'h');
      return;
    }
    if (key === 'v' || key === 'V') {
      event.preventDefault();
      if (stamp !== null) {
        mirrorStamp('v');
        return;
      }
      void flipAt(focusCell.x, focusCell.y, 'v');
      return;
    }
    if (key === 'c' || key === 'C') {
      event.preventDefault();
      copyStamp();
      return;
    }
    if (key === 'Escape' && stamp !== null) {
      event.preventDefault();
      stamp = null;
      marked = null;
      grid.removeAttribute('data-stamp');
    }
  });

  const openTileEditor = (): void => {
    if (tileset === null) return;
    const tile = tileset.tiles.find((entry) => entry.id === selectedTile);
    if (tile === undefined) return;
    const size = tileset.tile_size;
    const rows = tile.rows.map((row) => [...row]);
    let at = { x: 0, y: 0 };
    const surface = el('div', {
      role: 'application',
      'aria-label': 'Tile editor',
      class: 'tile-editor',
      tabindex: '0',
    });
    const drawEditor = (): void => {
      clear(surface);
      for (let y = 0; y < size; y += 1) {
        const row = el('div', { class: 'tile-editor-row' });
        for (let x = 0; x < size; x += 1) {
          const cell = el('div', {
            class: x === at.x && y === at.y ? 'tile-editor-cell at' : 'tile-editor-cell',
          });
          cell.style.background =
            rows[y][x] === 0 ? 'transparent' : `#${colourText(ctx.model, rows[y][x]).slice(0, 6)}`;
          cell.addEventListener('click', () => {
            at = { x, y };
            rows[y][x] = ctx.model.primary;
            drawEditor();
          });
          row.append(cell);
        }
        surface.append(row);
      }
    };
    surface.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') at = { ...at, x: Math.max(0, at.x - 1) };
      else if (event.key === 'ArrowRight') at = { ...at, x: Math.min(size - 1, at.x + 1) };
      else if (event.key === 'ArrowUp') at = { ...at, y: Math.max(0, at.y - 1) };
      else if (event.key === 'ArrowDown') at = { ...at, y: Math.min(size - 1, at.y + 1) };
      else if (event.key === ' ') rows[at.y][at.x] = ctx.model.primary;
      else return;
      event.preventDefault();
      drawEditor();
    });
    drawEditor();

    const dialog = el('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Edit tile',
      class: 'dialog',
    });
    const shade = el('div', { class: 'shade' }, [dialog]);
    let release: (() => void) | null = null;
    const close = (): void => {
      release?.();
      shade.remove();
    };
    dialog.append(
      el('h2', { text: 'Edit tile' }),
      surface,
      el('div', { class: 'row' }, [
        button('Save tile', async () => {
          const result = await api.patch<ApiFailure>(
            `/api/tilesets/${(tileset as TilesetView).id}/tiles/${tile.id}`,
            { rows },
          );
          if (!result.ok) {
            ctx.regions.alert(refusalText(result));
            return;
          }
          close();
          await load();
          ctx.refreshPanels();
        }),
        button('Close', close),
      ]),
    );
    document.body.append(shade);
    release = trapDialog(dialog, close);
  };

  const body = el('div', { class: 'panel-body' }, [
    listbox,
    grid,
    el('div', { class: 'edit-only panel-controls' }, [
    field('Edge matching', edgeMatching),
    field('Tile size', tileSize),
    el('div', { class: 'row' }, [
      button('New tileset', async () => {
        const result = await api.post<ApiFailure>(`/api/sprites/${ctx.model.spriteId}/tilesets`, {
          name: `Tiles ${ctx.model.sprite.tilesets.length + 1}`,
          tile_size: Number(tileSize.value),
        });
        if (!result.ok) {
          ctx.regions.alert(refusalText(result));
          return;
        }
        await ctx.reload();
      }),
      button('New tilemap', async () => {
        const tilesetId = ctx.model.sprite.tilesets[0];
        if (tilesetId === undefined) {
          ctx.regions.alert('Make a tileset first');
          return;
        }
        const result = await api.post<ApiFailure>(`/api/sprites/${ctx.model.spriteId}/tilemaps`, {
          name: `Map ${ctx.model.sprite.tilemaps.length + 1}`,
          tileset: tilesetId,
          width: 12,
          height: 8,
        });
        if (!result.ok) {
          ctx.regions.alert(refusalText(result));
          return;
        }
        await ctx.reload();
      }),
      button('Import frame as tiles', async () => {
        const tilesetId = ctx.model.sprite.tilesets[0];
        if (tilesetId === undefined) {
          ctx.regions.alert('Make a tileset first');
          return;
        }
        const result = await api.post<ApiFailure & { tiles_added: number }>(
          `/api/tilesets/${tilesetId}/import`,
          {
            frame: ctx.model.activeFrame,
            layer: ctx.model.activeLayer,
            tilemap: ctx.model.sprite.tilemaps[0],
            x: 0,
            y: 0,
          },
        );
        if (!result.ok) {
          ctx.regions.alert(refusalText(result));
          return;
        }
        await load();
        ctx.refreshPanels();
      }),
      button('Edit tile', openTileEditor),
    ]),
    field('Edge table', edgeTableInput),
    button('Save edge table', async () => {
      if (tileset === null) return;
      const table = edgeTableInput.value
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((value) => Number.isFinite(value));
      const result = await api.patch<ApiFailure>(`/api/tilesets/${tileset.id}/edges`, { table });
      if (!result.ok) {
        ctx.regions.alert(refusalText(result));
        return;
      }
      await load();
    }),
    ]),
  ]);

  void load();

  return {
    node: el('section', { role: 'region', 'aria-label': 'Tiles', class: 'panel panel-orange' }, [
      el('h2', { class: 'panel-title', text: 'Tiles' }),
      body,
    ]),
    refresh: () => void load(),
  };
}
