import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiFailure, w } from '../api';
import { Link, useTitle } from '../router';
import { useShell } from '../shell';
import { Button, EmptyState, Modal, Problem, Skeleton, useAccess } from '../ui';
import type { Json, TableView, WorkspaceInfo } from '../types';
import '../build/styles/site.css';

interface ColumnDraft {
  name: string;
  type: 'text' | 'number';
}

function NewTable({ workspaceId, onClose, onCreated }: { workspaceId: string; onClose: () => void; onCreated: () => void }) {
  const { say } = useShell();
  const [name, setName] = useState('');
  const [columns, setColumns] = useState<ColumnDraft[]>([{ name: '', type: 'text' }]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const change = (index: number, patch: Partial<ColumnDraft>): void => setColumns(columns.map((column, at) => (at === index ? { ...column, ...patch } : column)));
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    api.post(w(workspaceId, '/tables'), { name, columns }).then(
      () => {
        say('Table created');
        onCreated();
        onClose();
      },
      (error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        setProblem(error.message);
        setBusy(false);
      },
    );
  };
  return (
    <Modal label="New table" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="modal-head">
          <h2>New table</h2>
        </div>
        <Problem message={problem} field="table-name" />
        <div className="field">
          <label htmlFor="field-table-name">Table name</label>
          <input id="field-table-name" type="text" data-autofocus value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        {columns.map((column, index) => (
          <div key={index} className="col-row">
            <div className="field">
              <label htmlFor={`field-column-${index + 1}`}>{`Column name ${index + 1}`}</label>
              <input id={`field-column-${index + 1}`} type="text" value={column.name} onChange={(event) => change(index, { name: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`field-type-${index + 1}`}>{`Column type ${index + 1}`}</label>
              <select id={`field-type-${index + 1}`} value={column.type} onChange={(event) => change(index, { type: event.target.value as 'text' | 'number' })}>
                <option value="text">text</option>
                <option value="number">number</option>
              </select>
            </div>
          </div>
        ))}
        <Button variant="quiet" onClick={() => setColumns([...columns, { name: '', type: 'text' }])}>Add column</Button>
        <div className="modal-foot">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button type="submit" busy={busy}>Create table</Button>
        </div>
      </form>
    </Modal>
  );
}

export function Tables({ workspace }: { workspace: WorkspaceInfo }) {
  useTitle('Tables');
  const { locked } = useAccess();
  const { epoch, subscribe } = useShell();
  const [tables, setTables] = useState<TableView[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(async () => setTables((await api.get<{ tables: TableView[] }>(w(workspace.id, '/tables'))).tables), [workspace.id]);
  useEffect(() => {
    void load();
  }, [load, epoch]);
  useEffect(() => subscribe((event) => {
    if (event.type === 'table') void load();
  }), [subscribe, load]);
  return (
    <div>
      <div className="page-head">
        <h1>Tables</h1>
      </div>
      <div className="actions-row">
        <Button {...locked()} onClick={() => setCreating(true)}>New table</Button>
      </div>
      {tables === null ? (
        <Skeleton rows={3} />
      ) : tables.length === 0 ? (
        <EmptyState>No tables yet. Create one to hold rows for your automations.</EmptyState>
      ) : (
        <ul aria-label="Tables" className="row-list">
          {tables.map((table) => (
            <li key={table.id} className="row-item">
              <Link to={`/w/${workspace.id}/tables/${table.id}`} className="row-main">
                {table.name}
              </Link>
              <span className="row-meta">{table.columns.map((column) => column.name).join(', ')}</span>
              <span className="row-meta tabular">{table.row_count} rows</span>
            </li>
          ))}
        </ul>
      )}
      {creating ? <NewTable workspaceId={workspace.id} onClose={() => setCreating(false)} onCreated={() => void load()} /> : null}
    </div>
  );
}

const cell = (value: Json | undefined): string => (value === null || value === undefined ? '' : String(value));

export function TableDetail({ workspace, tableId }: { workspace: WorkspaceInfo; tableId: string }) {
  const { say, subscribe, epoch } = useShell();
  const { locked } = useAccess();
  const [table, setTable] = useState<TableView | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useTitle(table?.name ?? 'Table');
  const load = useCallback(async () => setTable(await api.get<TableView>(w(workspace.id, `/tables/${tableId}`))), [workspace.id, tableId]);
  useEffect(() => {
    void load();
  }, [load, epoch]);
  useEffect(() => subscribe((event) => {
    if (event.type === 'table' && event.table_id === tableId) void load();
  }), [subscribe, load, tableId]);

  if (table === null) return <Skeleton rows={4} />;
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    api.post(w(workspace.id, `/tables/${tableId}/rows`), { values }).then(
      async () => {
        say('Row added');
        setValues({});
        await load();
        setBusy(false);
      },
      (error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        setProblem(error.message);
        setBusy(false);
      },
    );
  };
  return (
    <div>
      <div className="page-head">
        <h1>{table.name}</h1>
        <Link to={`/w/${workspace.id}/tables`} className="btn btn-secondary">All tables</Link>
      </div>
      <div className="data-wrap" role="region" aria-label={`${table.name} rows`} tabIndex={0}>
        <table aria-label={table.name} className="data-table">
          <thead>
            <tr>
              <th scope="col">Row id</th>
              {table.columns.map((column) => (
                <th key={column.name} scope="col">
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(table.rows ?? []).map((row) => (
              <tr key={String(row._row_id)} data-row-id={String(row._row_id)}>
                <td>{String(row._row_id)}</td>
                {table.columns.map((column) => (
                  <td key={column.name}>{cell(row[column.name])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="add-row" onSubmit={submit} noValidate>
        <Problem message={problem} field={`row-${table.columns[0]?.name ?? ''}`} />
        <div className="add-row-fields">
          {table.columns.map((column) => (
            <div key={column.name} className="field">
              <label htmlFor={`field-row-${column.name}`}>{`New row: ${column.name}`}</label>
              <input
                id={`field-row-${column.name}`}
                type="text"
                inputMode={column.type === 'number' ? 'decimal' : undefined}
                value={values[column.name] ?? ''}
                onChange={(event) => setValues({ ...values, [column.name]: event.target.value })}
                {...locked()}
              />
            </div>
          ))}
        </div>
        <Button type="submit" busy={busy} {...locked()}>Add row</Button>
      </form>
    </div>
  );
}
