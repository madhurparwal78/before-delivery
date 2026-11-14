import type { AnswerValue, ChoiceOption, EvalQuestion, StructureQuestion } from '../../../shared/types.ts';
import { h, isWide } from '../../lib/dom.ts';
import { isLocked } from '../locking.ts';
import { asRecord } from './answers.ts';
import type { Field, FieldEnv } from './field.ts';
import { optionRow } from './options.ts';
import { controlId, createShell, labelId } from './shell.ts';

interface Cell { element: HTMLElement; row: ChoiceOption; column: ChoiceOption }

/** The cell a key takes the person to, as [row, column] indexes, or null when the key does nothing here. */
function nextCell(event: KeyboardEvent, [row, column]: [number, number], rows: number, columns: number): [number, number] | null {
  switch (event.key) {
    case 'ArrowLeft': return [row, Math.max(column - 1, 0)];
    case 'ArrowRight': return [row, Math.min(column + 1, columns - 1)];
    case 'ArrowUp': return [Math.max(row - 1, 0), column];
    case 'ArrowDown': return [Math.min(row + 1, rows - 1), column];
    case 'Home': return event.ctrlKey ? [0, 0] : [row, 0];
    case 'End': return event.ctrlKey ? [rows - 1, columns - 1] : [row, columns - 1];
    default: return null;
  }
}

/**
 * A grid is two drawings of one answer. From 768 pixels it is a grid with one tab stop (arrows move, Space or Enter
 * selects); at 767 or less it is one radio group per row. The stylesheet shows the one that fits.
 */
export function gridField(item: EvalQuestion, spec: StructureQuestion, answer: AnswerValue | undefined, env: FieldEnv): Field {
  const shell = createShell(item, 'text');
  const rows = spec.rows ?? [];
  const columns = spec.columns ?? [];
  const selection = asRecord(answer);

  const cells: Cell[][] = rows.map((row) => columns.map((column) => ({
    row,
    column,
    element: h('div', { role: 'gridcell', class: 'grid-cell', 'aria-label': `${row.label}: ${column.label}`, 'aria-selected': 'false', tabindex: '-1' }),
  })));
  const cards = rows.map((row, index) => {
    const legend = h('legend', { id: `row-${item.key}-${index}`, class: 'grid-card-title' }, row.label);
    const radios = columns.map((column) => {
      const { row: label, input } = optionRow('radio', `${controlId(item.key)}-${index}`, column, selection[row.value] === column.value);
      input.addEventListener('change', () => select(row, column));
      return { label, input, column };
    });
    const card = h('fieldset', { role: 'radiogroup', 'aria-labelledby': legend.id, class: 'grid-card' }, legend, radios.map((radio) => radio.label));
    return { card, radios };
  });

  function paint(): void {
    cells.forEach((line) => line.forEach((cell) => {
      cell.element.setAttribute('aria-selected', String(selection[cell.row.value] === cell.column.value));
    }));
    cards.forEach(({ radios }, index) => radios.forEach((radio) => {
      radio.input.checked = selection[rows[index]?.value ?? ''] === radio.column.value;
    }));
  }

  function select(row: ChoiceOption, column: ChoiceOption): void {
    selection[row.value] = column.value;
    paint();
    env.commit(item.key, { ...selection });
  }

  function setTabStop(position: [number, number]): void {
    cells.forEach((line, rowIndex) => line.forEach((cell, columnIndex) => {
      cell.element.setAttribute('tabindex', rowIndex === position[0] && columnIndex === position[1] ? '0' : '-1');
    }));
  }

  cells.forEach((line, rowIndex) => line.forEach((cell, columnIndex) => {
    cell.element.addEventListener('focus', () => setTabStop([rowIndex, columnIndex]));
    cell.element.addEventListener('click', () => {
      if (!isLocked(cell.element)) select(cell.row, cell.column);
    });
    cell.element.addEventListener('keydown', (event) => {
      if (isLocked(cell.element)) return;
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        select(cell.row, cell.column);
        return;
      }
      const next = nextCell(event, [rowIndex, columnIndex], rows.length, columns.length);
      if (!next) return;
      event.preventDefault();
      cells[next[0]]?.[next[1]]?.element.focus();
    });
  }));
  setTabStop([0, 0]);
  paint();

  const wide = h('div', { role: 'grid', class: 'grid-wide', 'aria-labelledby': labelId(item.key), style: `--columns: ${columns.length}` },
    h('div', { role: 'row', class: 'grid-row' },
      h('span', { 'aria-hidden': 'true' }),
      columns.map((column) => h('span', { role: 'columnheader', class: 'grid-column' }, column.label))),
    rows.map((row, index) => h('div', { role: 'row', class: 'grid-row' },
      h('span', { role: 'rowheader', class: 'grid-rowheader' }, row.label),
      (cells[index] ?? []).map((cell) => cell.element))));
  const phone = h('div', { role: 'group', class: 'grid-cards', 'aria-labelledby': labelId(item.key) }, cards.map(({ card }) => card));
  shell.bind(wide, phone);
  shell.relabel(item.label, item.help);
  shell.root.append(wide, phone);

  /** The first cell of the first row that has no answer yet, or else the very first cell. */
  function firstUnanswered(): [number, number] {
    const row = rows.findIndex((entry) => selection[entry.value] === undefined);
    return [Math.max(row, 0), 0];
  }

  return {
    key: item.key,
    element: shell.root,
    update: (next) => shell.relabel(next.label, next.help),
    showError: shell.showError,
    clearError: shell.clearError,
    focusTarget: () => {
      const [row, column] = firstUnanswered();
      const card = cards[row];
      return (isWide() ? cells[row]?.[column]?.element : card?.radios[column]?.input) ?? shell.root;
    },
  };
}
