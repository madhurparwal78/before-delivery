import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, ApiError, openLive, refuse } from '../api.ts';
import { actionStatus } from '../store.ts';
import { Button, Crosshairs, Loading, NotFound, ReviewUpdates, Screen, StatusWord, TwoPane } from '../ui.tsx';
import type { ChangeView, DiffFile, RestackResult, ReviewView, ThreadView } from '../../shared/types.ts';
import { Ctx, FileSection, Thread } from './change/Diff.tsx';
import { CommentDialog, DismissDialog, FilesDialog, ReviewDialog } from './change/Dialogs.tsx';
import { navigationRows, rowAnchorsThread, type RowRef, type ViewMode } from './change/model.ts';
import { ChecksPanel, MergeBox, Notices, prefersReducedMotion, Reviewers, Reviews, StackRail } from './change/Rail.tsx';
import './change.css';

type Props = { org: string; repo: string; number: number };

type DialogState =
  | { kind: 'comment'; row: RowRef; opener: HTMLElement | null }
  | { kind: 'review'; opener: HTMLElement | null }
  | { kind: 'dismiss'; review: ReviewView; opener: HTMLElement | null }
  | { kind: 'files'; opener: HTMLElement | null };

const VIEW_KEY = 'ridgestack.diff-view';
const isTextEntry = (el: HTMLElement | null): boolean =>
  !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes((el as HTMLInputElement).type)));

export function ChangePage(props: Props) {
  return <ChangeScreen key={`${props.org}/${props.repo}/${props.number}`} {...props} />;
}

function ChangeScreen({ org, repo, number }: Props) {
  const root = `/api/repos/${org}/${repo}/changes/${number}`;
  const [view, setView] = useState<ChangeView | null>(null);
  const [diff, setDiff] = useState<DiffFile[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [lines, setLines] = useState<{ id: number; text: string }[]>([]);
  const [restacks, setRestacks] = useState<RestackResult[][]>([]);
  const [mode, setMode] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) === 'split' ? 'split' : 'unified'));
  const breakpoint = Number(document.documentElement.dataset.diffBreakpoint);
  const [narrow, setNarrow] = useState(() => window.matchMedia(`(width <= ${breakpoint - 1}px)`).matches);
  const [outdated, setOutdated] = useState(false);
  const [cursor, setCursor] = useState<RowRef | null>(null);
  const [pointer, setPointer] = useState(false);
  const [batch, setBatch] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [newThreads, setNewThreads] = useState<Set<number>>(new Set());
  const effective: ViewMode = narrow ? 'unified' : mode;
  const nav = useMemo(() => navigationRows(diff ?? [], effective), [diff, effective]);

  const seq = useRef(0);
  const lineId = useRef(0);
  const seen = useRef<Set<number> | null>(null);
  const diffKey = useRef('');
  const pending = useRef<{ row: true } | { thread: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const live = useRef({ view, diff, nav, cursor, outdated, dialog, effective });
  live.current = { view, diff, nav, cursor, outdated, dialog, effective };

  const loadDiff = async (key: string) => {
    try {
      const data = await api<{ files: DiffFile[] }>('GET', `${root}/diff`);
      if (diffKey.current === key) setDiff(data.files);
    } catch (failure) {
      if (diffKey.current === key) setDiff([]);
      if (!refuse(failure)) throw failure;
    }
  };

  const load = async (): Promise<ChangeView | null> => {
    const mine = ++seq.current;
    try {
      const next = await api<ChangeView>('GET', `${root}/view`);
      if (mine !== seq.current) return next;
      if (seen.current) {
        const fresh = next.threads.filter((thread) => !seen.current!.has(thread.id)).map((thread) => thread.id);
        if (fresh.length) setNewThreads((current) => new Set([...current, ...fresh]));
      }
      seen.current = new Set(next.threads.map((thread) => thread.id));
      setView(next);
      const key = `${next.change.base_revision}:${next.change.head_revision}`;
      if (diffKey.current !== key) {
        diffKey.current = key;
        void loadDiff(key);
      }
      return next;
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 404) setMissing(true);
      else if (!(failure instanceof ApiError && failure.status === 401)) throw failure;
      return null;
    }
  };

  // The live stream: the first load waits for the stream to open so no event can fall between them.
  useLayoutEffect(() => {
    let started = false;
    const source = openLive(org, repo);
    const go = () => {
      started = true;
      void load();
    };
    source.onopen = go;
    source.onclose = () => {
      if (!started) go();
    };
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as { numbers: number[]; announce: { text: string; on: string }[]; restack?: RestackResult[] };
      if (!event.numbers.includes(number)) return;
      const spoken = event.announce.filter((item) => item.on !== 'queue').map((item) => ({ id: ++lineId.current, text: item.text }));
      if (spoken.length) setLines((current) => [...current, ...spoken]);
      if (event.restack) setRestacks((current) => [...current, event.restack!]);
      void load();
    };
    const query = window.matchMedia(`(width <= ${breakpoint - 1}px)`);
    const onWidth = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener('change', onWidth);
    return () => {
      source.close();
      query.removeEventListener('change', onWidth);
    };
  }, []);

  const base = view ? `/api/repos/${org}/${repo}/changes/${number}` : root;
  const cursorElement = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="row"][data-cursor="true"]');

  const moveTo = (row: RowRef) => {
    setCursor(row);
    setPointer(false);
    pending.current = { row: true };
  };

  useLayoutEffect(() => {
    const want = pending.current;
    if (!want) return;
    pending.current = null;
    if ('row' in want) cursorElement()?.focus();
    else document.querySelector<HTMLElement>(`article[data-thread-id="${want.thread}"]`)?.focus();
  });

  const toggleViewed = async (path: string, viewed: boolean) => {
    const counts = await api<ChangeView['change']['counts']>('PUT', `${base}/viewed`, { path, viewed });
    setView((current) => current && { ...current, viewed: viewed ? [...new Set([...current.viewed, path])] : current.viewed.filter((entry) => entry !== path), change: { ...current.change, counts } });
  };

  const apply = async (ids: number[]) => {
    actionStatus.set('Working...');
    try {
      const done = await api<{ revision: string }>('POST', `${base}/suggestions/apply`, { comments: ids });
      actionStatus.set(`Suggestions applied in revision ${done.revision}.`);
      setBatch(new Set());
      await load();
    } catch (failure) {
      actionStatus.set('');
      if (!refuse(failure)) throw failure;
    }
  };

  const reply = async (threadId: number, body: string): Promise<string | null> => {
    actionStatus.set('Submitting...');
    try {
      await api('POST', `${base}/threads/${threadId}/replies`, { body });
      actionStatus.set('Reply sent.');
      await load();
      return null;
    } catch (failure) {
      actionStatus.set('');
      if (failure instanceof ApiError && failure.fields.body) return failure.fields.body;
      if (!refuse(failure)) throw failure;
      return null;
    }
  };

  const resolve = async (thread: ThreadView) => {
    await api('PUT', `${base}/threads/${thread.id}/state`, { state: thread.state === 'resolved' ? 'unresolved' : 'resolved' });
    await load();
  };

  // ---- keyboard: the published keys, on the page body or inside the diff stage ----
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = live.current;
      if (document.querySelector('dialog[open]') || !state.view || !state.diff) return;
      const target = event.target as HTMLElement | null;
      if (isTextEntry(target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!(target === document.body || stage.current?.contains(target))) return;
      const rows = state.nav;
      const files = [...new Set(rows.map((row) => row.path))];
      const index = state.cursor ? rows.findIndex((row) => row.key === state.cursor!.key) : -1;
      const handled = () => event.preventDefault();
      if ('jknpcvr'.includes(event.key) || event.key.startsWith('Arrow')) handled();
      switch (event.key) {
        case 'j':
        case 'k': {
          const forward = event.key === 'j';
          if (!state.cursor) {
            if (forward && rows[0]) moveTo(rows[0]);
            break;
          }
          const at = files.indexOf(state.cursor.path);
          const path = files[at + (forward ? 1 : -1)];
          const row = rows.find((candidate) => candidate.path === path);
          if (row) moveTo(row);
          break;
        }
        case 'ArrowDown':
        case 'ArrowUp': {
          const next = index < 0 ? rows[0] : rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
          if (next) moveTo(next);
          break;
        }
        case 'n':
        case 'p': {
          const places = state.view.threads
            .filter((thread) => thread.state === 'unresolved' && (!thread.outdated || state.outdated))
            .map((thread) => ({ thread, at: rows.findIndex((row) => rowAnchorsThread(row, thread)) }))
            .sort((a, b) => a.at - b.at || a.thread.id - b.thread.id);
          const found = event.key === 'n' ? places.find((place) => place.at > index) : [...places].reverse().find((place) => place.at < index);
          if (found) {
            if (found.at >= 0) setCursor(rows[found.at]);
            setPointer(false);
            pending.current = { thread: found.thread.id };
            setNewThreads((current) => new Set(current));
          }
          break;
        }
        case 'c':
          if (state.cursor) setDialog({ kind: 'comment', row: state.cursor, opener: null });
          break;
        case 'v':
          if (state.cursor) {
            pending.current = { row: true };
            void toggleViewed(state.cursor.path, !state.view.viewed.includes(state.cursor.path));
          }
          break;
        case 'r':
          setDialog({ kind: 'review', opener: null });
          break;
        default:
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  if (missing) return <NotFound />;
  if (!view) return <Screen className="change-screen"><Loading /></Screen>;

  const closeDialog = () => setDialog(null);
  const returnTo = (state: DialogState) => () => state.opener ?? cursorElement() ?? (document.body as HTMLElement);
  const visible = view.threads.filter((thread) => !thread.outdated);
  const outdatedThreads = view.threads.filter((thread) => thread.outdated);
  const counts = view.change.counts;
  const files = diff ?? [];

  const stageBody = (
    <div ref={stage} className="frame change-stage">
      <Crosshairs />
      <header
        className="change-header"
        data-files-viewed={counts.files_viewed}
        data-files-total={counts.files_total}
        data-unresolved-threads={counts.unresolved_threads}
        data-approvals-remaining={counts.approvals_remaining}
      >
        <h1>#{view.change.number} {view.change.title}</h1>
        <StatusWord state={view.change.state} />
        <p className="change-line">{view.change.author} wants to merge <code>{view.change.head}</code> into <code>{view.change.base}</code></p>
        <p className="num">Unresolved threads: {counts.unresolved_threads}</p>
        <p className="num">Approvals remaining: {counts.approvals_remaining}</p>
      </header>
      <div className="cp-toolbar">
        <span className="num">{counts.files_viewed} of {counts.files_total} files viewed</span>
        {!narrow ? (
          <div role="radiogroup" aria-label="Diff view" className="seg">
            {(['split', 'unified'] as const).map((value) => (
              <label key={value} className={`seg-option ${mode === value ? 'on' : ''}`}>
                <input type="radio" name="diff-view" checked={mode === value} onChange={() => { setMode(value); localStorage.setItem(VIEW_KEY, value); }} />
                <span>{value === 'split' ? 'Split' : 'Unified'}</span>
              </label>
            ))}
          </div>
        ) : (
          <Button onClick={(event) => setDialog({ kind: 'files', opener: event.currentTarget })}>Files</Button>
        )}
        <label className="switch">
          <input type="checkbox" role="switch" checked={outdated} onChange={(event) => setOutdated(event.currentTarget.checked)} />
          <span>Show outdated threads</span>
        </label>
        {batch.size ? <Button kind="secondary" onClick={() => void apply([...batch])}>Apply batch</Button> : null}
      </div>
      {!narrow ? (
        <nav aria-label="File tree" className="file-tree">
          <ul>
            {view.change.files.map((file) => (
              <li key={file.path} data-path={file.path} data-status={file.status}>
                <a href={`#file-${encodeURIComponent(file.path)}`} onClick={(event) => { event.preventDefault(); scrollToFile(file.path); }}>{file.path}</a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {outdated ? (
        <section aria-label="Outdated threads" className="outdated">
          {outdatedThreads.map((thread) => <Thread key={thread.id} thread={thread} />)}
        </section>
      ) : null}
      {diff === null ? <Loading /> : files.map((file, i) => <FileSection key={file.path} file={file} index={i} threads={visible.filter((thread) => thread.path === file.path)} />)}
    </div>
  );

  const rail = (
    <>
      <StackRail org={org} repo={repo} rows={view.stack} events={restacks} />
      <MergeBox view={view} refresh={() => void load()} />
      <section className="card review-cta"><Button onClick={(event) => setDialog({ kind: 'review', opener: event.currentTarget })}>Review changes</Button></section>
      <ChecksPanel view={view} />
      <Reviewers view={view} refresh={load} />
      <Reviews view={view} onDismiss={(review, opener) => setDialog({ kind: 'dismiss', review, opener })} />
      <Notices view={view} />
    </>
  );

  const context = {
    view,
    mode: effective,
    cursorKey: cursor?.key ?? null,
    pointerCursor: pointer,
    newThreads,
    batch,
    reduced: prefersReducedMotion(),
    onRowClick: (row: RowRef) => {
      setCursor(row);
      setPointer(true);
    },
    onComment: (row: RowRef, opener: HTMLElement) => setDialog({ kind: 'comment', row, opener }),
    onViewed: (path: string, viewed: boolean) => void toggleViewed(path, viewed),
    onBatch: (id: number) => setBatch((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; }),
    onApply: (ids: number[]) => void apply(ids),
    onReply: reply,
    onResolve: (thread: ThreadView) => void resolve(thread),
  };

  return (
    <Screen className="change-screen">
      <Ctx.Provider value={context}>
        <TwoPane stage={stageBody} rail={rail} />
        <ReviewUpdates lines={lines} />
        {dialog?.kind === 'comment' ? <CommentDialog view={view} row={dialog.row} onClose={closeDialog} returnFocus={returnTo(dialog)} /> : null}
        {dialog?.kind === 'review' ? <ReviewDialog view={view} onClose={closeDialog} returnFocus={returnTo(dialog)} /> : null}
        {dialog?.kind === 'dismiss' ? <DismissDialog view={view} review={dialog.review} onClose={closeDialog} returnFocus={returnTo(dialog)} /> : null}
        {dialog?.kind === 'files' ? <FilesDialog files={view.change.files} onClose={closeDialog} returnFocus={returnTo(dialog)} onPick={(path) => { closeDialog(); scrollToFile(path); }} /> : null}
      </Ctx.Provider>
    </Screen>
  );
}

function scrollToFile(path: string): void {
  document.getElementById(`file-${encodeURIComponent(path)}`)?.scrollIntoView({ block: 'start' });
}

