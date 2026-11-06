import { ApiCallError, call } from './api.ts';
import { clearFeedback, runAction, showFailure, showStatus, type Regions } from './feedback.ts';
import { locale, setI18n } from './i18n.ts';

const regions: Regions = { status: 'booking-status', error: 'booking-error' };

type SeatCell = HTMLElement;

export function initSeatMap(screeningId: string): void {
  const grid = document.getElementById('seat-map');
  const holdButton = document.getElementById('hold-seats') as HTMLButtonElement | null;
  if (grid === null) return;
  const selection = new Set<string>();

  const cells = (): SeatCell[] => Array.from(grid.querySelectorAll<SeatCell>('[role="gridcell"]'));
  const rows = (): SeatCell[][] =>
    Array.from(grid.querySelectorAll('[role="row"]')).map((row) =>
      Array.from(row.querySelectorAll<SeatCell>('[role="gridcell"]')),
    );

  const setFocus = (cell: SeatCell): void => {
    for (const other of cells()) other.tabIndex = -1;
    cell.tabIndex = 0;
    cell.focus();
  };

  const toggle = (cell: SeatCell): void => {
    const seat = cell.getAttribute('data-seat') ?? '';
    const state = cell.getAttribute('data-state');
    if (state === 'sold' || state === 'held') return;
    if (selection.has(seat)) {
      selection.delete(seat);
      cell.setAttribute('aria-selected', 'false');
      cell.setAttribute('data-state', 'available');
    } else {
      selection.add(seat);
      cell.setAttribute('aria-selected', 'true');
      cell.setAttribute('data-state', 'mine');
    }
  };

  grid.addEventListener('click', (event) => {
    const cell = (event.target as HTMLElement).closest<SeatCell>('[role="gridcell"]');
    if (cell === null) return;
    setFocus(cell);
    toggle(cell);
  });

  grid.addEventListener('keydown', (event) => {
    const cell = (event.target as HTMLElement).closest<SeatCell>('[role="gridcell"]');
    if (cell === null) return;
    const grouped = rows();
    const rowIndex = grouped.findIndex((row) => row.includes(cell));
    const columnIndex = grouped[rowIndex]?.indexOf(cell) ?? 0;
    const move = (nextRow: number, nextColumn: number): void => {
      const row = grouped[Math.max(0, Math.min(grouped.length - 1, nextRow))];
      if (row === undefined) return;
      const target = row[Math.max(0, Math.min(row.length - 1, nextColumn))];
      if (target !== undefined) setFocus(target);
    };
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        move(rowIndex, columnIndex - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        move(rowIndex, columnIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(rowIndex - 1, columnIndex);
        break;
      case 'ArrowDown':
        event.preventDefault();
        move(rowIndex + 1, columnIndex);
        break;
      case 'Home':
        event.preventDefault();
        move(rowIndex, 0);
        break;
      case 'End':
        event.preventDefault();
        move(rowIndex, grouped[rowIndex].length - 1);
        break;
      case ' ':
      case 'Enter':
        event.preventDefault();
        toggle(cell);
        break;
      default:
        break;
    }
  });

  const refresh = async (): Promise<void> => {
    const data = await call<{
      screening: { seats_remaining: number; seats: Array<{ code: string; state: string }> };
    }>('GET', `/api/screenings/${screeningId}`);
    for (const seat of data.screening.seats) {
      const cell = grid.querySelector<SeatCell>(`[data-seat="${seat.code}"]`);
      if (cell === null) continue;
      if (selection.has(seat.code) && seat.state === 'available') continue;
      if (selection.has(seat.code) && (seat.state === 'sold' || seat.state === 'held')) {
        selection.delete(seat.code);
      }
      cell.setAttribute('data-state', seat.state);
      cell.setAttribute('aria-selected', seat.state === 'mine' ? 'true' : 'false');
      if (seat.state === 'sold' || seat.state === 'held') cell.setAttribute('aria-disabled', 'true');
      else cell.removeAttribute('aria-disabled');
    }
    const remaining = document.getElementById('seats-remaining');
    if (remaining !== null) {
      if (data.screening.seats_remaining === 0) setI18n(remaining, 'sold_out');
      else setI18n(remaining, 'seats_left', { count: data.screening.seats_remaining });
    }
  };

  window.setInterval(() => {
    void refresh().catch(() => undefined);
  }, 5000);

  holdButton?.addEventListener('click', () => {
    const group = (document.getElementById('group-booking') as HTMLInputElement | null)?.checked === true;
    void runAction(holdButton, regions, async () => {
      clearFeedback(regions);
      try {
        const result = await call<{ hold: { id: string } }>('POST', '/api/holds', {
          screening_id: screeningId,
          seats: Array.from(selection),
          group,
        });
        showStatus(regions, 'hold_placed');
        window.location.assign(`/${locale()}/checkout/${result.hold.id}`);
      } catch (error) {
        if (error instanceof ApiCallError && error.failure.code === 'seat_taken') {
          for (const seat of error.failure.seats ?? []) {
            selection.delete(seat);
            const cell = grid.querySelector<SeatCell>(`[data-seat="${seat}"]`);
            cell?.setAttribute('data-state', 'sold');
            cell?.setAttribute('aria-disabled', 'true');
            cell?.setAttribute('aria-selected', 'false');
          }
        }
        showFailure(regions, error);
        void refresh().catch(() => undefined);
      }
    });
  });

  const notesButton = document.getElementById('film-notes-button');
  const notes = document.getElementById('film-notes');
  if (notesButton !== null && notes !== null) {
    const sync = (): void => {
      const narrow = window.innerWidth < 768;
      if (!narrow) {
        notes.removeAttribute('hidden');
        notesButton.setAttribute('aria-expanded', 'false');
        return;
      }
      if (notesButton.getAttribute('aria-expanded') !== 'true') notes.setAttribute('hidden', '');
    };
    notesButton.addEventListener('click', () => {
      const open = notesButton.getAttribute('aria-expanded') === 'true';
      notesButton.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (open) notes.setAttribute('hidden', '');
      else notes.removeAttribute('hidden');
    });
    window.addEventListener('resize', sync);
    sync();
  }
}
