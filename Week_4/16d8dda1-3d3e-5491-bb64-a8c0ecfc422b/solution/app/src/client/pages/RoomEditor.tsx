import { useRef, useState, type KeyboardEvent } from 'react';
import type { ClassDetail, LayoutResult, Piece, PieceKind } from '../../shared/wire';
import { api } from '../api';
import { Link } from '../router';
import { Alert, NotFound, PageStatus, Skeleton } from '../ui/feedback';
import { useAction } from './useAction';
import { useLoad } from './useLoad';

const BOARD_WIDTH = 4;
const MAX_DRAWN = 24;
const PIECES: { kind: PieceKind; label: string }[] = [
  { kind: 'board', label: 'Board' },
  { kind: 'table', label: 'Table' },
  { kind: 'seat', label: 'Seat' },
];

const covers = (piece: Piece, column: number, row: number): boolean =>
  piece.row === row && column >= piece.column && column < piece.column + (piece.kind === 'board' ? BOARD_WIDTH : 1);

/** The piece shown in a cell: the one placed last, so repeated Delete peels them off newest first. */
function coveringIndex(pieces: Piece[], column: number, row: number): number {
  for (let index = pieces.length - 1; index >= 0; index--) {
    const piece = pieces[index];
    if (piece && covers(piece, column, row)) return index;
  }
  return -1;
}

const wholeNumber = (text: string): number | null => (/^\d+$/.test(text.trim()) && Number(text) >= 1 && Number(text) <= MAX_DRAWN ? Number(text) : null);

function Editor({ classId, initial }: { classId: string; initial: LayoutResult }) {
  const [columns, setColumns] = useState(initial.layout.columns);
  const [rows, setRows] = useState(initial.layout.rows);
  const [columnsText, setColumnsText] = useState(String(initial.layout.columns));
  const [rowsText, setRowsText] = useState(String(initial.layout.rows));
  const [pieces, setPieces] = useState<Piece[]>(initial.layout.pieces);
  const [kind, setKind] = useState<PieceKind>('seat');
  const [cursor, setCursor] = useState({ column: 0, row: 0 });
  const [message, setMessage] = useState('');
  const { pending, error, run } = useAction();
  const gridRef = useRef<HTMLDivElement>(null);

  const cursorColumn = Math.min(cursor.column, columns - 1);
  const cursorRow = Math.min(cursor.row, rows - 1);

  const place = (column: number, row: number) => {
    setPieces((current) => [...current, { kind, column, row }]);
    setMessage('');
  };
  const remove = (column: number, row: number) => {
    setPieces((current) => {
      const index = coveringIndex(current, column, row);
      return index < 0 ? current : current.filter((_, at) => at !== index);
    });
    setMessage('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setCursor({ column: Math.max(0, Math.min(columns - 1, cursorColumn + move[0])), row: Math.max(0, Math.min(rows - 1, cursorRow + move[1])) });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      place(cursorColumn, cursorRow);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove(cursorColumn, cursorRow);
    }
  };

  const save = async () => {
    setMessage('');
    const saved = await run(() => api<LayoutResult>('PUT', `/api/classes/${classId}/layout`, { columns, rows, pieces }));
    if (saved) setMessage('Room saved.');
  };

  const resize = (set: (size: number) => void, setText: (text: string) => void) => (value: string) => {
    setText(value);
    const parsed = wholeNumber(value);
    if (parsed !== null) set(parsed);
  };

  return (
    <>
      <div className="editor-controls">
        <div className="field">
          <label htmlFor="room-columns">Columns</label>
          <input id="room-columns" type="number" inputMode="numeric" value={columnsText} onChange={(event) => resize(setColumns, setColumnsText)(event.target.value)} onBlur={() => setColumnsText(String(columns))} />
        </div>
        <div className="field">
          <label htmlFor="room-rows">Rows</label>
          <input id="room-rows" type="number" inputMode="numeric" value={rowsText} onChange={(event) => resize(setRows, setRowsText)(event.target.value)} onBlur={() => setRowsText(String(rows))} />
        </div>
        <div className="field">
          <span className="label" id="piece-label">
            Piece
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="piece-label">
            {PIECES.map((piece) => (
              <label key={piece.kind} className={`segment${kind === piece.kind ? ' on' : ''}`}>
                <input type="radio" name="piece" value={piece.kind} checked={kind === piece.kind} onChange={() => setKind(piece.kind)} />
                <span>{piece.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <p className="hint">Front wall at the top. Arrow keys move, Enter places the chosen piece, Delete removes it. A board is four cells wide.</p>
      <div className="grid-scroll">
        <div className="grid-frame">
          <div className="front-wall" aria-hidden="true">
            Front wall
          </div>
          <div
            className="room-grid"
          role="grid"
          aria-label="Room grid"
          tabIndex={0}
          ref={gridRef}
          aria-activedescendant={`cell-${cursorColumn}-${cursorRow}`}
          onKeyDown={onKeyDown}
        >
          {Array.from({ length: rows }, (_, row) => (
            <div role="row" className="grid-row" key={row} style={{ gridTemplateColumns: `repeat(${columns}, 44px)` }}>
              {Array.from({ length: columns }, (_, column) => {
                const index = coveringIndex(pieces, column, row);
                const piece = index < 0 ? undefined : pieces[index];
                const edge = piece?.kind === 'board' ? (column === piece.column ? ' board-start' : '') + (column === piece.column + BOARD_WIDTH - 1 ? ' board-end' : '') : '';
                const selected = column === cursorColumn && row === cursorRow;
                return (
                  <div
                    key={column}
                    id={`cell-${column}-${row}`}
                    role="gridcell"
                    aria-label={`Cell ${column},${row}`}
                    aria-selected={selected}
                    data-piece={piece?.kind ?? ''}
                    className={`cell${piece ? ` is-${piece.kind}` : ''}${edge}${selected ? ' cursor' : ''}`}
                    onClick={() => {
                      setCursor({ column, row });
                      place(column, row);
                      gridRef.current?.focus();
                    }}
                  >
                    {piece?.kind === 'table' ? <span aria-hidden="true">T</span> : piece?.kind === 'seat' ? <span className="seat-dot" aria-hidden="true" /> : null}
                  </div>
                );
              })}
            </div>
          ))}
          </div>
        </div>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      <div className="form-actions">
        <button type="button" className="primary" onClick={() => void save()} disabled={pending} aria-busy={pending}>
          Save room
        </button>
      </div>
      <PageStatus text={pending ? 'Saving...' : message} />
    </>
  );
}

export function RoomEditorPage({ classId }: { classId: string }) {
  const { result } = useLoad<ClassDetail>(`/api/classes/${classId}`);
  if (result.state === 'missing') return <NotFound />;
  if (result.state === 'refused') {
    return (
      <main className="page">
        <Alert>{result.message}</Alert>
      </main>
    );
  }
  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link href={`/classes/${classId}`}>Back to the class</Link>
      </nav>
      <h1>Arrange the room</h1>
      {result.state === 'loading' ? <Skeleton rows={4} label="Loading the room" /> : <Editor classId={classId} initial={result.data} />}
    </main>
  );
}
