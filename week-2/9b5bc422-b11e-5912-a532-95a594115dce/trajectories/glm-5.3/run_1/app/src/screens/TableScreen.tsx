import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, rowPayload } from '../lib/app';
import { announce } from '../lib/announce';
import * as db from '../lib/store';
import { Dialog } from '../components/ui';
import { uuid, parseNumber, formatNumber, csvEscape, csvNeutralise, csvRestore, downloadText, parseIsoDate } from '../lib/util';
import type { Column, Row } from '../../shared/domain';
import { Plus, Upload, Download, GripVertical } from 'lucide-react';

export function TableScreen() {
  const { tableId } = useParams<{ tableId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const tables = useApp((s) => s.tables);
  const columns = useApp((s) => s.columns);
  const rows = useApp((s) => s.rows);
  const markChange = useApp((s) => s.markChange);
  const reload = useApp((s) => s.reload);

  const table = tables.find((t) => t.id === tableId);
  const tableColumns = useMemo(
    () => columns.filter((c) => c.tableId === tableId).sort((a, b) => a.order - b.order),
    [columns, tableId]
  );
  const tableRows = useMemo(
    () => rows.filter((r) => r.tableId === tableId).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    [rows, tableId]
  );

  const view = searchParams.get('view') === 'board' ? 'board' : 'table';
  const [filter, setFilter] = useState('');
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [focusCell, setFocusCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [editing, setEditing] = useState<{ rowId: string; colId: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [cellError, setCellError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  const shownRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tableRows;
    return tableRows.filter((r) =>
      tableColumns.some((c) => String(r.values[c.id] ?? '').toLowerCase().includes(q))
    );
  }, [tableRows, tableColumns, filter]);

  const total = tableRows.length;

  // Row count change announcement
  const lastCount = useRef(-1);
  useEffect(() => {
    if (lastCount.current >= 0 && lastCount.current !== shownRows.length) {
      announce(`Showing ${shownRows.length} of ${total} rows.`);
    }
    lastCount.current = shownRows.length;
  }, [shownRows.length, total]);

  if (!table) {
    return (
      <div className="empty-state paper" style={{ maxWidth: 480, margin: '48px auto' }}>
        <h1>We could not find that document.</h1>
        <p><a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Back to documents</a></p>
      </div>
    );
  }

  const updateRow = async (row: Row, colId: string, value: string | number | boolean | null) => {
    const updated = { ...row, values: { ...row.values, [colId]: value } };
    await db.putRow(updated);
    await markChange('row', row.id, tableId!, false, rowPayload(updated));
    await reload();
  };

  const updateTableName = async (name: string) => {
    if (!name.trim()) return; // clearing puts the previous name back
    const updated = { ...table, name };
    await db.putTable(updated);
    await markChange('table', table.id, null, false, { id: table.id, name, createdAt: table.createdAt, updatedAt: Date.now() });
    await reload();
  };

  const addRow = async () => {
    const id = uuid();
    const row: Row = { id, tableId: tableId!, values: {}, createdAt: Date.now() };
    await db.putRow(row);
    await markChange('row', id, tableId!, false, rowPayload(row));
    await reload();
    const firstCol = tableColumns[0];
    if (firstCol) {
      setFocusCell({ rowId: id, colId: firstCol.id });
    }
  };

  const addColumn = async (name: string, type: Column['type'], options: string) => {
    const trimmed = name.trim();
    const parsedOptions = options.split(',').map((o) => o.trim()).filter((o, i, arr) => o !== '' && arr.indexOf(o) === i);
    if (!trimmed) {
      announce('Enter a column name.');
      return { error: 'Enter a column name.' };
    }
    if (tableColumns.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      announce('That column name is already used.');
      return { error: 'That column name is already used.' };
    }
    if (type === 'select' && parsedOptions.length === 0) {
      announce('Enter at least one option.');
      return { error: 'Enter at least one option.' };
    }
    const id = uuid();
    const col: Column = { id, tableId: tableId!, name: trimmed, type, options: parsedOptions, order: tableColumns.length };
    await db.putColumn(col);
    await markChange('column', id, tableId!, false, col);
    await reload();
    setAddColumnOpen(false);
    return { error: null };
  };

  const exportCsv = () => {
    const heading = tableColumns.map((c) => csvEscape(csvNeutralise(c.name))).join(',');
    const lines = [heading];
    for (const row of tableRows) {
      lines.push(
        tableColumns
          .map((c) => {
            const v = row.values[c.id];
            if (c.type === 'checkbox') return v === true || v === 'true' ? 'true' : 'false';
            if (c.type === 'number') return typeof v === 'number' ? formatNumber(v) : v ? String(v) : '';
            return csvEscape(csvNeutralise(v == null ? '' : String(v)));
          })
          .join(',')
      );
    }
    downloadText(`${table.name}.csv`, lines.join('\r\n'));
  };

  const cellText = (row: Row, col: Column): string => {
    const v = row.values[col.id];
    if (col.type === 'number') return v == null || v === '' ? '' : formatNumber(Number(v));
    return v == null ? '' : String(v);
  };

  const commitEdit = async (row: Row, col: Column, value: string) => {
    if (col.type === 'number') {
      if (value.trim() !== '' && parseNumber(value) === null) {
        setCellError('Enter a number.');
        announce('Enter a number.');
        return;
      }
      const num = value.trim() === '' ? '' : parseNumber(value);
      await updateRow(row, col.id, num === '' ? '' : num);
    } else if (col.type === 'date') {
      if (value.trim() !== '' && !parseIsoDate(value)) {
        setCellError('Enter a date as YYYY-MM-DD.');
        announce('Enter a date as YYYY-MM-DD.');
        return;
      }
      await updateRow(row, col.id, value.trim());
    } else {
      await updateRow(row, col.id, value);
    }
    setEditing(null);
    setFocusCell({ rowId: row.id, colId: col.id });
  };

  const boardColumn = tableColumns.find((c) => c.type === 'select');

  return (
    <div>
      <div className="heading-row">
        <input
          ref={nameRef}
          className="serif"
          aria-label="Table name"
          value={table.name}
          onChange={(e) => updateTableName(e.target.value)}
          style={{ fontSize: '1.4rem', border: 'none', background: 'transparent', fontWeight: 700, minWidth: 200 }}
        />
        <div role="radiogroup" aria-label="Table view" style={{ display: 'flex', gap: 8 }}>
          {(['Table', 'Board'] as const).map((v) => (
            <button
              key={v}
              role="radio"
              aria-checked={(v === 'Table') === (view === 'table')}
              className="button"
              style={(v === 'Table') === (view === 'table') ? { borderColor: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent)' } : undefined}
              onClick={() => setSearchParams(v === 'Table' ? { view: 'table' } : { view: 'board' })}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-bar">
        <input
          type="search"
          placeholder="Filter rows"
          aria-label="Filter rows"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="count-text" role="status" aria-label="Row count">
          {shownRows.length} of {total} rows
        </span>
        <button className="button" onClick={addRow}><Plus size={18} aria-hidden /> Add row</button>
        <button className="button" onClick={() => setAddColumnOpen(true)}>Add column</button>
        <button className="button" onClick={exportCsv}><Download size={18} aria-hidden /> Export CSV</button>
        <button className="button" onClick={() => setImportOpen(true)}><Upload size={18} aria-hidden /> Import CSV</button>
      </div>
      {shownRows.length === 0 && tableRows.length > 0 && (
        <div className="empty-state paper">No rows match.</div>
      )}
      {view === 'table' ? (
        <div className="table-rows" role="region" aria-label="Table rows">
          <table className="grid-table" aria-label={table.name}>
            <thead>
              <tr>
                <th style={{ minWidth: 40 }} aria-label="" />
                {tableColumns.map((c) => (
                  <th key={c.id} scope="col">{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownRows.map((row) => (
                <tr key={row.id}>
                  <td style={{ minWidth: 40 }} />
                  {tableColumns.map((col) => {
                    const isFocused = focusCell?.rowId === row.id && focusCell?.colId === col.id;
                    const isEditing = editing?.rowId === row.id && editing?.colId === col.id;
                    return (
                      <td
                        key={col.id}
                        tabIndex={isFocused ? 0 : -1}
                        data-cell={`${row.id}:${col.id}`}
                        aria-selected={isFocused}
                        onClick={() => {
                          setFocusCell({ rowId: row.id, colId: col.id });
                        }}
                        onDoubleClick={() => {
                          setEditing({ rowId: row.id, colId: col.id });
                          setDraft(cellText(row, col));
                        }}
                        onKeyDown={(e) => {
                          if (isEditing) return;
                          handleGridKey(e, row, col, {
                            setFocusCell,
                            setEditing,
                            setDraft,
                            commitEdit,
                            cellText,
                            tableColumns,
                            shownRows,
                            updateRow,
                          });
                        }}
                        ref={(el) => {
                          if (el && isFocused && document.activeElement !== el && !editing) el.focus();
                        }}
                      >
                        {isEditing ? (
                          col.type === 'select' ? (
                            <select
                              className="cell-editor"
                              autoFocus
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Tab') {
                                  e.preventDefault();
                                  void commitEdit(row, col, e.currentTarget.value);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setEditing(null);
                                  setCellError('');
                                  setFocusCell({ rowId: row.id, colId: col.id });
                                }
                              }}
                              onBlur={() => void commitEdit(row, col, draft)}
                            >
                              <option value=""></option>
                              {col.options.map((o) => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="cell-editor"
                              autoFocus
                              value={draft}
                              aria-label={`Edit ${col.name}`}
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Tab') {
                                  e.preventDefault();
                                  void commitEdit(row, col, e.currentTarget.value);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setEditing(null);
                                  setCellError('');
                                  setFocusCell({ rowId: row.id, colId: col.id });
                                }
                              }}
                            />
                          )
                        ) : col.type === 'checkbox' ? (
                          <input
                            type="checkbox"
                            aria-label={`${col.name} of row`}
                            checked={row.values[col.id] === true || row.values[col.id] === 'true'}
                            onChange={(e) => updateRow(row, col.id, e.target.checked)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          cellText(row, col)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ minWidth: 40 }} />
                {tableColumns.map((c) => (
                  <td key={c.id}>
                    {c.type === 'number' ? (
                      <span aria-label={`Total ${c.name}`}>
                        {shownRows.reduce((sum, r) => sum + (Number(r.values[c.id] ?? 0) || 0), 0).toFixed(2)}
                      </span>
                    ) : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : boardColumn ? (
        <Board
          rows={shownRows}
          boardColumn={boardColumn}
          onMove={(row, value) => updateRow(row, boardColumn.id, value || null)}
        />
      ) : (
        <div className="empty-state paper">Add a single select column to use the board.</div>
      )}
      {cellError && <p className="field-error" role="alert">{cellError}</p>}
      {addColumnOpen && (
        <AddColumnDialog onClose={() => setAddColumnOpen(false)} onAdd={addColumn} />
      )}
      {importOpen && (
        <ImportDialog
          table={table}
          columns={tableColumns}
          onClose={() => setImportOpen(false)}
          onImport={async (newRows, errors) => {
            for (const row of newRows) {
              await db.putRow(row);
              await markChange('row', row.id, tableId!, false, rowPayload(row));
            }
            await reload();
            return errors;
          }}
        />
      )}
    </div>
  );
}

function handleGridKey(
  e: React.KeyboardEvent,
  row: Row,
  col: Column,
  ctx: {
    setFocusCell: (c: { rowId: string; colId: string } | null) => void;
    setEditing: (c: { rowId: string; colId: string } | null) => void;
    setDraft: (v: string) => void;
    commitEdit: (row: Row, col: Column, value: string) => Promise<void>;
    cellText: (row: Row, col: Column) => string;
    tableColumns: Column[];
    shownRows: Row[];
    updateRow: (row: Row, colId: string, value: string | number | boolean | null) => Promise<void>;
  }
) {
  const { setFocusCell, setEditing, setDraft, cellText, tableColumns, shownRows, updateRow } = ctx;
  const rowIdx = shownRows.findIndex((r) => r.id === row.id);
  const colIdx = tableColumns.findIndex((c) => c.id === col.id);
  const move = (dr: number, dc: number) => {
    const nr = shownRows[rowIdx + dr];
    const nc = tableColumns[colIdx + dc];
    if (nr && nc) setFocusCell({ rowId: nr.id, colId: nc.id });
  };
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    move(0, 1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    move(0, -1);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    move(1, 0);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    move(-1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    setEditing({ rowId: row.id, colId: col.id });
    setDraft(cellText(row, col));
  } else if (e.key === ' ' && col.type === 'checkbox') {
    e.preventDefault();
    void updateRow(row, col.id, !(row.values[col.id] === true || row.values[col.id] === 'true'));
  }
}

function AddColumnDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (name: string, type: Column['type'], options: string) => Promise<{ error: string | null }>;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<Column['type']>('text');
  const [options, setOptions] = useState('');
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const submit = async () => {
    const r = await onAdd(name, type, options);
    if (r.error) setError(r.error);
  };

  return (
    <Dialog label="Add column" onClose={onClose} initialFocusRef={nameRef}>
      <h2>Add column</h2>
      <div className="field" style={{ marginBottom: 10 }}>
        <label htmlFor="col-name">Column name</label>
        <input id="col-name" ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} />
        {error === 'Enter a column name.' && <p className="field-error" role="alert">{error}</p>}
        {error === 'That column name is already used.' && <p className="field-error" role="alert">{error}</p>}
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <label htmlFor="col-type">Column type</label>
        <select id="col-type" value={type} onChange={(e) => setType(e.target.value as Column['type'])}>
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="date">Date</option>
          <option value="checkbox">Checkbox</option>
          <option value="select">Single select</option>
        </select>
      </div>
      {type === 'select' && (
        <div className="field" style={{ marginBottom: 10 }}>
          <label htmlFor="col-options">Options</label>
          <input id="col-options" value={options} onChange={(e) => setOptions(e.target.value)} />
          {error === 'Enter at least one option.' && <p className="field-error" role="alert">{error}</p>}
        </div>
      )}
      <div className="row">
        <button className="button" onClick={onClose}>Close</button>
        <button className="button accent-button" onClick={submit}>Add column</button>
      </div>
    </Dialog>
  );
}

function ImportDialog({
  table,
  columns,
  onClose,
  onImport,
}: {
  table: { id: string; name: string };
  columns: Column[];
  onClose: () => void;
  onImport: (rows: Row[], errors: string[]) => Promise<string[]>;
}) {
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) {
      setResult('That CSV is larger than 1,000,000 bytes.');
      return;
    }
    const text = await file.text();
    const parsed = parseCsv(text);
    const heading = parsed[0] ?? [];
    // the heading row must match the table's columns in any order
    const restoredHeading = heading.map(csvRestore);
    const names = columns.map((c) => c.name);
    if (
      restoredHeading.length !== names.length ||
      !names.every((n) => restoredHeading.includes(n))
    ) {
      setResult(`The first row must match this table's columns: ${names.join(', ')}.`);
      return;
    }
    const order = restoredHeading.map((n) => columns.find((c) => c.name === n)!);
    const errors: string[] = [];
    const good: Row[] = [];
    parsed.slice(1).forEach((cells, i) => {
      const rowId = uuid();
      const values: Record<string, string | number | boolean | null> = {};
      let bad = false;
      order.forEach((col, ci) => {
        const raw = cells[ci] ?? '';
        const value = col.type === 'text' || col.type === 'select' ? csvRestore(raw) : raw;
        if (col.type === 'number') {
          if (value === '') {
            values[col.id] = '';
          } else {
            const n = parseNumber(String(value));
            if (n === null) {
              errors.push(`Row ${i + 1}: ${col.name} must be a number.`);
              bad = true;
            } else values[col.id] = n;
          }
        } else if (col.type === 'date') {
          if (value === '') values[col.id] = '';
          else if (!parseIsoDate(String(value))) {
            errors.push(`Row ${i + 1}: ${col.name} must be a date as YYYY-MM-DD.`);
            bad = true;
          } else values[col.id] = value;
        } else if (col.type === 'checkbox') {
          if (value === 'true') values[col.id] = true;
          else if (value === 'false' || value === '') values[col.id] = false;
          else {
            errors.push(`Row ${i + 1}: ${col.name} must be true or false.`);
            bad = true;
          }
        } else if (col.type === 'select') {
          if (value === '') values[col.id] = '';
          else if (col.options.includes(String(value))) values[col.id] = value;
          else {
            errors.push(`Row ${i + 1}: ${col.name} must be one of the listed options.`);
            bad = true;
          }
        } else {
          values[col.id] = value;
        }
      });
      if (!bad) good.push({ id: rowId, tableId: table.id, values, createdAt: Date.now() + i });
    });
    setPending(true);
    await onImport(good, errors);
    setPending(false);
    const summary = `Imported ${good.length} rows. Skipped ${errors.length} rows.`;
    setResult([summary, ...errors].join(' '));
    announce(summary);
  };

  return (
    <Dialog label="Import CSV" onClose={onClose}>
      <h2>Import CSV</h2>
      <div className="field" style={{ marginBottom: 10 }}>
        <label htmlFor="csv-file">Choose CSV file</label>
        <input id="csv-file" type="file" ref={fileRef} accept=".csv,text/csv" />
      </div>
      <div className="row" style={{ justifyContent: 'flex-start' }}>
        <button className="button accent-button" disabled={pending} onClick={run}>Import</button>
        <button className="button" onClick={onClose}>Close</button>
      </div>
      {result && (
        <div role="region" aria-label="Import result" className="field-error" style={{ marginTop: 10 }}>
          {result}
        </div>
      )}
    </Dialog>
  );
}

// Standard CSV parsing with quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function BoardCard({
  row,
  boardColumn,
  onMove,
  dragRow,
}: {
  row: Row;
  boardColumn: Column;
  onMove: (row: Row, value: string) => void;
  dragRow: React.MutableRefObject<string | null>;
}) {
  const title = rowTitle(row, boardColumn);
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const openerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const options = [...boardColumn.options, ''];
  useEffect(() => {
    if (menuOpen) {
      menuRef.current?.querySelector<HTMLElement>('button')?.focus();
      setHighlight(0);
    }
  }, [menuOpen]);
  const move = (value: string) => {
    setMenuOpen(false);
    openerRef.current?.focus();
    onMove(row, value);
    announce(`Moved ${title} to ${value || 'No value'}.`);
  };
  return (
    <div
      className="board-card"
      role="button"
      tabIndex={0}
      aria-label={title}
      draggable
      onDragStart={() => (dragRow.current = row.id)}
      onKeyDown={(e) => {
        if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
          e.preventDefault();
          const current = String(row.values[boardColumn.id] ?? '');
          const idx = options.indexOf(current);
          const next = options[Math.max(0, Math.min(options.length - 1, idx + (e.key === 'ArrowRight' ? 1 : -1)))];
          onMove(row, next);
          announce(`Moved ${title} to ${next || 'No value'}.`);
        }
      }}
    >
      <GripVertical size={16} aria-hidden aria-label={`Drag ${title}`} />
      <span>{title}</span>
      <div style={{ position: 'relative', marginTop: 6 }}>
        <button
          ref={openerRef}
          className="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Move ${title}`}
          onClick={() => setMenuOpen((o) => !o)}
          style={{ padding: '4px 10px', minHeight: 44 }}
        >
          Move
        </button>
        {menuOpen && (
          <div
            className="menu"
            ref={menuRef}
            role="menu"
            aria-label={`Move ${title}`}
            style={{ left: 0, top: '100%' }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setMenuOpen(false);
                openerRef.current?.focus();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlight((h) => (h + 1) % options.length);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight((h) => (h - 1 + options.length) % options.length);
              }
            }}
          >
            {options.map((o, i) => (
              <button
                key={o}
                role="menuitem"
                className={i === highlight ? 'highlighted' : ''}
                aria-selected={i === highlight}
                tabIndex={-1}
                onClick={() => move(o)}
              >
                {o || 'No value'}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Board({
  rows,
  boardColumn,
  onMove,
}: {
  rows: Row[];
  boardColumn: Column;
  onMove: (row: Row, value: string) => void;
}) {
  const groups = [...boardColumn.options, ''];
  const dragRow = useRef<string | null>(null);

  return (
    <div className="board" role="region" aria-label="Board">
      {groups.map((option) => {
        const groupRows = rows.filter((r) => (r.values[boardColumn.id] ?? '') === option);
        return (
          <div key={option || 'none'} className="board-column" role="group" aria-label={option || 'No value'}
               onDragOver={(e) => e.preventDefault()}
               onDrop={() => {
                 const row = rows.find((r) => r.id === dragRow.current);
                 if (row) {
                   onMove(row, option);
                   announce(`Moved ${rowTitle(row, boardColumn)} to ${option || 'No value'}.`);
                 }
                 dragRow.current = null;
               }}>
            <h3>{option || 'No value'} <span className="count-text">({groupRows.length})</span></h3>
            {groupRows.map((row) => (
              <BoardCard key={row.id} row={row} boardColumn={boardColumn} onMove={onMove} dragRow={dragRow} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function rowTitle(row: Row, firstTextColumn: Column): string {
  const textCols = [firstTextColumn];
  for (const col of textCols) {
    const v = row.values[col.id];
    if (v) return String(v);
  }
  return 'Untitled';
}
