/**
 * The Liquidations view: a WAI-ARIA grid with a roving tab stop, and the
 * Liquidate position dialog with its Repay options menu.
 */

import { ASSET_CODES, type Asset } from '../../domain/assets.ts';
import { POSITION_STATE_LABEL, QUEUE_EMPTY } from '../../domain/copy.ts';
import { formatAmount, formatHealthFactor } from '../../domain/deskformat.ts';
import { request } from '../api.ts';
import { clear, el, setText } from '../dom.ts';
import { button } from '../parts/fields.ts';
import type { LiveRegions } from '../parts/live.ts';
import { priceUnitsOf } from '../prices.ts';
import { ShockRuler } from '../parts/shockruler.ts';
import { store } from '../store.ts';
import type { PositionDto, PositionsDto } from '../types.ts';
import { LiquidateDialog } from '../parts/liquidatedialog.ts';
import type { View } from './view.ts';

const COLUMNS = [
  'Position',
  'Borrower',
  'Health factor',
  'State',
  'Debt',
  'Collateral',
  'Max repay',
  'Round',
  'Action',
] as const;

export function liquidationsView(live: LiveRegions, navigate: (path: string) => void): View {
  const grid = el('div', { role: 'grid', 'aria-label': 'Liquidation queue', class: 'queue' });
  const emptyState = el('p', { class: 'empty', text: QUEUE_EMPTY });
  const assetChooser = el('select', { class: 'chooser', 'aria-label': 'Asset' });
  for (const asset of ASSET_CODES) {
    assetChooser.append(el('option', { value: asset, text: asset }));
  }
  assetChooser.value = 'MBTC';
  assetChooser.id = 'ruler-asset';

  const ruler = new ShockRuler({ showPost: false });
  const dialog = new LiquidateDialog(live, {
    onFilled: (settlement) => navigate(`/settlements/${settlement.settlement_id}`),
    onConflict: () => void load(),
  });

  let positions: readonly PositionDto[] = [];
  /** The cell that last had focus, which is where Tab enters the grid. */
  let activeRow = 0;
  let activeColumn = 0;

  function cellAt(row: number, column: number): HTMLElement | null {
    return grid.querySelector(`[data-row="${row}"][data-col="${column}"]`);
  }

  function rowCount(): number {
    return positions.length;
  }

  /** Only one cell in the grid is tabbable at a time. */
  function applyRovingTabStop(): void {
    for (const cell of grid.querySelectorAll<HTMLElement>('[data-row]')) {
      const isActive =
        Number(cell.dataset['row']) === activeRow &&
        Number(cell.dataset['col']) === activeColumn;
      const control = cell.querySelector<HTMLElement>('button');
      if (control !== null) {
        control.tabIndex = isActive ? 0 : -1;
        cell.tabIndex = -1;
      } else {
        cell.tabIndex = isActive ? 0 : -1;
      }
    }
  }

  function focusCell(row: number, column: number): void {
    activeRow = Math.max(0, Math.min(rowCount() - 1, row));
    activeColumn = Math.max(0, Math.min(COLUMNS.length - 1, column));
    applyRovingTabStop();
    const cell = cellAt(activeRow, activeColumn);
    if (cell === null) return;
    const control = cell.querySelector<HTMLElement>('button');
    (control ?? cell).focus();
  }

  grid.addEventListener('keydown', (event) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowRight') focusCell(activeRow, activeColumn + 1);
    else if (event.key === 'ArrowLeft') focusCell(activeRow, activeColumn - 1);
    else if (event.key === 'ArrowDown') focusCell(activeRow + 1, activeColumn);
    else if (event.key === 'ArrowUp') focusCell(activeRow - 1, activeColumn);
    else if (event.key === 'Home') {
      if (event.ctrlKey) focusCell(0, 0);
      else focusCell(activeRow, 0);
    } else if (event.key === 'End') {
      if (event.ctrlKey) focusCell(rowCount() - 1, COLUMNS.length - 1);
      else focusCell(activeRow, COLUMNS.length - 1);
    }
  });

  grid.addEventListener('focusin', (event) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-row]');
    if (cell === null) return;
    activeRow = Number(cell.dataset['row']);
    activeColumn = Number(cell.dataset['col']);
    applyRovingTabStop();
  });

  function render(): void {
    const signature = positions.map((position) => position.position_id).join(',');
    if (grid.dataset['ids'] !== signature) {
      const focusedPositionId = positions[activeRow]?.position_id;
      // Rebuilding the rows would drop focus, so it is put back afterwards.
      const hadFocus = grid.contains(document.activeElement);
      grid.dataset['ids'] = signature;
      clear(grid);

      const head = el('div', { role: 'row', class: 'queue-row queue-head' });
      for (const column of COLUMNS) {
        head.append(el('span', { role: 'columnheader', class: 'queue-cell', text: column }));
      }
      grid.append(head);

      positions.forEach((position, index) => {
        const row = el('div', {
          role: 'row',
          class: 'queue-row',
          'data-position': position.position_id,
        });
        COLUMNS.forEach((columnName, column) => {
          const cell = el('span', {
            role: 'gridcell',
            class: 'queue-cell',
            'data-label': columnName,
            'data-row': String(index),
            'data-col': String(column),
          });
          if (column === COLUMNS.length - 1) {
            const act = button(`Liquidate ${position.position_id}`);
            act.classList.add('danger');
            act.addEventListener('click', () => {
              const current = positions[index];
              if (current !== undefined) dialog.open(current, act);
            });
            cell.append(act);
          }
          row.append(cell);
        });
        grid.append(row);
      });

      // When the queue refreshes, focus stays on the same position's cell if
      // it is still listed, and otherwise moves to the first cell.
      const stillThere = positions.findIndex(
        (position) => position.position_id === focusedPositionId,
      );
      activeRow = stillThere >= 0 ? stillThere : 0;
      if (stillThere < 0) activeColumn = 0;
      applyRovingTabStop();
      if (hadFocus && positions.length > 0) focusCell(activeRow, activeColumn);
    }

    positions.forEach((position, index) => {
      const values = [
        position.position_id,
        position.borrower_id,
        formatHealthFactor(position.health_factor),
        POSITION_STATE_LABEL[position.state],
        `${formatAmount(BigInt(position.debt), store.decimalsOf(position.debt_asset))} ${position.debt_asset}`,
        `${formatAmount(BigInt(position.collateral_amount), store.decimalsOf(position.collateral_asset))} ${position.collateral_asset}`,
        `${formatAmount(BigInt(position.max_repay), store.decimalsOf(position.debt_asset))} ${position.debt_asset}`,
        String(position.round),
        '',
      ];
      values.forEach((text, column) => {
        const cell = cellAt(index, column);
        if (cell === null || column === COLUMNS.length - 1) return;
        setText(cell, text);
      });
      const row = grid.querySelector(`[data-position="${position.position_id}"]`);
      // Rows below health factor 1 are marked in the signal colour.
      row?.classList.add('below-one');
    });

    emptyState.hidden = positions.length > 0;
    grid.hidden = positions.length === 0;
  }

  async function load(): Promise<void> {
    try {
      const reply = await request<PositionsDto>('GET', '/api/liquidations/queue', {
        token: store.token,
      });
      positions = reply.positions;
      store.queueSize = positions.length;
      render();
      if (!ruler.isDragging) await loadRuler();
    } catch (error) {
      live.report(error);
    }
  }

  async function loadRuler(): Promise<void> {
    const asset = assetChooser.value as Asset;
    const pool = store.poolFor(asset);
    if (pool === null) return;
    const reply = await request<PositionsDto>(
      'GET',
      `/api/positions?collateral_asset=${asset}`,
      { token: store.token },
    );
    ruler.setData(asset, priceUnitsOf(pool.price), reply.positions);
  }

  assetChooser.addEventListener('change', () => void loadRuler());

  const element = el('section', { class: 'worksheet-body' }, [
    el('h1', { class: 'view-head', text: 'Liquidations' }),
    grid,
    emptyState,
    el('div', { class: 'field' }, [
      el('label', { class: 'label', text: 'Asset', for: 'ruler-asset' }),
      assetChooser,
    ]),
    ruler.element,
    dialog.element,
  ]);

  void load();

  return {
    element,
    update: () => void load().catch(() => undefined),
    navigateAway: () => dialog.close(),
    onPost: () => ruler.recentre(),
    navigate,
  };
}
