import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { TermBody } from '../../shared/api';
import { apiGet, apiJson, errorMessage } from './api';
import { useAuth, useActivityStream } from './App';
import { COPY, useViewport } from './hooks';
import { TopBar, useStatus } from './TopBar';
import { Dialog } from './ui';

export function GlossaryScreen(): ReactNode {
  const { user } = useAuth();
  const viewport = useViewport();
  const status = useStatus(!!user);
  const { events } = useActivityStream(!!user, null);
  const [terms, setTerms] = useState<TermBody[]>([]);
  const [updates, setUpdates] = useState('');
  const [dialog, setDialog] = useState<'new' | { edit: TermBody } | null>(null);
  const [name, setName] = useState('');
  const [definition, setDefinition] = useState('');
  const [revision, setRevision] = useState(1);
  const [dialogStatus, setDialogStatus] = useState('');
  const [dialogErrors, setDialogErrors] = useState<Record<string, string>>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const refreshSeq = useRef(0);

  const writable = user?.role === 'Steward' || user?.role === 'Admin';

  const load = async (): Promise<void> => {
    const res = await apiGet<{ terms: TermBody[] }>('/api/terms');
    if (res.status === 200) setTerms(res.body.terms);
  };

  useEffect(() => {
    void load();
  }, []);

  // Another person's rename reaches an open Glossary in place (DP-75).
  useEffect(() => {
    const relevant = events.filter((e) => e.action.startsWith('term.'));
    if (relevant.length === 0) return;
    const seq = ++refreshSeq.current;
    void (async () => {
      const before = new Map(terms.map((t) => [t.id, t.name]));
      const res = await apiGet<{ terms: TermBody[] }>('/api/terms');
      if (refreshSeq.current !== seq || res.status !== 200) return;
      setTerms(res.body.terms);
      const renamed = res.body.terms.find((t) => before.get(t.id) !== undefined && before.get(t.id) !== t.name);
      if (renamed && before.get(renamed.id)) {
        setUpdates(COPY.termRenamed(before.get(renamed.id)!, renamed.name));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  if (!user) return null;

  const openNew = (): void => {
    setName('');
    setDefinition('');
    setRevision(1);
    setDialogErrors({});
    setDialogStatus('');
    setDialog('new');
  };

  const openEdit = (term: TermBody): void => {
    setName(term.name);
    setDefinition(term.definition);
    setRevision(term.revision);
    setDialogErrors({});
    setDialogStatus('');
    setDialog({ edit: term });
  };

  const closeDialog = (): void => {
    const term = dialog && dialog !== 'new' ? dialog.edit : null;
    setDialog(null);
    if (term) {
      const btn = document.querySelector<HTMLButtonElement>(`[data-edit-term="${term.id}"]`);
      btn?.focus();
    } else {
      document.querySelector<HTMLButtonElement>('[data-new-term]')?.focus();
    }
  };

  const save = async (): Promise<void> => {
    setDialogStatus(COPY.saving);
    const isEdit = dialog !== 'new';
    const res = isEdit
      ? await apiJson<{ term: TermBody }>('PATCH', `/api/terms/${(dialog as { edit: TermBody }).edit.id}`, {
          revision,
          name,
          definition,
        })
      : await apiJson<{ term: TermBody }>('POST', '/api/terms', { name, definition });
    if (res.status === 200 || res.status === 201) {
      setDialogStatus('');
      setDialog(null);
      await load();
      // Focus moves to the saved term's Edit button at its glossary position.
      requestAnimationFrame(() => {
        const btn = document.querySelector<HTMLButtonElement>(`[data-edit-term="${res.body.term.id}"]`);
        btn?.focus();
      });
    } else if (res.status === 422) {
      const fields = (res.body as { error?: { fields?: Record<string, string> } }).error?.fields ?? {};
      setDialogErrors(fields);
      setDialogStatus(Object.values(fields)[0] ?? '');
    } else {
      setDialogStatus(errorMessage(res.body, 'The save was refused.'));
    }
  };

  return (
    <div className="screen">
      <TopBar user={user} />
      {status?.evidence === 'down' && (
        <div role="alert" className="banner">
          {COPY.evidenceOutage}
        </div>
      )}
      {status?.mail === 'down' && (
        <div role="alert" className="banner">
          {COPY.mailOutage}
        </div>
      )}
      <main data-motion={window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full'}>
        <h1 className="screen-heading">Glossary</h1>
        {writable && (
          <button type="button" className="btn" data-new-term onClick={openNew}>
            New term
          </button>
        )}
        <p role="status" aria-label="Glossary updates" aria-live="polite" className="status glossary-updates">
          {updates}
        </p>
        <ul className={`glossary-grid cols-${viewport.narrow ? 1 : viewport.medium ? 2 : 3}`} aria-label="Terms">
          {terms.map((term) => (
            <li key={term.id} className="term-card" data-revision={term.revision} data-term-id={term.id}>
              <h2 className="term-name">{term.name}</h2>
              <p className="term-definition">{term.definition}</p>
              <div className="term-assets">
                {term.assets.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      window.location.href = `/catalog?asset=${encodeURIComponent(a.id)}`;
                    }}
                  >
                    {a.id}
                  </button>
                ))}
              </div>
              {writable && (
                <button type="button" className="btn" data-edit-term={term.id} onClick={() => openEdit(term)}>
                  Edit {term.name}
                </button>
              )}
            </li>
          ))}
        </ul>
      </main>
      {dialog && (
        <Dialog
          title={dialog === 'new' ? 'New term' : 'Edit term'}
          onClose={closeDialog}
          onOpen={(node) => (node?.querySelector('input') as HTMLElement | null)?.focus()}
        >
          <label className="field">
            <span className="field-label">Term name</span>
            <input
              ref={nameRef}
              type="text"
              className="input"
              aria-label="Term name"
              value={name}
              aria-invalid={dialogErrors.name !== undefined}
              aria-describedby={dialogErrors.name !== undefined ? 'term-name-error' : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            {dialogErrors.name !== undefined && (
              <span id="term-name-error" className="field-error">
                {dialogErrors.name}
              </span>
            )}
          </label>
          <label className="field">
            <span className="field-label">Definition</span>
            <textarea
              className="input"
              aria-label="Definition"
              value={definition}
              aria-invalid={dialogErrors.definition !== undefined}
              aria-describedby={dialogErrors.definition !== undefined ? 'term-definition-error' : undefined}
              onChange={(e) => setDefinition(e.target.value)}
            />
            {dialogErrors.definition !== undefined && (
              <span id="term-definition-error" className="field-error">
                {dialogErrors.definition}
              </span>
            )}
          </label>
          <p role="status" aria-label="Dialog status" aria-live="polite" className="status dialog-status">
            {dialogStatus}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn primary" onClick={() => void save()}>
              Save term
            </button>
            <button type="button" className="btn" onClick={closeDialog}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
