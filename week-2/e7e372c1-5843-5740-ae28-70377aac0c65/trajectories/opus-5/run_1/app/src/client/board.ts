/**
 * The public figure board. It renders the server's clock statuses, figures,
 * history and vault state exactly as returned, and never works out session
 * open or closed, staleness or publication from the device clock.
 */
import { getBoard } from './api';
import {
  BOARD_COPY,
  ethLiveLine,
  ethStaleLine,
  holdingsLine,
  marketClosedLine,
  restatedLine,
  sessionCloseAnnouncement,
  sessionOpenLine,
} from './copy';
import { clear, element, isTabletUp, setText } from './dom';
import { FigureTile, createFigureTile } from './figureTile';
import { displayOf, newYorkFields } from './format';
import { siteFooter, siteHeader } from './header';
import { activeTrace, openTrace } from './trace';
import { BoardPayload, Computation, HistoryRow } from './types';

const REFRESH_MS = 3000;

const CLOCK_NAMES = ['Equity session', 'ETH price', 'Holdings week'] as const;
type ClockName = (typeof CLOCK_NAMES)[number];

const HISTORY_COLUMNS = [
  'Week ending',
  'Beginning balance',
  'ETH acquired',
  'Staking rewards',
  'Ending balance',
  'Cumulative rewards',
  'Diluted shares',
  'ETH per 1,000 diluted shares',
  'Exhibit',
  'Status',
] as const;

interface ClockItem {
  group: HTMLElement;
  shortText: string;
  fullText: string;
  expanded: boolean;
  name: ClockName;
}

interface HistoryRowView {
  row: HTMLTableRowElement;
  cells: HTMLTableCellElement[];
  statusCell: HTMLTableCellElement;
}

export function mountBoard(root: HTMLElement): void {
  const notices = element('div', {
    className: 'notices',
    attributes: { role: 'region', 'aria-label': 'Notices' },
  });
  const clockRail = element('div', {
    className: 'clock-rail',
    attributes: { role: 'region', 'aria-label': 'Clocks' },
  });
  const boardUpdates = element('div', {
    className: 'board-updates',
    attributes: { role: 'status', 'aria-label': 'Board updates', 'aria-live': 'polite' },
    text: BOARD_COPY.loading,
  });
  const figureGrid = element('div', {
    className: 'figure-grid',
    attributes: { role: 'region', 'aria-label': 'Figures' },
  });
  const historyBody = element('tbody', { attributes: { role: 'rowgroup' } });
  const historyTable = element('table', {
    className: 'history-table',
    attributes: { role: 'table', 'aria-label': 'Weekly holdings restatements' },
    children: [
      element('thead', {
        attributes: { role: 'rowgroup' },
        children: [
          element('tr', {
            attributes: { role: 'row' },
            children: HISTORY_COLUMNS.map((column) =>
              element('th', { attributes: { scope: 'col', role: 'columnheader' }, text: column }),
            ),
          }),
        ],
      }),
      historyBody,
    ],
  });
  const historyRegion = element('section', {
    className: 'history-region',
    attributes: { role: 'region', 'aria-label': 'Weekly history' },
    children: [element('h2', { text: 'Weekly history' }), historyTable],
  });

  root.appendChild(siteHeader());
  root.appendChild(notices);
  root.appendChild(
    element('div', {
      className: 'board-layout',
      children: [
        clockRail,
        element('div', {
          className: 'board-main',
          children: [boardUpdates, figureGrid, historyRegion],
        }),
      ],
    }),
  );
  root.appendChild(siteFooter());

  const clockItems = new Map<ClockName, ClockItem>();
  for (const name of CLOCK_NAMES) {
    const group = element('div', {
      className: 'clock-item',
      attributes: { role: 'group', 'aria-label': name },
    });
    clockRail.appendChild(group);
    clockItems.set(name, { group, shortText: '', fullText: '', expanded: false, name });
  }

  const tiles = new Map<string, FigureTile>();
  const historyRows = new Map<string, HistoryRowView>();
  let latest: BoardPayload | null = null;
  let lastEquityStatus: 'open' | 'closed' | null = null;
  let announcement = '';
  let compact = !isTabletUp();

  function renderClockItem(item: ClockItem): void {
    clear(item.group);
    item.group.appendChild(element('p', { className: 'clock-name', text: item.name }));
    if (compact) {
      item.group.appendChild(element('p', { className: 'clock-short', text: item.shortText }));
      const button = element('button', {
        className: 'clock-details',
        text: `${item.name} details`,
        attributes: { type: 'button', 'aria-expanded': item.expanded ? 'true' : 'false' },
      });
      button.addEventListener('click', () => {
        item.expanded = !item.expanded;
        renderClockItem(item);
        const next = item.group.querySelector<HTMLButtonElement>('.clock-details');
        next?.focus();
      });
      item.group.appendChild(button);
      if (item.expanded) {
        item.group.appendChild(element('p', { className: 'clock-full', text: item.fullText }));
      }
    } else {
      item.group.appendChild(element('p', { className: 'clock-full', text: item.fullText }));
    }
  }

  function updateClockItem(name: ClockName, shortText: string, fullText: string, stale = false): void {
    const item = clockItems.get(name);
    if (item === undefined) return;
    item.group.classList.toggle('clock-stale', stale);
    const changed = item.shortText !== shortText || item.fullText !== fullText;
    item.shortText = shortText;
    item.fullText = fullText;
    if (!changed) return;
    const shortNode = item.group.querySelector<HTMLElement>('.clock-short');
    const fullNode = item.group.querySelector<HTMLElement>('.clock-full');
    if (shortNode !== null) setText(shortNode, shortText);
    if (fullNode !== null) setText(fullNode, fullText);
    if (shortNode === null && fullNode === null) renderClockItem(item);
  }

  function applyClocks(board: BoardPayload): void {
    const equity = board.clocks.equity;
    const closeDate = equity.official_close?.date ?? '';
    const equityFull =
      equity.status === 'open' && equity.closes_at !== null
        ? sessionOpenLine(newYorkFields(equity.closes_at).shortTime)
        : marketClosedLine(closeDate);
    updateClockItem('Equity session', equity.status === 'open' ? 'Open' : 'Closed', equityFull);

    const eth = board.clocks.eth;
    const ethTime = eth.last_tick === null ? null : newYorkFields(eth.last_tick.at).time;
    const ethFull =
      eth.status === 'live' && ethTime !== null ? ethLiveLine(ethTime) : ethStaleLine(ethTime);
    updateClockItem('ETH price', eth.status === 'live' ? 'Live' : 'Stale', ethFull, eth.status === 'stale');

    const week = board.clocks.holdings.week_ending;
    updateClockItem(
      'Holdings week',
      week === null ? 'Week \u2014' : `Week ${week}`,
      week === null ? '' : holdingsLine(week),
    );
  }

  function openTraceFor(tile: FigureTile): void {
    const board = latest;
    if (board === null) return;
    const rows =
      board.history.find((row) => row.restatement_id === tile.computation.restatement_id) ?? null;
    openTrace({
      tile: tile.root,
      numeral: tile.numeral,
      chipHost: tile.chipHost,
      opener: tile.activate,
      computation: tile.computation,
      exhibitRows: rows,
      marketDate: board.market_date,
      onStep: null,
      onClose: () => {
        const current = latest?.figures.find((figure) => figure.figure === tile.computation.figure);
        if (current !== undefined) tile.update(current);
      },
    });
  }

  function applyFigures(figures: Computation[]): void {
    const open = activeTrace();
    figures.forEach((computation, index) => {
      let tile = tiles.get(computation.figure);
      if (tile === undefined) {
        tile = createFigureTile(computation, 'h3');
        tiles.set(computation.figure, tile);
        const created = tile;
        created.activate.addEventListener('click', () => openTraceFor(created));
        figureGrid.appendChild(tile.root);
      }
      if (open !== null && open.tile === tile.root) return;
      if (figureGrid.children[index] !== tile.root) {
        figureGrid.insertBefore(tile.root, figureGrid.children[index] ?? null);
      }
      tile.update(computation);
    });
  }

  /** The eight text columns; the Exhibit and Status cells are built separately. */
  function historyCellValues(row: HistoryRow): string[] {
    return [
      row.week_ending,
      displayOf(row.beginning_balance, 'eth'),
      displayOf(row.eth_acquired, 'eth'),
      displayOf(row.staking_rewards, 'eth'),
      displayOf(row.ending_balance, 'eth'),
      displayOf(row.cumulative_staking_rewards, 'eth'),
      displayOf(row.diluted_shares, 'shares'),
      row.eth_per_1000_diluted?.display ?? '',
    ];
  }

  function renderStatusCell(cell: HTMLTableCellElement, row: HistoryRow): void {
    clear(cell);
    if (row.restated === null) {
      cell.appendChild(element('span', { text: 'Published' }));
      return;
    }
    cell.appendChild(element('span', { className: 'restated-marker', text: BOARD_COPY.restated }));
    cell.appendChild(
      element('span', {
        className: 'restated-line',
        text: restatedLine(row.restated.on, row.restated.reason),
      }),
    );
    cell.appendChild(
      element('a', {
        text: BOARD_COPY.viewSuperseding,
        attributes: { href: `#restatement-${row.restated.superseded_by}` },
      }),
    );
  }

  function renderExhibitCell(cell: HTMLTableCellElement, row: HistoryRow): void {
    clear(cell);
    if (row.exhibit === null) return;
    cell.appendChild(
      element('a', {
        text: row.exhibit.accession,
        attributes: {
          href: `/api/exhibits/${row.exhibit.sha256}`,
          'aria-label': `Exhibit ${row.exhibit.accession}`,
        },
      }),
    );
  }

  function applyHistory(rows: HistoryRow[]): void {
    const focused = document.activeElement as HTMLElement | null;
    for (const row of rows) {
      let view = historyRows.get(row.restatement_id);
      if (view === undefined) {
        const cells = HISTORY_COLUMNS.map((column) =>
          element('td', { attributes: { role: 'cell', 'data-label': column } }),
        );
        const tableRow = element('tr', {
          attributes: { role: 'row', id: `restatement-${row.restatement_id}` },
          children: cells,
        });
        view = {
          row: tableRow,
          cells,
          statusCell: cells[HISTORY_COLUMNS.length - 1] as HTMLTableCellElement,
        };
        historyRows.set(row.restatement_id, view);
      }
      historyCellValues(row).forEach((value, index) => {
        const cell = view.cells[index];
        if (cell !== undefined) {
          cell.classList.toggle('numeric', index > 0);
          setText(cell, value);
        }
      });
      const exhibitCell = view.cells[HISTORY_COLUMNS.length - 2];
      if (exhibitCell !== undefined && exhibitCell.dataset.accession !== (row.exhibit?.sha256 ?? '')) {
        exhibitCell.dataset.accession = row.exhibit?.sha256 ?? '';
        renderExhibitCell(exhibitCell, row);
      }
      const statusKey = row.restated === null ? 'published' : `restated:${row.restated.superseded_by}`;
      if (view.statusCell.dataset.statusKey !== statusKey) {
        view.statusCell.dataset.statusKey = statusKey;
        renderStatusCell(view.statusCell, row);
      }
    }
    for (const [id, view] of historyRows) {
      if (!rows.some((row) => row.restatement_id === id)) {
        view.row.remove();
        historyRows.delete(id);
      }
    }
    rows.forEach((row, index) => {
      const view = historyRows.get(row.restatement_id);
      if (view === undefined) return;
      if (historyBody.children[index] !== view.row) {
        historyBody.insertBefore(view.row, historyBody.children[index] ?? null);
      }
    });
    if (focused !== null && focused.isConnected && document.activeElement !== focused) {
      focused.focus({ preventScroll: true });
    }
  }

  function applyBoard(board: BoardPayload): void {
    const previousStatus = lastEquityStatus;
    latest = board;
    setText(notices, board.vault === 'unavailable' ? BOARD_COPY.vaultUnavailable : '');
    applyClocks(board);
    applyFigures(board.figures);
    applyHistory(board.history);
    if (previousStatus === 'open' && board.clocks.equity.status === 'closed') {
      announcement = sessionCloseAnnouncement(board.clocks.equity.official_close?.date ?? '');
    }
    lastEquityStatus = board.clocks.equity.status;
    setText(boardUpdates, announcement);
  }

  async function refresh(): Promise<void> {
    const result = await getBoard();
    if (result.kind === 'success') {
      applyBoard(result.value);
      return;
    }
    setText(boardUpdates, BOARD_COPY.refreshFailed);
  }

  const tabletQuery = window.matchMedia('(min-width: 768px)');
  tabletQuery.addEventListener('change', () => {
    compact = !tabletQuery.matches;
    for (const item of clockItems.values()) renderClockItem(item);
  });
  for (const item of clockItems.values()) renderClockItem(item);

  void refresh();
  window.setInterval(() => {
    void refresh();
  }, REFRESH_MS);
}
