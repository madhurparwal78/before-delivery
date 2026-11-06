import { useEffect, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import {
  bothKept as bothKeptCopy,
  announce as copy,
  csvCopy,
  empty,
  recordFields,
} from '../../domain/copy.ts';
import { CSV_BYTE_LIMIT, fromCsv, toCsv } from '../../domain/csv.ts';
import { formatNumber, isCalendarDate, parseNumber } from '../../domain/format.ts';
import { isBothKept, tableRows } from '../../domain/materialise.ts';
import {
  cellDisplay,
  cellValue,
  columnTotal,
  parseOptions,
  rowMatches,
  rowTitle,
  selectColumns,
} from '../../domain/records.ts';
import type { Column, ColumnType, RowRecord, TableRecord } from '../../domain/types.ts';
import { BothKept } from '../components/BothKept.tsx';
import { Dialog } from '../components/Dialog.tsx';
import { Menu } from '../components/Menu.tsx';
import { InspectorPanel } from '../components/Shell.tsx';
import { useStore } from '../hooks.ts';
import { replaceQuery, useRoute } from '../router.ts';
import { tables } from '../store/actions.ts';
import { announce } from '../store/store.ts';
import { NotFound } from './NotFound.tsx';

const NO_VALUE = 'No value';

const TYPE_LABELS: Record<ColumnType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  checkbox: 'Checkbox',
  select: 'Single select',
};

export function TableScreen(props: { tableId: string }) {
  const state = useStore();
  const route = useRoute();
  const table = state.workspace.tables.get(props.tableId);
  const boardView = route.query.get('view') === 'board';
  const [filter, setFilter] = useState('');
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<string | null>(null);

  if (!table) return <NotFound kind="page" />;

  const rows = tableRows(state.workspace, table.id);
  const shown = rows.filter((row) => rowMatches(row, table.columns, filter));

  return (
    <div className="screen table-screen">
      <div className="table-header">
        <input
          type="text"
          aria-label="Table name"
          className="display table-name"
          value={table.name}
          onChange={(event) => void tables.setName(table.id, event.target.value)}
          onBlur={(event) => {
            if (!event.target.value.trim()) void tables.setName(table.id, table.name || 'Untitled table');
          }}
        />
        <div role="radiogroup" aria-label="Table view" className="view-choice">
          {(['Table', 'Board'] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={boardView === (choice === 'Board')}
              tabIndex={boardView === (choice === 'Board') ? 0 : -1}
              className="button"
              onClick={() => replaceQuery({ view: choice.toLowerCase() })}
            >
              {choice}
            </button>
          ))}
        </div>
        <input
          type="search"
          aria-label="Filter rows"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <p role="status" aria-label="Row count" className="count">
          {`${shown.length} of ${rows.length} rows`}
        </p>
        <button type="button" className="button" onClick={() => void addRow(table)}>
          Add row
        </button>
        <button type="button" className="button" onClick={() => setAddColumnOpen(true)}>
          Add column
        </button>
        <button type="button" className="button" onClick={() => exportCsv(table, rows)}>
          Export CSV
        </button>
        <button type="button" className="button" onClick={() => setImportOpen(true)}>
          Import CSV
        </button>
      </div>

      <RowCountNotice shown={shown.length} total={rows.length} />

      {boardView ? (
        <Board table={table} rows={shown} groupBy={groupBy} onGroupBy={setGroupBy} />
      ) : (
        <Grid table={table} rows={shown} />
      )}

      <InspectorPanel>
        <div className="inspector-body">
          <h2 className="display">Columns</h2>
          <ul>
            {table.columns.map((column) => (
              <li key={column.id}>{`${column.name} — ${TYPE_LABELS[column.type]}`}</li>
            ))}
          </ul>
        </div>
      </InspectorPanel>

      {addColumnOpen && <AddColumnDialog table={table} onClose={() => setAddColumnOpen(false)} />}
      {importOpen && <ImportDialog table={table} onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function RowCountNotice(props: { shown: number; total: number }) {
  const spoken = useRef('');
  useEffect(() => {
    const sentence = copy.rowCount(props.shown, props.total);
    if (spoken.current && spoken.current !== sentence) announce(sentence);
    spoken.current = sentence;
  }, [props.shown, props.total]);
  return null;
}

async function addRow(table: TableRecord): Promise<void> {
  const rowId = await tables.addRow(table.id);
  window.setTimeout(() => {
    const cell = document.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [data-column-index="0"]`);
    cell?.focus();
  }, 0);
}

function exportCsv(table: TableRecord, rows: RowRecord[]): void {
  const blob = new Blob([toCsv(table, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${table.name}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function Grid(props: { table: TableRecord; rows: RowRecord[] }) {
  const { table, rows } = props;
  const [focusCell, setFocusCell] = useState({ row: 0, column: 0 });
  const [editing, setEditing] = useState<{ rowId: string; columnId: string; draft: string } | null>(null);
  const [error, setError] = useState('');

  const focusAt = (row: number, column: number) => {
    const bounded = {
      row: Math.max(0, Math.min(rows.length - 1, row)),
      column: Math.max(0, Math.min(table.columns.length - 1, column)),
    };
    setFocusCell(bounded);
    const target = rows[bounded.row];
    if (!target) return;
    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>(`[data-row-id="${target.id}"] [data-column-index="${bounded.column}"]`)
        ?.focus();
    }, 0);
  };

  const save = async (row: RowRecord, column: Column, raw: string): Promise<boolean> => {
    if (column.type === 'number') {
      if (raw.trim() === '') {
        await tables.setCell(row.id, column.id, null);
        return true;
      }
      const value = parseNumber(raw);
      if (value === null) {
        setError(recordFields.notANumber);
        announce(recordFields.notANumber);
        return false;
      }
      await tables.setCell(row.id, column.id, value);
      return true;
    }
    if (column.type === 'date') {
      if (raw.trim() === '') {
        await tables.setCell(row.id, column.id, null);
        return true;
      }
      if (!isCalendarDate(raw.trim())) {
        setError(recordFields.notADate);
        announce(recordFields.notADate);
        return false;
      }
      await tables.setCell(row.id, column.id, raw.trim());
      return true;
    }
    if (column.type === 'select') {
      await tables.setCell(row.id, column.id, raw ? raw : null);
      return true;
    }
    await tables.setCell(row.id, column.id, raw);
    return true;
  };

  const startEditing = (row: RowRecord, column: Column) => {
    setError('');
    setEditing({ rowId: row.id, columnId: column.id, draft: cellDisplay(cellValue(row, column.id), column) });
  };

  return (
    <div role="region" aria-label="Table rows" className="table-rows">
      <table role="grid" aria-label={table.name}>
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column.id} scope="col">
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!rows.length && (
            <tr>
              <td colSpan={table.columns.length}>
                <p className="empty">{empty.noRowMatch}</p>
              </td>
            </tr>
          )}
          {rows.map((row, rowIndex) => (
            <tr key={row.id} data-row-id={row.id}>
              {table.columns.map((column, columnIndex) => {
                const marked = isBothKept(row.cells[column.id]);
                const open = editing && editing.rowId === row.id && editing.columnId === column.id;
                const display = cellDisplay(cellValue(row, column.id), column);
                return (
                  <td
                    key={column.id}
                    role="gridcell"
                    data-column-index={columnIndex}
                    data-both-kept={marked ? 'true' : undefined}
                    tabIndex={focusCell.row === rowIndex && focusCell.column === columnIndex ? 0 : -1}
                    onClick={() => setFocusCell({ row: rowIndex, column: columnIndex })}
                    onDoubleClick={() => !marked && startEditing(row, column)}
                    onKeyDown={(event) => {
                      if (open || event.target !== event.currentTarget) return;
                      if (event.key === 'ArrowRight') {
                        event.preventDefault();
                        focusAt(rowIndex, columnIndex + 1);
                      } else if (event.key === 'ArrowLeft') {
                        event.preventDefault();
                        focusAt(rowIndex, columnIndex - 1);
                      } else if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        focusAt(rowIndex + 1, columnIndex);
                      } else if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        focusAt(rowIndex - 1, columnIndex);
                      } else if (event.key === 'Enter') {
                        event.preventDefault();
                        if (marked) {
                          window.setTimeout(() => {
                            document
                              .querySelector<HTMLElement>(
                                `[data-row-id="${row.id}"] [data-column-index="${columnIndex}"] .both-kept button`,
                              )
                              ?.focus();
                          }, 0);
                          return;
                        }
                        startEditing(row, column);
                      } else if (event.key === ' ' && column.type === 'checkbox') {
                        event.preventDefault();
                        void tables.setCell(row.id, column.id, cellValue(row, column.id) !== true);
                      }
                    }}
                  >
                    {open ? (
                      column.type === 'select' ? (
                        <select
                          aria-label={`Edit ${column.name}`}
                          autoFocus
                          value={editing.draft}
                          onChange={(event) => {
                            setEditing({ ...editing, draft: event.target.value });
                            void save(row, column, event.target.value).then(() => {
                              setEditing(null);
                              focusAt(rowIndex, columnIndex);
                            });
                          }}
                        >
                          <option value="">{''}</option>
                          {(column.options ?? []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          aria-label={`Edit ${column.name}`}
                          autoFocus
                          value={editing.draft}
                          onChange={(event) => setEditing({ ...editing, draft: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === 'Tab') {
                              event.preventDefault();
                              const draft = editing.draft;
                              void save(row, column, draft).then((ok) => {
                                if (!ok) return;
                                setEditing(null);
                                if (event.key === 'Tab') focusAt(rowIndex, columnIndex + 1);
                                else focusAt(rowIndex, columnIndex);
                              });
                              return;
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              setEditing(null);
                              setError('');
                              focusAt(rowIndex, columnIndex);
                            }
                          }}
                        />
                      )
                    ) : (
                      <span className="cell-text">{display}</span>
                    )}
                    {open && error && <p className="field-error">{error}</p>}
                    {marked && (
                      <BothKept
                        entity="row"
                        entityId={row.id}
                        field={`cell:${column.id}`}
                        values={row.cells[column.id]}
                        sentence={bothKeptCopy.cell}
                        valueText={(value) => cellDisplay(value, column)}
                        afterChoice={() => focusAt(rowIndex, columnIndex)}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            {table.columns.map((column) => (
              <td key={column.id} role="gridcell" aria-label={`Total ${column.name}`} tabIndex={-1}>
                {column.type === 'number' ? formatNumber(columnTotal(rows, column)) : ''}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Board(props: {
  table: TableRecord;
  rows: RowRecord[];
  groupBy: string | null;
  onGroupBy: (columnId: string) => void;
}) {
  const { table, rows } = props;
  const selects = selectColumns(table);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const column = selects.find((item) => item.id === props.groupBy) ?? selects[0] ?? null;

  if (!column) return <p className="empty">{empty.noSelectColumn}</p>;

  const options = [...(column.options ?? []), NO_VALUE];

  const moveRow = async (row: RowRecord, option: string) => {
    await tables.setCell(row.id, column.id, option === NO_VALUE ? null : option);
    announce(copy.boardCardMoved(rowTitle(row, table), option));
  };

  const moveBy = async (row: RowRecord, direction: 1 | -1) => {
    const current = (cellValue(row, column.id) as string) ?? NO_VALUE;
    const index = options.indexOf(current);
    const target = options[index + direction];
    if (!target) return;
    await moveRow(row, target);
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-card-row="${row.id}"]`)?.focus();
    }, 0);
  };

  return (
    <div className="board">
      <label className="inline-field">
        <span className="visually-hidden">Group by</span>
        <select aria-label="Group by" value={column.id} onChange={(event) => props.onGroupBy(event.target.value)}>
          {selects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <div className="board-columns">
        {options.map((option) => {
          const inColumn = rows.filter(
            (row) => ((cellValue(row, column.id) as string) ?? NO_VALUE) === option,
          );
          return (
            <section
              key={option}
              role="group"
              aria-label={option}
              className="paper board-column"
            >
              <h2>{option}</h2>
              <p>{inColumn.length}</p>
              <ul>
                {inColumn.map((row) => {
                  const title = rowTitle(row, table);
                  return (
                    <li key={row.id} className="board-card-holder">
                      <button
                        type="button"
                        className="paper board-card"
                        data-card-row={row.id}
                        onKeyDown={(event) => {
                          if (event.altKey && event.key === 'ArrowRight') {
                            event.preventDefault();
                            void moveBy(row, 1);
                          } else if (event.altKey && event.key === 'ArrowLeft') {
                            event.preventDefault();
                            void moveBy(row, -1);
                          }
                        }}
                      >
                        {title}
                      </button>
                      <button
                        type="button"
                        className="button icon-button"
                        aria-label={`Drag ${title}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          const onUp = (pointer: PointerEvent) => {
                            window.removeEventListener('pointerup', onUp);
                            const dropped = document
                              .elementFromPoint(pointer.clientX, pointer.clientY)
                              ?.closest<HTMLElement>('[role="group"]');
                            const target = dropped?.getAttribute('aria-label');
                            if (target && options.includes(target)) void moveRow(row, target);
                          };
                          window.addEventListener('pointerup', onUp);
                        }}
                      >
                        <GripVertical aria-hidden="true" size={16} />
                      </button>
                      <button
                        type="button"
                        className="button"
                        aria-label={`Move ${title}`}
                        aria-haspopup="menu"
                        onClick={() => setMenuFor(menuFor === row.id ? null : row.id)}
                      >
                        Move
                      </button>
                      {menuFor === row.id && (
                        <Menu
                          name={`Move ${title}`}
                          onClose={() => setMenuFor(null)}
                          items={options.map((target) => ({
                            label: target,
                            onChoose: () => void moveRow(row, target),
                          }))}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function AddColumnDialog(props: { table: TableRecord; onClose: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ColumnType>('text');
  const [options, setOptions] = useState('');
  const [error, setError] = useState('');

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(recordFields.emptyColumnName);
      announce(recordFields.emptyColumnName);
      return;
    }
    if (props.table.columns.some((column) => column.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(recordFields.columnNameInUse);
      announce(recordFields.columnNameInUse);
      return;
    }
    const parsed = parseOptions(options);
    if (type === 'select' && !parsed.length) {
      setError(recordFields.noOptions);
      announce(recordFields.noOptions);
      return;
    }
    await tables.addColumn(props.table.id, trimmed, type, parsed);
    props.onClose();
  };

  return (
    <Dialog name="Add column" onClose={props.onClose}>
      <h2 className="display">Add column</h2>
      <label className="field">
        <span>Column name</span>
        <input type="text" data-autofocus value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        <span>Column type</span>
        <select value={TYPE_LABELS[type]} onChange={(event) => setType(labelToType(event.target.value))}>
          {(Object.keys(TYPE_LABELS) as ColumnType[]).map((key) => (
            <option key={key} value={TYPE_LABELS[key]}>
              {TYPE_LABELS[key]}
            </option>
          ))}
        </select>
      </label>
      {type === 'select' && (
        <label className="field">
          <span>Options</span>
          <input type="text" value={options} onChange={(event) => setOptions(event.target.value)} />
        </label>
      )}
      {error && <p className="field-error">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={() => void add()}>
          Add column
        </button>
      </div>
    </Dialog>
  );
}

function labelToType(label: string): ColumnType {
  const found = (Object.keys(TYPE_LABELS) as ColumnType[]).find((key) => TYPE_LABELS[key] === label);
  return found ?? 'text';
}

function ImportDialog(props: { table: TableRecord; onClose: () => void }) {
  const [messages, setMessages] = useState<string[]>([]);
  const [chosen, setChosen] = useState<File | null>(null);

  const run = async () => {
    if (!chosen) return;
    if (chosen.size > CSV_BYTE_LIMIT) {
      setMessages([csvCopy.tooLarge]);
      announce(csvCopy.tooLarge);
      return;
    }
    const text = await chosen.text();
    const outcome = fromCsv(props.table, text);
    if (outcome.rows.length) await tables.appendRows(props.table.id, outcome.rows);
    setMessages(outcome.messages);
    announce(outcome.messages[0]);
  };

  return (
    <Dialog name="Import CSV" onClose={props.onClose}>
      <h2 className="display">Import CSV</h2>
      <label className="field">
        <span>Choose CSV file</span>
        <input
          type="file"
          accept=".csv,text/csv"
          data-autofocus
          onChange={(event) => setChosen(event.target.files?.[0] ?? null)}
        />
      </label>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={() => void run()}>
          Import
        </button>
      </div>
      <div role="region" aria-label="Import result" className="import-result">
        {messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>
    </Dialog>
  );
}
