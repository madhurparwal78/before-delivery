// Queries: the saved-query list, dialog New query, and the selected query's live results table.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { api, fieldErrors, get, NetworkError } from '../api.ts';
import { Dialog } from '../Dialog.tsx';
import { refreshLibrary, useLibrary } from '../library.ts';
import { QUIRE_CURVE_CSS, flip, measure, reducedMotion } from '../motion.ts';
import { linkHandler, navigate } from '../router.ts';
import { useSession } from '../session.ts';
import { useSync } from '../sync.ts';
import type { FieldJson, QueryJson, QueryResultsJson, QueryRowJson, TypeJson } from '../types.ts';
import { ROW_FADE_MS, ROW_SLIDE_MS, SEARCH_DELAY_MS } from '../../shared/motion.ts';
import { homeDate } from '../../shared/time.ts';
import { NotFound } from './NotFound.tsx';
import '../styles/cards.css';

const LIVE_EVENTS = new Set(['backlinks.changed', 'object.saved', 'object.removed', 'sync.reset']);
const BUILTIN_KEYS: Array<[string, string]> = [['@title', 'Title'], ['@backlinks', 'Backlinks'], ['@updated', 'Last updated']];
const GROUPABLE = new Set(['select', 'relation', 'date', 'text']);

const keyLabel = (key: string): string => BUILTIN_KEYS.find(([k]) => k === key)?.[1] ?? key;
const dirLabel = (dir: 'asc' | 'desc'): string => (dir === 'asc' ? 'Ascending' : 'Descending');

/** A shown row; a leaving row fades out and then leaves. */
interface Item { row: QueryRowJson; leaving: boolean }
interface Group { key: string; label: string | null; count: number; items: Item[] }

const groupKey = (key: string | null): string => (key === null ? '\u0000none' : `k:${key}`);

/** The results as shown groups (one unlabelled group when ungrouped). */
function toGroups(r: QueryResultsJson): Group[] {
  if (r.groups === null) return [{ key: '', label: null, count: r.results.length, items: r.results.map((row) => ({ row, leaving: false })) }];
  return r.groups.map((g) => ({ key: groupKey(g.key), label: g.label, count: g.count, items: g.results.map((row) => ({ row, leaving: false })) }));
}

/** New groups, keeping rows that just left in place (after the row that preceded them) while they fade out. */
function mergeLeaving(old: Group[], next: Group[]): Group[] {
  const present = new Set(next.flatMap((g) => g.items.map((i) => i.row.id)));
  return next.map((g) => {
    const before = old.find((o) => o.key === g.key);
    if (!before) return g;
    const items = [...g.items];
    let prev: string | null = null;
    for (const item of before.items) {
      if (!present.has(item.row.id)) {
        const at = prev === null ? 0 : items.findIndex((i) => i.row.id === prev) + 1;
        items.splice(at, 0, { row: item.row, leaving: true });
      }
      prev = item.row.id;
    }
    return { ...g, items };
  });
}

export function QueriesPage({ queryId }: { queryId: string | null }) {
  const [queries, setQueries] = useState<QueryJson[]>([]);
  const [creating, setCreating] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const r = await get<{ queries: QueryJson[] }>('/api/queries');
      if (r.status === 200) setQueries(r.data.queries);
    } catch {
      // offline: keep the list
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useSync((event) => {
    if (event === 'sync.reset') void loadList();
  });

  return (
    <>
      <h1>Queries</h1>
      <div className="query-tools">
        <button type="button" className="primary" onClick={() => setCreating(true)}>New query</button>
      </div>
      <ul className="saved-queries" aria-label="Saved queries">
        {queries.map((q) => (
          <li key={q.id}>
            <a href={`/queries/${q.id}`} aria-current={q.id === queryId ? 'page' : undefined} onClick={linkHandler(`/queries/${q.id}`)}>{q.name}</a>
          </li>
        ))}
      </ul>
      {queryId !== null && <SelectedQuery key={queryId} queryId={queryId} onDeleted={() => void loadList()} />}
      {creating && (
        <NewQueryDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void loadList();
          }}
        />
      )}
    </>
  );
}

/** The selected query: its text, grouping and sort, Delete query, and table `Query results`. */
function SelectedQuery({ queryId, onDeleted }: { queryId: string; onDeleted: () => void }) {
  const { types } = useLibrary();
  const { zone } = useSession();
  const [query, setQuery] = useState<QueryJson | null>(null);
  const [missing, setMissing] = useState(false);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const groupsRef = useRef<Group[] | null>(null);
  groupsRef.current = groups;
  const rowEls = useRef(new Map<string, HTMLTableRowElement>());
  const before = useRef<Map<string, DOMRect> | null>(null);
  const focusedRow = useRef<string | null>(null);
  const seq = useRef(0);

  const loadResults = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const r = await get<QueryResultsJson>(`/api/queries/${encodeURIComponent(queryId)}/results`);
      if (mine !== seq.current || r.status !== 200) return;
      const next = toGroups(r.data);
      const old = groupsRef.current;
      if (old) {
        // Read the rows' rectangles (and the focused row) before the DOM changes, for the slide.
        before.current = measure(rowEls.current);
        const active = document.activeElement;
        focusedRow.current = null;
        for (const [id, el] of rowEls.current) if (active instanceof HTMLElement && el.contains(active)) focusedRow.current = id;
      }
      setGroups(old && !reducedMotion() ? mergeLeaving(old, next) : next);
    } catch {
      // offline: keep the table; sync.reset refetches
    }
  }, [queryId]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await get<QueryJson>(`/api/queries/${encodeURIComponent(queryId)}`);
        if (!live) return;
        if (r.status === 200) setQuery(r.data);
        else if (r.status === 404 || r.status === 422) setMissing(true);
      } catch {
        // offline
      }
    })();
    void loadResults();
    return () => {
      live = false;
    };
  }, [queryId, loadResults]);

  useSync((event) => {
    if (LIVE_EVENTS.has(event)) void loadResults();
  });

  // After a refetch: keep focus on the row link, slide moved rows, fade new rows in and leaving rows out.
  useLayoutEffect(() => {
    const rects = before.current;
    before.current = null;
    if (!rects) return;
    const keep = focusedRow.current;
    focusedRow.current = null;
    if (keep) {
      const el = rowEls.current.get(keep);
      const link = el?.querySelector<HTMLElement>('a');
      if (link && document.activeElement !== link) link.focus({ preventScroll: true });
    }
    flip(rowEls.current, rects, ROW_SLIDE_MS, ROW_FADE_MS);
    for (const [id, el] of rowEls.current) {
      const leaving = el.dataset.leaving === 'true';
      const fading = el.getAnimations().find((a) => a.id === 'leave');
      if (!leaving) {
        fading?.cancel();
        continue;
      }
      if (fading) continue;
      const anim = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ROW_FADE_MS, easing: QUIRE_CURVE_CSS, fill: 'forwards' });
      anim.id = 'leave';
      void anim.finished.then(() => {
        setGroups((gs) => gs && gs.map((g) => ({ ...g, items: g.items.filter((i) => !(i.leaving && i.row.id === id)) })));
      }, () => undefined);
    }
  }, [groups]);

  const remove = async (): Promise<void> => {
    try {
      const r = await api<null>('DELETE', `/api/queries/${encodeURIComponent(queryId)}`);
      if (r.status === 204 || r.status === 404) {
        onDeleted();
        navigate('/queries', { replace: true });
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
    }
  };

  if (missing) return <NotFound />;
  if (!query) return <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>;
  const typeName = types.find((t) => t.id === query.type_id)?.name ?? '';
  const sort = query.sort.map((s) => `${keyLabel(s.key)}, ${dirLabel(s.dir).toLowerCase()}`).join('; ');

  const rowRef = (id: string) => (el: HTMLTableRowElement | null) => {
    if (!el) return;
    rowEls.current.set(id, el);
    return () => {
      if (rowEls.current.get(id) === el) rowEls.current.delete(id);
    };
  };

  const renderRow = ({ row, leaving }: Item) => (
    <tr key={row.id} ref={rowRef(row.id)} data-leaving={leaving ? 'true' : undefined} aria-hidden={leaving || undefined}>
      <td><a href={`/o/${row.id}`} onClick={linkHandler(`/o/${row.id}`)} tabIndex={leaving ? -1 : undefined}>{row.title}</a></td>
      <td>{row.type_name}</td>
      <td className="num">{row.backlinks}</td>
      <td><time className="num" dateTime={row.updated_at}>{homeDate(Date.parse(row.updated_at), zone)}</time></td>
    </tr>
  );

  return (
    <section className="query-detail" aria-labelledby="query-name">
      <h2 id="query-name">{query.name}</h2>
      <dl className="query-facts">
        <dt>Type</dt><dd>{typeName}</dd>
        <dt>Query</dt><dd>{query.text.trim() ? <code>{query.text}</code> : 'Every note of this type'}</dd>
        <dt>Grouping</dt><dd>{query.group_by ?? 'No grouping'}</dd>
        <dt>Sort</dt><dd>{sort}</dd>
      </dl>
      <div className="query-actions">
        <button type="button" onClick={() => void remove()}>Delete query</button>
      </div>
      <table className="results" aria-label="Query results">
        <colgroup><col className="c-title" /><col className="c-type" /><col className="c-backlinks" /><col /></colgroup>
        <thead>
          <tr><th scope="col">Title</th><th scope="col">Type</th><th scope="col">Backlinks</th><th scope="col">Last updated</th></tr>
        </thead>
        {(groups ?? []).map((g) => (
          <tbody key={g.key}>
            {g.label !== null && (
              <tr><th scope="rowgroup" colSpan={4} className="group-head">{`${g.label} (${g.count})`}</th></tr>
            )}
            {g.items.map(renderRow)}
          </tbody>
        ))}
      </table>
    </section>
  );
}

interface SortRow { key: string; dir: 'asc' | 'desc' }
const FIELD_ORDER = ['name', 'type_id', 'text', 'group_by', 'sort', 'sort.0.key', 'sort.0.dir', 'sort.1.key', 'sort.1.dir', 'sort.2.key', 'sort.2.dir'];
const FIELD_IDS: Record<string, string> = {
  name: 'nq-name', type_id: 'nq-type', text: 'nq-text', group_by: 'nq-group', sort: 'nq-sort-key-0',
  'sort.0.key': 'nq-sort-key-0', 'sort.0.dir': 'nq-sort-dir-0', 'sort.1.key': 'nq-sort-key-1', 'sort.1.dir': 'nq-sort-dir-1',
  'sort.2.key': 'nq-sort-key-2', 'sort.2.dir': 'nq-sort-dir-2',
};

/** Dialog `New query`: name, type, text checked as typed, grouping, three sort rows, Save query. */
function NewQueryDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { types } = useLibrary();
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState('');
  const [text, setText] = useState('');
  const [check, setCheck] = useState('');
  const [groupBy, setGroupBy] = useState('');
  const [sorts, setSorts] = useState<SortRow[]>([{ key: '@title', dir: 'asc' }, { key: '', dir: 'asc' }, { key: '', dir: 'asc' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ text: '', typeId: '' });
  const checkSeq = useRef(0);

  useEffect(() => {
    void refreshLibrary();
  }, []);

  const chosenTypeId = typeId || types[0]?.id || '';
  const type: TypeJson | undefined = types.find((t) => t.id === chosenTypeId);
  const fields: FieldJson[] = type?.fields ?? [];
  latest.current = { text, typeId: chosenTypeId };

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  /** Asks the check endpoint shortly after the last change; only the answer for the text now in the box is shown. */
  const scheduleCheck = (nextText: string, nextType: string): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    setCheck('');
    timer.current = setTimeout(() => {
      timer.current = null;
      const mine = ++checkSeq.current;
      void (async () => {
        try {
          const r = await api<{ ok: true }>('POST', '/api/queries/check', { type_id: nextType, text: nextText });
          const now = latest.current;
          if (mine !== checkSeq.current || now.text !== nextText || now.typeId !== nextType) return;
          const errs = fieldErrors(r);
          setCheck(r.status === 200 ? '' : errs.text ?? errs.type_id ?? '');
        } catch {
          // offline: no answer to show
        }
      })();
    }, SEARCH_DELAY_MS);
  };

  const clearError = (key: string): void => {
    if (errors[key]) setErrors((e) => {
      const { [key]: _gone, ...rest } = e;
      return rest;
    });
  };

  const chooseType = (id: string): void => {
    setTypeId(id);
    const next = types.find((t) => t.id === id)?.fields ?? [];
    const names = new Set(next.map((f) => f.name));
    if (groupBy && !next.some((f) => f.name === groupBy && GROUPABLE.has(f.kind))) setGroupBy('');
    setSorts((rows) => rows.map((s, i) => (s.key.startsWith('@') || s.key === '' || names.has(s.key) ? s : { ...s, key: i === 0 ? '@title' : '' })));
    clearError('type_id');
    if (text.trim()) scheduleCheck(text, id);
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const body = {
        name, type_id: chosenTypeId, text, group_by: groupBy || null,
        sort: sorts.filter((s) => s.key !== '').map((s) => ({ key: s.key, dir: s.dir })),
      };
      const r = await api<QueryJson>('POST', '/api/queries', body);
      if (r.status === 201) {
        onSaved();
        return;
      }
      const errs = fieldErrors(r);
      setErrors(errs);
      if (errs.text) setCheck('');
      const first = FIELD_ORDER.find((k) => errs[k]) ?? Object.keys(errs)[0];
      const id = first ? FIELD_IDS[first] : undefined;
      if (id) formRef.current?.querySelector<HTMLElement>(`#${id}`)?.focus();
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
    } finally {
      setPending(false);
    }
  };

  const err = (key: string, id: string) => (errors[key] ? <p id={`${id}-error`} className="field-error">{errors[key]}</p> : null);
  const described = (key: string, id: string): string | undefined => (errors[key] ? `${id}-error` : undefined);
  const textMessage = errors.text ?? check;
  const setSort = (i: number, patch: Partial<SortRow>): void => {
    setSorts((rows) => rows.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    clearError(`sort.${i}.${'key' in patch ? 'key' : 'dir'}`);
    if (i === 0) clearError('sort');
  };

  return (
    <Dialog label="New query" onClose={onClose} className="query-dialog">
      <form ref={formRef} className="query-form" onSubmit={(e) => void submit(e)} noValidate>
        <h2>New query</h2>
        <div className="field">
          <label htmlFor="nq-name">Query name</label>
          <input id="nq-name" type="text" value={name} autoComplete="off" aria-describedby={described('name', 'nq-name')}
            onChange={(e) => { setName(e.target.value); clearError('name'); }} />
          {err('name', 'nq-name')}
        </div>
        <div className="field">
          <label htmlFor="nq-type">Type</label>
          <select id="nq-type" value={chosenTypeId} aria-describedby={described('type_id', 'nq-type')} onChange={(e) => chooseType(e.target.value)}>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {err('type_id', 'nq-type')}
        </div>
        <div className="field">
          <label htmlFor="nq-text">Query</label>
          <input id="nq-text" type="text" value={text} autoComplete="off" spellCheck={false} aria-describedby="nq-text-check"
            onChange={(e) => { setText(e.target.value); clearError('text'); scheduleCheck(e.target.value, chosenTypeId); }} />
          <p id="nq-text-check" className="field-error check">{textMessage}</p>
        </div>
        <div className="field">
          <label htmlFor="nq-group">Group by</label>
          <select id="nq-group" value={groupBy} aria-describedby={described('group_by', 'nq-group')}
            onChange={(e) => { setGroupBy(e.target.value); clearError('group_by'); }}>
            <option value="">No grouping</option>
            {fields.filter((f) => GROUPABLE.has(f.kind)).map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
          </select>
          {err('group_by', 'nq-group')}
        </div>
        {sorts.map((s, i) => {
          const keyId = `nq-sort-key-${i}`;
          const dirId = `nq-sort-dir-${i}`;
          const keyErr = i === 0 && errors.sort && !errors['sort.0.key'] ? 'sort' : `sort.${i}.key`;
          return (
            <div className="sort-row" key={i}>
              <div className="field">
                <label htmlFor={keyId}>{`Sort key ${i + 1}`}</label>
                <select id={keyId} value={s.key} aria-describedby={described(keyErr, keyId)} onChange={(e) => setSort(i, { key: e.target.value })}>
                  {i > 0 && <option value="">None</option>}
                  {BUILTIN_KEYS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  {fields.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                </select>
                {err(keyErr, keyId)}
              </div>
              <div className="field">
                <label htmlFor={dirId}>{`Direction ${i + 1}`}</label>
                <select id={dirId} value={s.dir} aria-describedby={described(`sort.${i}.dir`, dirId)}
                  onChange={(e) => setSort(i, { dir: e.target.value === 'desc' ? 'desc' : 'asc' })}>
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
                {err(`sort.${i}.dir`, dirId)}
              </div>
            </div>
          );
        })}
        <div className="dialog-actions">
          <button type="submit" className="primary" aria-busy={pending || undefined}>Save query</button>
        </div>
      </form>
    </Dialog>
  );
}
