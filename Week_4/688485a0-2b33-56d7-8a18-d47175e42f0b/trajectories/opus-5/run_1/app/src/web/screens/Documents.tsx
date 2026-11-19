import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiFailure, QueryAnswer, SessionUser, apiSend, collectionPath } from '../api';
import {
  EMPTY_COLLECTION,
  EDITOR_PLACEHOLDER,
  READ_ONLY_NOTE,
  fieldJsonError,
  planLines,
  queryErrorText,
  queryStatusResult,
} from '../copy';
import { Dialog } from '../components/Dialog';
import { DocumentEditorBody } from '../components/DocumentEditor';
import { DownloadDialog, LoadFileDialog, SaveQueryDialog } from '../components/DocumentDialogs';
import { PaneSeparator } from '../components/PaneSeparator';
import { PipelinePanel } from '../components/PipelinePanel';
import { Pager, ResultView, ResultsView, ViewSwitch } from '../components/ResultsView';
import { ProjectShell, Skeleton, useStorageHealth } from '../components/Shell';
import { NotFoundScreen } from '../components/Shell';
import { DocObject, fromJson } from '../../shared/values';
import { useCollection, useCollectionEvents, useViewport } from '../hooks';
import { navigate } from '../router';

interface Submitted {
  filter: unknown;
  projection: unknown;
  sort: unknown;
  limit: number;
}

const EMPTY: Submitted = { filter: {}, projection: null, sort: null, limit: 0 };

function parseField(text: string, field: 'Filter' | 'Projection' | 'Sort'): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return field === 'Filter' ? {} : null;
  return JSON.parse(trimmed) as unknown;
}

export function DocumentsScreen({
  user,
  pid,
  cid,
  did,
  section = 'documents',
  initialTab = 'Query',
}: {
  user: SessionUser | null;
  pid: string;
  cid: string;
  did: string | null;
  section?: 'documents' | 'pipeline';
  initialTab?: 'Query' | 'Results' | 'Pipeline';
}): JSX.Element {
  const collection = useCollection(pid, cid);
  const viewport = useViewport();
  const storage = useStorageHealth(true);
  const [filterText, setFilterText] = useState('');
  const [projectionText, setProjectionText] = useState('');
  const [sortText, setSortText] = useState('');
  const [limit, setLimit] = useState(0);
  const [submitted, setSubmitted] = useState<Submitted>(EMPTY);
  const [answer, setAnswer] = useState<QueryAnswer | null>(null);
  const [status, setStatus] = useState('Running query');
  const [plan, setPlan] = useState<QueryAnswer['plan'] | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<ResultView>('List');
  const [page, setPage] = useState(1);
  const [inserting, setInserting] = useState(false);
  const [dialog, setDialog] = useState<'load' | 'download' | 'save' | null>(null);
  const [tab, setTab] = useState<'Query' | 'Results' | 'Pipeline'>(initialTab);
  const [queryShare, setQueryShare] = useState(30);
  const pendingFocus = useRef<string | 'first' | null>(null);
  const opener = useRef<string | null>(null);

  const run = useCallback(
    async (spec: Submitted, nextPage: number, announce = true): Promise<void> => {
      if (announce) setStatus('Running query');
      try {
        const result = await apiSend<QueryAnswer>('POST', `${collectionPath(pid, cid)}/query`, {
          filter: spec.filter,
          projection: spec.projection,
          sort: spec.sort,
          limit: spec.limit,
          page: nextPage,
        });
        setAnswer(result);
        setPlan(result.plan);
        setError('');
        setStatus(queryStatusResult(result.matched, result.documents.length));
      } catch (failure) {
        if (failure instanceof ApiFailure) {
          setAnswer({ matched: 0, page: nextPage, page_size: 1, documents: [], ids: [], plan: result0() });
          setPlan(null);
          setError(queryErrorText(failure));
          setStatus('Query not run');
        }
      }
    },
    [pid, cid],
  );

  useEffect(() => {
    setSubmitted(EMPTY);
    setPage(1);
    void run(EMPTY, 1);
  }, [run]);

  useCollectionEvents(
    pid,
    cid,
    () => {
      void run(submitted, page, false);
      collection.reload();
    },
    (role) => collection.setRole(role),
  );

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || !answer) return;
    pendingFocus.current = null;
    const selector =
      target === 'first' ? '[data-doc-id]' : `[data-doc-id="${target}"]`;
    const element = document.querySelector<HTMLElement>(selector);
    element?.focus();
  }, [answer, did, inserting]);

  const submit = (nextPage: number): void => {
    let spec: Submitted;
    try {
      spec = {
        filter: parseField(filterText, 'Filter'),
        projection: parseField(projectionText, 'Projection'),
        sort: parseField(sortText, 'Sort'),
        limit,
      };
    } catch {
      const field = (() => {
        try {
          parseField(filterText, 'Filter');
        } catch {
          return 'Filter' as const;
        }
        try {
          parseField(projectionText, 'Projection');
        } catch {
          return 'Projection' as const;
        }
        return 'Sort' as const;
      })();
      setError(fieldJsonError(field));
      setStatus('Query not run');
      setAnswer({ matched: 0, page: 1, page_size: 1, documents: [], ids: [], plan: result0() });
      setPlan(null);
      return;
    }
    setSubmitted(spec);
    setPage(nextPage);
    if (viewport === 'phone') {
      setTab('Results');
      window.setTimeout(() => document.querySelector<HTMLElement>('[data-tab="Results"]')?.focus(), 0);
    }
    void run(spec, nextPage);
  };

  if (collection.loading) {
    return (
      <ProjectShell user={user} pid={pid} cid={cid} section={section} projectName="">
        <div aria-busy="true">
          <Skeleton lines={4} />
        </div>
      </ProjectShell>
    );
  }
  if (collection.missing) return <NotFoundScreen user={user} />;

  const docs = (answer?.documents ?? []).map((item) => fromJson(item) as DocObject);
  const ids = answer?.ids ?? [];
  const pages = Math.max(1, Math.ceil((answer?.matched ?? 0) / Math.max(answer?.page_size ?? 1, 1)));
  const writer = collection.role !== 'reader';
  const editorOpen = did !== null || inserting;

  const openDocument = (docId: string): void => {
    opener.current = docId;
    navigate(`/p/${pid}/c/${cid}/d/${docId}`);
  };

  const closeEditor = (): void => {
    setInserting(false);
    pendingFocus.current = opener.current;
    navigate(`/p/${pid}/c/${cid}`);
  };

  const queryPane = (
    <div role="search" aria-label="Query bar" className="query-bar" onKeyDown={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        submit(1);
      }
    }}>
      <div className="field">
        <label htmlFor="query-filter">Filter</label>
        <textarea
          id="query-filter"
          className="code"
          spellCheck={false}
          value={filterText}
          onChange={(event) => setFilterText(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="query-projection">Projection</label>
        <textarea
          id="query-projection"
          className="code"
          spellCheck={false}
          value={projectionText}
          onChange={(event) => setProjectionText(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="query-sort">Sort</label>
        <textarea
          id="query-sort"
          className="code"
          spellCheck={false}
          value={sortText}
          onChange={(event) => setSortText(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="query-limit">Limit</label>
        <input
          id="query-limit"
          type="number"
          min={0}
          step={1}
          value={limit}
          onChange={(event) => setLimit(Number(event.target.value))}
        />
      </div>
      <div>
        <button type="button" className="primary" onClick={() => submit(1)}>
          Run
        </button>
      </div>
    </div>
  );

  const resultsPane = (
    <div className="pane stack" aria-busy={status === 'Running query' ? 'true' : undefined}>
      <ViewSwitch view={view} onChange={setView} />
      <div className="statuses">
        <div role="status" aria-label="Query status">
          {status}
        </div>
        <div
          role="status"
          aria-label="Query plan"
          className="code-pane"
          data-plan-kind={plan ? plan.kind : undefined}
          data-plan-index={plan ? (plan.index ?? '') : undefined}
        >
          {plan
            ? planLines(plan.kind, plan.index, plan.docs_examined, plan.returned).map((line) => (
                <div key={line}>{line}</div>
              ))
            : ''}
        </div>
        {error ? (
          <div role="alert" aria-label="Query error" className="alert">
            {error}
          </div>
        ) : null}
      </div>
      {collection.count === 0 && !error ? (
        <div className="stack">
          <h2>{EMPTY_COLLECTION}</h2>
          {writer ? (
            <div className="toolbar">
              <button type="button" onClick={() => setDialog('load')}>
                Load file
              </button>
              <button type="button" onClick={() => setInserting(true)}>
                Insert document
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <ResultsView view={view} docs={docs} ids={ids} onOpen={openDocument} />
          <Pager page={answer?.page ?? 1} pages={pages} onPage={(next) => submitPage(next)} />
        </>
      )}
    </div>
  );

  function submitPage(next: number): void {
    setPage(next);
    void run(submitted, next);
  }

  const toolbar = (
    <div className="toolbar">
      {writer ? (
        <button type="button" onClick={() => setInserting(true)}>
          Insert document
        </button>
      ) : null}
      {writer ? (
        <button type="button" onClick={() => setDialog('load')}>
          Load file
        </button>
      ) : null}
      <button type="button" onClick={() => setDialog('download')}>
        Download
      </button>
      {writer ? (
        <button type="button" onClick={() => setDialog('save')}>
          Save query
        </button>
      ) : null}
    </div>
  );

  const editorBody = (
    <DocumentEditorBody
      pid={pid}
      cid={cid}
      docId={inserting ? null : did}
      role={collection.role}
      validator={collection.validator}
      onClose={closeEditor}
      onSaved={() => {
        void run(submitted, page, false);
        collection.reload();
      }}
      onInserted={(docId) => {
        setInserting(false);
        opener.current = docId;
        navigate(`/p/${pid}/c/${cid}/d/${docId}`);
        void run(submitted, page, false);
        collection.reload();
      }}
      onDeleted={() => {
        setInserting(false);
        pendingFocus.current = 'first';
        navigate(`/p/${pid}/c/${cid}`);
        void run(submitted, page, false);
        collection.reload();
      }}
    />
  );

  const editorColumn =
    viewport === 'phone' ? null : (
      <section className="editor documents-editor" aria-label="Document editor">
        {editorOpen ? editorBody : <p className="secondary">{EDITOR_PLACEHOLDER}</p>}
      </section>
    );

  const pipelinePanel = (
    <PipelinePanel pid={pid} cid={cid} collectionCount={collection.count} />
  );

  return (
    <ProjectShell
      user={user}
      pid={pid}
      cid={cid}
      section={section}
      projectName={collection.projectName}
      storageDown={storage.storageDown}
    >
      {collection.role === 'reader' ? <p>{READ_ONLY_NOTE}</p> : null}
      {viewport === 'phone' ? (
        <PhoneTabs
          tab={tab}
          onTab={setTab}
          query={queryPane}
          results={
            <>
              {resultsPane}
              {toolbar}
            </>
          }
          pipeline={pipelinePanel}
        />
      ) : (
        <div className="documents-grid">
          <div className="documents-main" style={{ ['--query-share' as string]: `${queryShare}%` }}>
            {queryPane}
            <PaneSeparator
              label="Resize query pane"
              value={queryShare}
              orientation="vertical"
              onChange={setQueryShare}
            />
            {resultsPane}
            {toolbar}
          </div>
          {editorColumn}
        </div>
      )}
      {viewport === 'phone' && editorOpen ? (
        <Dialog label="Document" onClose={closeEditor} full>
          {editorBody}
        </Dialog>
      ) : null}
      {dialog === 'load' ? (
        <LoadFileDialog
          pid={pid}
          cid={cid}
          onClose={() => setDialog(null)}
          onLoaded={() => {
            void run(submitted, page, false);
            collection.reload();
          }}
          onStorageDown={storage.markDown}
        />
      ) : null}
      {dialog === 'download' ? (
        <DownloadDialog
          pid={pid}
          cid={cid}
          filter={submitted.filter}
          sort={submitted.sort}
          onClose={() => setDialog(null)}
          onStorageDown={storage.markDown}
        />
      ) : null}
      {dialog === 'save' ? (
        <SaveQueryDialog
          pid={pid}
          cid={cid}
          filter={submitted.filter}
          projection={submitted.projection}
          sort={submitted.sort}
          limit={submitted.limit}
          onClose={() => setDialog(null)}
          onSaved={() => setDialog(null)}
        />
      ) : null}
    </ProjectShell>
  );
}

function result0(): QueryAnswer['plan'] {
  return { kind: 'full_scan', index: null, docs_examined: 0, returned: 0 };
}

export function PhoneTabs({
  tab,
  onTab,
  query,
  results,
  pipeline,
}: {
  tab: 'Query' | 'Results' | 'Pipeline';
  onTab: (tab: 'Query' | 'Results' | 'Pipeline') => void;
  query: JSX.Element;
  results: JSX.Element;
  pipeline: JSX.Element;
}): JSX.Element {
  const names: Array<'Query' | 'Results' | 'Pipeline'> = ['Query', 'Results', 'Pipeline'];
  return (
    <div>
      <div role="tablist">
        {names.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            data-tab={name}
            id={`tab-${name}`}
            aria-selected={tab === name}
            aria-controls={`panel-${name}`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => onTab(name)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                const next = names[(names.indexOf(tab) + 1) % names.length];
                onTab(next);
                window.setTimeout(() => document.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus(), 0);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                const next = names[(names.indexOf(tab) + names.length - 1) % names.length];
                onTab(next);
                window.setTimeout(() => document.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus(), 0);
              }
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'Query' ? query : tab === 'Results' ? results : pipeline}
      </div>
    </div>
  );
}
