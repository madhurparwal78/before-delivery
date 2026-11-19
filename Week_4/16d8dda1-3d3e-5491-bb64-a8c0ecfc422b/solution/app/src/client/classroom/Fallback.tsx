import { useClassroom } from './context';

const CELL = 28;

/** Without WebGL: a drawn plan of the room under the status text, so the room is still recognisably a room. */
export function Fallback() {
  const { snapshot } = useClassroom();
  const { columns, rows, boardColumn } = snapshot.room;
  return (
    <div className="fallback">
      <svg className="fallback-plan" viewBox={`0 0 ${columns * CELL} ${rows * CELL}`} aria-hidden="true" focusable="false">
        <rect width={columns * CELL} height={rows * CELL} rx="6" className="plan-floor" />
        <rect x={boardColumn * CELL + 2} y={4} width={CELL * 4 - 4} height={CELL - 10} rx="3" className="plan-board" />
        {snapshot.tables.map((table) => (
          <rect key={table.tableId} x={table.column * CELL + 4} y={table.row * CELL + 4} width={CELL - 8} height={CELL - 8} rx="4" className="plan-table" />
        ))}
        {snapshot.seats.map((seat) => (
          <rect key={seat.seatId} x={seat.column * CELL + 7} y={seat.row * CELL + 7} width={CELL - 14} height={CELL - 14} rx="5" className={seat.learnerId ? 'plan-seat taken' : 'plan-seat'} />
        ))}
      </svg>
      <p role="status">3D view unavailable. The class still works.</p>
    </div>
  );
}
