import { useEffect, useRef, useState } from 'react';
import { LimitsDto, SessionUser, WorkbookSummary } from '../../shared/api';
import { SEASON_LABELS } from '../../shared/season';
import { roleCan } from '../../shared/roles';
import { ApiFailure, api, apiMultipart, requestKey } from '../lib/api';
import {
  WORKBOOK_NAME_ERROR,
  importFailureText,
  importLimitLines,
  stamp,
} from '../lib/copy';
import { notify } from '../lib/notices';
import { navigate } from '../lib/router';
import { Dialog, FieldError } from '../components/shell';

interface ListProps {
  user: SessionUser;
  limits: LimitsDto | null;
}

export function ListScreen({ user, limits }: ListProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [workbooks, setWorkbooks] = useState<WorkbookSummary[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const load = async (search: string) => {
    try {
      const result = await api<{ workbooks: WorkbookSummary[] }>(
        `/api/workbooks${search ? `?q=${encodeURIComponent(search)}` : ''}`,
      );
      setWorkbooks(result.workbooks);
    } catch {
      /* the list keeps what it had */
    }
  };

  useEffect(() => {
    void load(query);
  }, [query]);

  const canCreate = roleCan(user.role, 'createWorkbooks');

  return (
    <main className="list-screen">
      <div className="list-header">
        <h1>Workbooks</h1>
        <div className="list-actions">
          <input
            type="search"
            aria-label="Search workbooks"
            placeholder="Search by name"
            maxLength={100}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {canCreate ? (
            <>
              <button type="button" className="primary-button" onClick={() => setShowCreate(true)}>
                Create workbook
              </button>
              <button type="button" className="ghost-button" onClick={() => setShowImport(true)}>
                Import workbook
              </button>
            </>
          ) : null}
        </div>
      </div>

      {workbooks.length === 0 && query !== '' ? (
        <p className="muted">No workbooks match &quot;{query}&quot;.</p>
      ) : null}

      <ul className="workbook-list" aria-label="Workbooks">
        {workbooks.map((workbook) => (
          <li key={workbook.id} className="workbook-row">
            <a
              className="workbook-link"
              href={`/w/${workbook.id}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(`/w/${workbook.id}`);
              }}
            >
              {workbook.name}
            </a>
            <span className={`season-chip ${workbook.state}`}>{SEASON_LABELS[workbook.state]}</span>
            <span className="row-line numerals">
              {workbook.closesAtUtc ? `Cutoff ${stamp(workbook.closesAtUtc, user.timeZone)}` : 'No cutoff'}
            </span>
            <span className="row-line numerals">Updated {stamp(workbook.updatedAt, user.timeZone)}</span>
          </li>
        ))}
      </ul>

      {showCreate ? (
        <CreateWorkbookDialog
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            notify('Workbook created.');
            navigate(`/w/${id}`);
          }}
        />
      ) : null}

      {showImport ? (
        <ImportWorkbookDialog
          limits={limits}
          onClose={() => setShowImport(false)}
          onImported={(id, name, sheets) => {
            notify(`Imported ${name} with ${sheets} ${sheets === 1 ? 'sheet' : 'sheets'}.`);
            navigate(`/w/${id}`);
          }}
        />
      ) : null}
    </main>
  );
}

function CreateWorkbookDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const key = useRef(requestKey());

  const submit = async () => {
    setPending(true);
    setFailure(null);
    try {
      const result = await api<{ workbook: WorkbookSummary }>('/api/workbooks', {
        method: 'POST',
        body: { name },
        key: key.current,
      });
      onCreated(result.workbook.id);
    } catch (problem) {
      setFailure(problem instanceof ApiFailure ? problem.field('name') ?? WORKBOOK_NAME_ERROR : WORKBOOK_NAME_ERROR);
      setPending(false);
    }
  };

  return (
    <Dialog title="Create workbook" onClose={onClose}>
      <label className="field">
        <span>Workbook name</span>
        <input type="text" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
      </label>
      <FieldError text={failure} />
      <div className="dialog-actions">
        <button type="button" className="primary-button" disabled={pending} onClick={submit}>
          {pending ? 'Creating…' : 'Create'}
        </button>
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

function ImportWorkbookDialog({
  limits,
  onClose,
  onImported,
}: {
  limits: LimitsDto | null;
  onClose: () => void;
  onImported: (id: string, name: string, sheets: number) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const key = useRef(requestKey());

  const submit = async () => {
    if (!file) {
      setFailure('Choose a workbook file to import.');
      return;
    }
    setPending(true);
    setFailure(null);
    const form = new FormData();
    form.append('file', file);
    if (name.trim() !== '') form.append('name', name.trim());
    try {
      const result = await apiMultipart<{ workbook: WorkbookSummary; sheets: { id: string; name: string }[] }>(
        '/api/workbooks/import',
        form,
        key.current,
      );
      onImported(result.workbook.id, result.workbook.name, result.sheets.length);
    } catch (problem) {
      if (problem instanceof ApiFailure) {
        setFailure(problem.field('name') ?? importFailureText(problem.code, problem.limit));
      } else {
        setFailure('That file could not be imported.');
      }
      setPending(false);
    }
  };

  return (
    <Dialog title="Import workbook" onClose={onClose}>
      <label className="field">
        <span>Workbook file</span>
        <input
          type="file"
          accept=".xlsx,.csv"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <label className="field">
        <span>Workbook name</span>
        <input type="text" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
      </label>
      <ul className="limits-list" aria-label="Import limits">
        {(limits ? importLimitLines(limits) : []).map((line) => (
          <li key={line} className="numerals">
            {line}
          </li>
        ))}
      </ul>
      <FieldError text={failure} />
      <div className="dialog-actions">
        <button type="button" className="primary-button" disabled={pending} onClick={submit}>
          {pending ? 'Importing…' : 'Import'}
        </button>
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
