import {
  builderFileName,
  builderLayout,
  builderProblems,
  builderText,
  clueKey,
  defaultSymmetry,
  symmetryPartner,
  type BuilderDraft,
  type Symmetry,
} from '../../shared/builder';
import { copy } from '../../shared/copy';
import { directionLabel, type Direction } from '../../shared/grid';
import { api, ApiFailure } from '../api';
import { attr, el, replace } from '../dom';
import { app } from '../state';

const SYMMETRIES: Symmetry[] = ['None', 'Rotational', 'Left-right', 'Top-bottom', 'Diagonal'];

function emptyCells(cols: number, rows: number): string[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
}

export function mountBuilder(container: HTMLElement): void {
  const draft: BuilderDraft = {
    title: '',
    author: '',
    cols: 5,
    rows: 5,
    symmetry: 'None',
    cells: emptyCells(5, 5),
    clues: new Map(),
  };
  let selected = { row: 0, col: 0 };

  const band = el('div', { class: 'band ink', role: 'alert', hidden: true });
  const gridHost = el('div', {
    role: 'grid',
    'aria-label': 'Builder grid',
    class: 'grid builder-grid',
    tabindex: '0',
  });
  const clueHost = el('div', { class: 'tile builder-clues' });
  const problemsList = el('div', {
    role: 'list',
    'aria-label': 'Grid problems',
    class: 'problems-list',
  });
  const statusNode = el('div', { role: 'status', 'aria-label': 'Builder status', class: 'status' });
  const downloadButton = el('button', {
    type: 'button',
    class: 'button',
    text: 'Download text',
  }) as HTMLButtonElement;
  const saveButton = el('button', {
    type: 'button',
    class: 'button brass',
    text: 'Save to my puzzles',
  }) as HTMLButtonElement;

  const title = el('input', { type: 'text', class: 'field', 'aria-label': 'Title' }) as HTMLInputElement;
  const author = el('input', { type: 'text', class: 'field', 'aria-label': 'Author' }) as HTMLInputElement;
  const colsInput = el('input', {
    type: 'number',
    class: 'field',
    role: 'spinbutton',
    'aria-label': 'Columns',
    min: '3',
    max: String(app.config.max_grid),
    value: '5',
  }) as HTMLInputElement;
  const rowsInput = el('input', {
    type: 'number',
    class: 'field',
    role: 'spinbutton',
    'aria-label': 'Rows',
    min: '3',
    max: String(app.config.max_grid),
    value: '5',
  }) as HTMLInputElement;
  const symmetryHost = el('div', {
    role: 'radiogroup',
    'aria-label': 'Symmetry',
    class: 'symmetry',
  });

  const white = (row: number, col: number): boolean =>
    row >= 0 &&
    row < draft.rows &&
    col >= 0 &&
    col < draft.cols &&
    draft.cells[row][col] !== '#';

  function drawGrid(): void {
    const layout = builderLayout(draft);
    const rows: HTMLElement[] = [];
    for (let r = 0; r < draft.rows; r += 1) {
      const row = el('div', { role: 'row', class: 'grid-row' });
      for (let c = 0; c < draft.cols; c += 1) {
        const cell = draft.cells[r][c];
        const black = cell === '#';
        const number = layout.numbers.find((n) => n.row === r && n.col === c);
        const content = black ? 'black' : cell === '' ? 'empty' : cell;
        const node = el(
          'div',
          {
            role: 'gridcell',
            class: `cell${black ? ' black' : ''}`,
            'aria-label': `Row ${r + 1}, column ${c + 1}, ${content}`,
            'data-row': r,
            'data-col': c,
            'data-number': number ? number.number : null,
            'data-black': black ? 'true' : null,
            'aria-selected': selected.row === r && selected.col === c ? 'true' : 'false',
            onpointerdown: (event: Event) => {
              event.preventDefault();
              selected = { row: r, col: c };
              drawGrid();
              gridHost.focus();
            },
          },
          [
            number ? el('span', { class: 'cell-number', text: String(number.number) }) : null,
            el('span', { class: 'letter', text: black ? '' : cell }),
          ],
        );
        row.append(node);
      }
      rows.push(row);
    }
    replace(gridHost, rows);
    gridHost.style.setProperty('--cols', String(draft.cols));
    gridHost.style.setProperty('--rows', String(draft.rows));
  }

  function drawClues(): void {
    const layout = builderLayout(draft);
    const fields: HTMLElement[] = [];
    for (const direction of ['across', 'down'] as Direction[]) {
      for (const word of layout.words.filter((candidate) => candidate.direction === direction)) {
        const name = `${word.number} ${directionLabel(direction)} clue`;
        const field = el('input', {
          type: 'text',
          class: 'field',
          'aria-label': name,
          value: draft.clues.get(clueKey(direction, word.row, word.col)) ?? '',
        }) as HTMLInputElement;
        field.addEventListener('input', () => {
          draft.clues.set(clueKey(direction, word.row, word.col), field.value);
          drawProblems();
        });
        fields.push(el('label', { class: 'clue-field' }, [el('span', { text: name }), field]));
      }
    }
    replace(clueHost, [el('h2', { text: 'Clues' }), ...fields]);
  }

  function drawProblems(): void {
    const problems = builderProblems(draft);
    replace(
      problemsList,
      problems.map((problem) => el('div', { role: 'listitem', text: problem })),
    );
    statusNode.textContent =
      problems.length === 0 ? copy.builderReady : copy.builderProblems(problems.length);
    downloadButton.disabled = problems.length > 0;
    saveButton.disabled = problems.length > 0;
  }

  function drawSymmetry(): void {
    replace(
      symmetryHost,
      SYMMETRIES.map((symmetry) => {
        const input = el('input', {
          type: 'radio',
          name: 'symmetry',
          'aria-label': symmetry,
          checked: draft.symmetry === symmetry,
          disabled: symmetry === 'Diagonal' && draft.cols !== draft.rows,
          onchange: () => {
            draft.symmetry = symmetry;
          },
        });
        return el('label', { class: 'radio' }, [input, el('span', { text: symmetry })]);
      }),
    );
  }

  function redraw(): void {
    drawGrid();
    drawClues();
    drawProblems();
  }

  function resize(): void {
    const cols = Math.max(3, Math.min(app.config.max_grid, Number(colsInput.value) || 3));
    const rows = Math.max(3, Math.min(app.config.max_grid, Number(rowsInput.value) || 3));
    draft.cols = cols;
    draft.rows = rows;
    draft.cells = emptyCells(cols, rows);
    draft.clues.clear();
    draft.symmetry = defaultSymmetry(cols, rows);
    selected = { row: 0, col: 0 };
    drawSymmetry();
    redraw();
  }

  colsInput.addEventListener('change', resize);
  rowsInput.addEventListener('change', resize);
  title.addEventListener('input', () => {
    draft.title = title.value;
    drawProblems();
  });
  author.addEventListener('input', () => {
    draft.author = author.value;
    drawProblems();
  });

  function toggleBlack(): void {
    const { row, col } = selected;
    const next = draft.cells[row][col] === '#' ? '' : '#';
    draft.cells[row][col] = next;
    const partner = symmetryPartner(draft.symmetry, draft.cols, draft.rows, row, col);
    if (partner) draft.cells[partner.row][partner.col] = next;
    redraw();
  }

  gridHost.addEventListener('keydown', (event) => {
    const { row, col } = selected;
    if (/^[a-zA-Z]$/.test(event.key)) {
      event.preventDefault();
      if (!white(row, col)) return;
      draft.cells[row][col] = event.key.toUpperCase();
      let next = col + 1;
      while (next < draft.cols && !white(row, next)) next += 1;
      if (next < draft.cols) selected = { row, col: next };
      redraw();
      return;
    }
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        if (col > 0) selected = { row, col: col - 1 };
        drawGrid();
        return;
      case 'ArrowRight':
        event.preventDefault();
        if (col < draft.cols - 1) selected = { row, col: col + 1 };
        drawGrid();
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (row > 0) selected = { row: row - 1, col };
        drawGrid();
        return;
      case 'ArrowDown':
        event.preventDefault();
        if (row < draft.rows - 1) selected = { row: row + 1, col };
        drawGrid();
        return;
      case '.':
        event.preventDefault();
        toggleBlack();
        return;
      case 'Backspace': {
        event.preventDefault();
        if (white(row, col)) draft.cells[row][col] = '';
        let previous = col - 1;
        while (previous >= 0 && !white(row, previous)) previous -= 1;
        if (previous >= 0) selected = { row, col: previous };
        redraw();
        return;
      }
      case 'Delete':
        event.preventDefault();
        if (white(row, col)) draft.cells[row][col] = '';
        redraw();
        return;
      default:
        return;
    }
  });

  downloadButton.addEventListener('click', () => {
    const text = builderText(draft);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = builderFileName(draft.title);
    anchor.click();
    URL.revokeObjectURL(url);
  });

  saveButton.addEventListener('click', () => {
    void (async () => {
      const text = builderText(draft);
      try {
        const result = await api.upload(new Blob([text], { type: 'text/plain' }));
        band.hidden = true;
        statusNode.textContent = copy.builderSaved(result.puzzle.title);
      } catch (failure) {
        if (failure instanceof ApiFailure && failure.status === 503) {
          band.textContent = copy.storageOutageBuilder;
          band.hidden = false;
          return;
        }
        if (failure instanceof ApiFailure) statusNode.textContent = failure.body.message;
      }
    })();
  });

  const settingsTile = el('div', { class: 'tile builder-settings' }, [
    el('h2', { text: 'Puzzle' }),
    el('label', { class: 'label' }, [el('span', { text: 'Title' }), title]),
    el('label', { class: 'label' }, [el('span', { text: 'Author' }), author]),
    el('label', { class: 'label' }, [el('span', { text: 'Columns' }), colsInput]),
    el('label', { class: 'label' }, [el('span', { text: 'Rows' }), rowsInput]),
    symmetryHost,
  ]);
  const problemsTile = el('div', { class: 'tile builder-problems' }, [
    statusNode,
    problemsList,
    el('div', { class: 'tile-actions' }, [downloadButton, saveButton]),
  ]);

  container.append(
    band,
    el('div', { class: 'board builder' }, [
      settingsTile,
      el('div', { class: 'tile ink grid-tile builder-grid-tile' }, [gridHost]),
      clueHost,
      problemsTile,
    ]),
  );
  attr(gridHost, 'data-direction', 'across');
  drawSymmetry();
  redraw();
}
