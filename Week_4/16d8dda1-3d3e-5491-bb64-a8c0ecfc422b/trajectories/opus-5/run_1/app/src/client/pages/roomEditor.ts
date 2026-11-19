import type { ClassDetail, LayoutJson, PieceJson } from '../../shared/types.js';
import { api } from '../api.js';
import { button, element } from '../dom.js';
import { pageShell, pending } from '../shell.js';

type Kind = 'board' | 'table' | 'seat';

const BOARD_WIDTH = 4;

function covers(piece: PieceJson, column: number, row: number): boolean {
  if (piece.row !== row) return false;
  if (piece.kind === 'board') return column >= piece.column && column < piece.column + BOARD_WIDTH;
  return piece.column === column;
}

export function roomEditorPage(classId: string): HTMLElement {
  const shell = pageShell('wide');
  let pieces: PieceJson[] = [];
  let columns = 8;
  let rows = 6;
  let cursor = { column: 0, row: 0 };

  const columnsInput = element('input', { type: 'number', min: '4', max: '12', value: '8' });
  const rowsInput = element('input', { type: 'number', min: '3', max: '10', value: '6' });
  const grid = element('div', { role: 'grid', 'aria-label': 'Room grid', class: 'room-grid', tabindex: '0' });
  const gridBox = element('div', { class: 'grid-box' }, [grid]);
  const save = button('Save room', { class: 'primary' });

  const pieceRadios = (['Board', 'Table', 'Seat'] as const).map((name, index) =>
    element('label', { class: 'radio' }, [
      element('input', { type: 'radio', name: 'piece', value: name.toLowerCase(), checked: index === 2 }),
      element('span', {}, [name])
    ])
  );
  const pieceGroup = element('div', { role: 'radiogroup', 'aria-label': 'Piece', class: 'row' }, pieceRadios);

  const chosenKind = (): Kind => {
    const checked = pieceGroup.querySelector<HTMLInputElement>('input:checked');
    const value = checked?.value ?? 'seat';
    return value === 'board' || value === 'table' ? value : 'seat';
  };

  const drawGrid = (): void => {
    grid.replaceChildren();
    grid.style.setProperty('--columns', String(columns));
    for (let row = 0; row < rows; row += 1) {
      const rowNode = element('div', { role: 'row', class: 'grid-row' });
      for (let column = 0; column < columns; column += 1) {
        const piece = pieces.find((candidate) => covers(candidate, column, row));
        const selected = cursor.column === column && cursor.row === row;
        const cell = element('div', {
          role: 'gridcell',
          'aria-label': `Cell ${column},${row}`,
          'aria-selected': selected ? 'true' : 'false',
          'data-piece': piece?.kind ?? '',
          class: `grid-cell ${piece?.kind ?? ''}${selected ? ' is-cursor' : ''}`
        });
        cell.addEventListener('click', () => {
          cursor = { column, row };
          place();
        });
        rowNode.append(cell);
      }
      grid.append(rowNode);
    }
  };

  const place = (): void => {
    const kind = chosenKind();
    pieces = pieces.filter((piece) => !overlaps(piece, kind, cursor.column, cursor.row));
    pieces.push({ kind, column: cursor.column, row: cursor.row });
    drawGrid();
  };

  const overlaps = (piece: PieceJson, kind: Kind, column: number, row: number): boolean => {
    const width = kind === 'board' ? BOARD_WIDTH : 1;
    for (let offset = 0; offset < width; offset += 1) {
      if (covers(piece, column + offset, row)) return true;
    }
    return false;
  };

  const removeAtCursor = (): void => {
    pieces = pieces.filter((piece) => !covers(piece, cursor.column, cursor.row));
    drawGrid();
  };

  grid.addEventListener('keydown', (event) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1]
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      cursor = {
        column: Math.min(columns - 1, Math.max(0, cursor.column + move[0])),
        row: Math.min(rows - 1, Math.max(0, cursor.row + move[1]))
      };
      drawGrid();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      place();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeAtCursor();
    }
  });

  const resize = (): void => {
    columns = Number(columnsInput.value);
    rows = Number(rowsInput.value);
    cursor = {
      column: Math.min(cursor.column, Math.max(0, columns - 1)),
      row: Math.min(cursor.row, Math.max(0, rows - 1))
    };
    drawGrid();
  };
  columnsInput.addEventListener('input', resize);
  rowsInput.addEventListener('input', resize);

  save.addEventListener('click', () => {
    void (async () => {
      shell.showError(null);
      pending(save, true);
      shell.setStatus('Saving...');
      const layout: LayoutJson = { columns, rows, pieces };
      const answer = await api.put<{ layout: LayoutJson }>(`/api/classes/${classId}/layout`, layout);
      pending(save, false);
      if (answer.error !== null) {
        shell.setStatus('');
        shell.showError(answer.error);
        return;
      }
      shell.setStatus('Room saved.');
    })();
  });

  shell.body.append(
    element('h1', {}, ['Arrange the room']),
    element('div', { class: 'row' }, [
      element('label', { class: 'field' }, [element('span', {}, ['Columns']), columnsInput]),
      element('label', { class: 'field' }, [element('span', {}, ['Rows']), rowsInput]),
      pieceGroup
    ]),
    gridBox,
    save
  );

  void (async () => {
    const answer = await api.get<ClassDetail>(`/api/classes/${classId}`);
    if (answer.status === 404) {
      shell.showNotFound();
      return;
    }
    if (answer.error !== null) {
      shell.showError(answer.error);
      return;
    }
    columns = answer.body.layout.columns;
    rows = answer.body.layout.rows;
    pieces = answer.body.layout.pieces.map((piece) => ({ ...piece }));
    columnsInput.value = String(columns);
    rowsInput.value = String(rows);
    drawGrid();
  })();

  drawGrid();
  return shell.root;
}
