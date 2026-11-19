import type { Layout, SeatPlace, TablePlace } from '../../shared/wire';

const CELL = 24;

/** A small plan of a saved room seen from above, front wall at the top. */
export function RoomPlan({ layout, seats, tables }: { layout: Layout; seats: SeatPlace[]; tables: TablePlace[] }) {
  const boards = layout.pieces.filter((piece) => piece.kind === 'board');
  const width = layout.columns * CELL;
  const height = layout.rows * CELL;
  const label = `Plan of the room: ${layout.columns} columns by ${layout.rows} rows, ${seats.length} ${seats.length === 1 ? 'seat' : 'seats'}, ${tables.length} ${tables.length === 1 ? 'table' : 'tables'}`;
  return (
    <figure className="room-figure">
      <figcaption className="plan-caption">Front wall</figcaption>
    <svg className="room-plan" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <rect x="0" y="0" width={width} height={height} rx="4" className="plan-floor" />
      {boards.map((board) => (
        <rect key={`b${board.column}`} x={board.column * CELL + 1} y={board.row * CELL + 3} width={CELL * 4 - 2} height={CELL - 8} rx="3" className="plan-board" />
      ))}
      {tables.map((table) => (
        <rect key={table.tableId} x={table.column * CELL + 3} y={table.row * CELL + 3} width={CELL - 6} height={CELL - 6} rx="3" className="plan-table" />
      ))}
      {seats.map((seat) => (
        <rect key={seat.seatId} x={seat.column * CELL + 6} y={seat.row * CELL + 6} width={CELL - 12} height={CELL - 12} rx="4" className="plan-seat" />
      ))}
    </svg>
    </figure>
  );
}
