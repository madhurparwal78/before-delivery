import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { api, ApiError, refuse } from '../api.ts';
import { Link, navigate, searchParams, usePath } from '../router.tsx';
import { actionStatus, announcement } from '../store.ts';
import { Button, Field, Icon, Loading, NotFound, Screen, StatusWord } from '../ui.tsx';
import type { ChangeObject } from '../../shared/types.ts';
import './repo.css';

type R = { org: string; repo: string };

const segments = (path: string): string => path.split('/').map(encodeURIComponent).join('/');
const apiBase = ({ org, repo }: R): string => `/api/repos/${org}/${repo}`;
const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/** Loading state shared by the screens: loads on mount and whenever `key` changes. Layout effects only (page timers are paused in test browsers). */
function useData<T>(key: string, load: () => Promise<T>): { data: T | null; missing: boolean } {
  const [state, setState] = useState<{ data: T | null; missing: boolean }>({ data: null, missing: false });
  const run = useRef(0);
  useLayoutEffect(() => {
    const mine = ++run.current;
    setState({ data: null, missing: false });
    load().then(
      (data) => run.current === mine && setState({ data, missing: false }),
      (error) => {
        if (run.current !== mine) return;
        if (error instanceof ApiError && error.status === 401) navigate('/login', true);
        else if (error instanceof ApiError && error.status === 404) setState({ data: null, missing: true });
        else if (!refuse(error)) throw error;
      },
    );
  }, [key]);
  return state;
}

/** Bytes of a stored file exactly as served: no newline conversion, byte-order mark kept. */
async function rawText(path: string): Promise<{ text: string; bytes: number }> {
  const response = await fetch(path, { credentials: 'same-origin' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes), bytes: bytes.length };
}

function Heading({ r, children }: { r: R; children: ComponentChildren }) {
  return (
    <header className="repo-head">
      <p className="crumbs"><Link href={`/${r.org}/${r.repo}`}>{r.org}/{r.repo}</Link></p>
      <h1 className="page-title">{children}</h1>
    </header>
  );
}

function FileContent({ text, label = 'File content' }: { text: string; label?: string }) {
  return (
    <pre className="file-text" role="region" aria-label={label} tabIndex={0} data-byte-length={byteLength(text)}>{text}</pre>
  );
}

/** A plain arrow link: the glyph is part of the text. */
function ArrowLink({ href, children }: { href: string; children: string }) {
  return <Link href={href} className="plain-arrow">{children}</Link>;
}

// ---- Repository overview ----

interface OverviewData {
  repo: { settings: { required_approvals: number; required_checks: string[]; queue: boolean }; your_role: string };
  branches: string[];
  branch: string;
  files: { path: string; size: number }[];
  open_changes: { number: number; title: string; state: string; author: string }[];
  recent: { id: string; message: string; author: string; created_at: string }[];
}

export function Overview({ org, repo }: R) {
  usePath();
  const wanted = searchParams().get('branch') ?? 'main';
  const { data, missing } = useData(`${org}/${repo}/${wanted}`, () => api<OverviewData>('GET', `${apiBase({ org, repo })}/overview?branch=${encodeURIComponent(wanted)}`));
  if (missing) return <NotFound />;
  if (!data) return <Screen><Loading /></Screen>;
  const rules = data.repo.settings;
  const base = `/${org}/${repo}`;
  return (
    <Screen>
      <Heading r={{ org, repo }}>{repo}</Heading>
      <ul className="chips" aria-label="Merge rules">
        <li className="chip">Approvals: {rules.required_approvals} required</li>
        <li className="chip">Required checks: {rules.required_checks.length ? rules.required_checks.join(', ') : 'none'}</li>
        <li className="chip">Merge queue: {rules.queue ? 'on' : 'off'}</li>
        <li className="chip">Your role: {data.repo.your_role}</li>
      </ul>
      <div className="overview-grid">
        <section className="bento">
          <h2>Files</h2>
          <Field label="Branch">
            <select value={data.branch} onChange={(event) => navigate(`${base}?branch=${encodeURIComponent(event.currentTarget.value)}`)}>
              {data.branches.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </Field>
          <ul className="plain-list mono" aria-label="Files">
            {data.files.length
              ? data.files.map((file) => <li key={file.path}><Link href={`${base}/blob/${encodeURIComponent(data.branch)}/${segments(file.path)}`}>{file.path}</Link></li>)
              : <li className="muted">This branch has no files yet.</li>}
          </ul>
        </section>
        <section className="bento">
          <h2>Open changes</h2>
          <ul className="plain-list" aria-label="Open changes">
            {data.open_changes.length
              ? data.open_changes.map((change) => (
                  <li key={change.number}>
                    <Link href={`${base}/changes/${change.number}`}>#{change.number} {change.title}</Link>
                    <span className="muted"> {change.author}</span>
                  </li>
                ))
              : <li className="muted">No open changes.</li>}
          </ul>
          <p className="card-links">
            <Link href={`${base}/changes/new`} className="arrow-link">New change</Link>
            <Link href={`${base}/changes`} className="arrow-link">All changes</Link>
          </p>
        </section>
        <section className="bento">
          <h2>Recent revisions</h2>
          <ul className="plain-list" aria-label="Recent revisions">
            {data.recent.map((revision) => (
              <li key={revision.id}>
                <Link href={`${base}/revisions/${revision.id}`} className="mono">{revision.id}</Link>
                <span className="muted"> {revision.message}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="bento">
          <h2>Merge rules</h2>
          <p>Approvals, code owners, required checks and the merge queue decide when a change may reach the base branch.</p>
          <p className="card-links">
            <Link href={`${base}/queue`} className="arrow-link">Merge queue</Link>
            <Link href={`${base}/settings`} className="arrow-link">Settings</Link>
          </p>
        </section>
      </div>
    </Screen>
  );
}

// ---- File view ----

export function Blob({ org, repo, branch, path }: R & { branch: string; path: string }) {
  const r = { org, repo };
  const { data, missing } = useData(`${org}/${repo}/${branch}/${path}`, async () => {
    const head = await api<{ revision: string }>('GET', `${apiBase(r)}/branches/${encodeURIComponent(branch)}`);
    const url = `${apiBase(r)}/revisions/${head.revision}/files/${segments(path)}`;
    try {
      return { url, file: await rawText(url) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        refuse(error);
        return { url, file: null };
      }
      throw error;
    }
  });
  if (missing) return <NotFound />;
  if (!data) return <Screen><Loading /></Screen>;
  const base = `/${org}/${repo}`;
  return (
    <Screen>
      <Heading r={r}><span className="mono path">{path}</span></Heading>
      <p className="muted">on <span className="mono">{branch}</span></p>
      <p className="toolbar">
        <a className="btn btn-secondary" href={data.url}>Raw</a>
        <Link className="btn btn-secondary" href={`${base}/edit/${encodeURIComponent(branch)}/${segments(path)}`}>Edit file</Link>
      </p>
      {data.file ? <FileContent text={data.file.text} /> : null}
    </Screen>
  );
}

// ---- Editor ----

const STALE = (branch: string): string => `This file changed on ${branch} since you opened it. Your edit was not saved.`;
const normal = (text: string): string => text.replace(/\r\n/g, '\n');

export function Editor({ org, repo, branch, path }: R & { branch: string; path: string }) {
  const r = { org, repo };
  const base = apiBase(r);
  const [ready, setReady] = useState(false);
  const [existed, setExisted] = useState(true);
  const [original, setOriginal] = useState('');
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  const [head, setHead] = useState('');
  const [latest, setLatest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fileUrl = (revision: string): string => `${base}/revisions/${revision}/files/${segments(path)}`;

  useLayoutEffect(() => {
    let live = true;
    setReady(false);
    (async () => {
      try {
        const tip = await api<{ revision: string }>('GET', `${base}/branches/${encodeURIComponent(branch)}`);
        if (!live) return;
        setHead(tip.revision);
        try {
          const file = await rawText(fileUrl(tip.revision));
          setOriginal(file.text);
          setText(file.text);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) setExisted(false);
          else if (!refuse(error)) throw error;
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) navigate('/login', true);
        else if (!refuse(error)) throw error;
      }
      if (live) setReady(true);
    })();
    return () => { live = false; };
  }, [org, repo, branch, path]);

  const loadLatest = async (): Promise<void> => {
    try {
      const tip = await api<{ revision: string }>('GET', `${base}/branches/${encodeURIComponent(branch)}`);
      setHead(tip.revision);
      try {
        setLatest((await rawText(fileUrl(tip.revision))).text);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) setLatest('');
        else throw error;
      }
    } catch (error) {
      if (!refuse(error)) throw error;
    }
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setErrors({});
    announcement.set(null);
    actionStatus.set('Saving...');
    // Unedited text goes back byte for byte: a textarea cannot hold carriage returns.
    const content = normal(text) === normal(original) ? original : text;
    try {
      const done = await api<{ revision: string }>('POST', `${base}/push`, { branch, expected_head: head, message, files: [{ path, content }] });
      setHead(done.revision);
      setOriginal(content);
      setExisted(true);
      actionStatus.set(`Saved as revision ${done.revision}.`);
    } catch (error) {
      actionStatus.set('');
      if (error instanceof ApiError && error.status === 409 && error.body.current_head) {
        announcement.set({ message: STALE(branch), action: <Button onClick={() => void loadLatest()}>Load latest</Button> });
      } else if (error instanceof ApiError && error.status === 422) {
        setErrors(error.fields);
      } else if (!refuse(error)) {
        throw error;
      }
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <Screen><Loading /></Screen>;
  return (
    <Screen>
      <Heading r={r}>Edit <span className="mono path">{path}</span></Heading>
      <p className="muted">on <span className="mono">{branch}</span>{existed ? '' : ' (new file)'}</p>
      <div className="editor card">
        <Field label="File content" error={errors.files ?? errors['files.0.content']}>
          <textarea value={text} rows={16} spellcheck={false} onInput={(event) => setText(event.currentTarget.value)} />
        </Field>
        <Field label="Revision message" error={errors.message}>
          <input type="text" value={message} placeholder="Describe the change" onInput={(event) => setMessage(event.currentTarget.value)} />
        </Field>
        <div className="toolbar">
          <Button kind="primary" busy={busy} onClick={() => void save()}>Save file</Button>
          <Link className="btn btn-secondary" href={existed ? `/${org}/${repo}/blob/${encodeURIComponent(branch)}/${segments(path)}` : `/${org}/${repo}`}>Cancel</Link>
        </div>
      </div>
      {latest !== null ? (
        <section className="stack-gap">
          <h2>Latest version</h2>
          <FileContent text={latest} label="Latest version" />
        </section>
      ) : null}
    </Screen>
  );
}

// ---- Revision view ----

interface RevisionFacts { id: string; parents: string[]; message: string; author: string; created_at: string; files: { path: string; size: number }[] }

export function Revision({ org, repo, id }: R & { id: string }) {
  const r = { org, repo };
  const [busy, setBusy] = useState(false);
  const { data, missing } = useData(`${org}/${repo}/${id}`, async () => {
    const facts = await api<RevisionFacts>('GET', `${apiBase(r)}/revisions/${id}`);
    try {
      const full = await api<{ files: { path: string; text: string }[] }>('GET', `${apiBase(r)}/revisions/${id}/contents`);
      return { facts, texts: new Map(full.files.map((file) => [file.path, file.text])) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        refuse(error);
        return { facts, texts: new Map<string, string>() };
      }
      throw error;
    }
  });
  if (missing) return <NotFound />;
  if (!data) return <Screen><Loading /></Screen>;
  const { facts, texts } = data;
  const exportArchive = async (): Promise<void> => {
    setBusy(true);
    announcement.set(null);
    actionStatus.set('Exporting...');
    try {
      const done = await api<{ key: string }>('POST', `${apiBase(r)}/revisions/${id}/archive`);
      actionStatus.set(`Archive saved to ${done.key}`);
    } catch (error) {
      actionStatus.set('');
      if (!refuse(error)) throw error;
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Heading r={r}>Revision <span className="mono">{facts.id}</span></Heading>
      <div className="card facts">
        <dl>
          <dt>Message</dt><dd>{facts.message}</dd>
          <dt>Author</dt><dd>{facts.author}</dd>
          <dt>Time</dt><dd><time dateTime={facts.created_at}>{facts.created_at}</time></dd>
          <dt>Parents</dt>
          <dd className="mono">{facts.parents.length ? facts.parents.map((parent) => <Link key={parent} href={`/${org}/${repo}/revisions/${parent}`}>{parent} </Link>) : 'none'}</dd>
        </dl>
        <Button busy={busy} onClick={() => void exportArchive()}>Export archive</Button>
      </div>
      <ul className="file-cards" aria-label="Files in this revision">
        {facts.files.map((file) => (
          <li key={file.path} className="bento">
            <h2 className="mono path"><Icon name="file" size={18} /> {file.path} <span className="muted size">{file.size} bytes</span></h2>
            {texts.has(file.path) ? <FileContent text={texts.get(file.path)!} /> : null}
          </li>
        ))}
        {facts.files.length === 0 ? <li className="muted">This revision holds no files.</li> : null}
      </ul>
    </Screen>
  );
}

// ---- Changes list and creation ----

export function Changes({ org, repo }: R) {
  const r = { org, repo };
  const { data, missing } = useData(`${org}/${repo}/changes`, () => api<ChangeObject[]>('GET', `${apiBase(r)}/changes`));
  if (missing) return <NotFound />;
  if (!data) return <Screen><Loading /></Screen>;
  const base = `/${org}/${repo}`;
  const row = (change: ChangeObject) => (
    <li key={change.number} className="row-card" data-state={change.state}>
      <Link href={`${base}/changes/${change.number}`} className="title">#{change.number} {change.title}</Link>
      <span className="sub">{change.author} • {org}/{repo}</span>
      <StatusWord state={change.state} />
    </li>
  );
  const open = data.filter((change) => change.state !== 'merged');
  const merged = data.filter((change) => change.state === 'merged');
  return (
    <Screen>
      <Heading r={r}>Changes</Heading>
      <p className="toolbar"><Link href={`${base}/changes/new`} className="btn btn-primary">New change</Link></p>
      {open.length ? (
        <ul className="row-list" aria-label="Open changes">{open.map(row)}</ul>
      ) : (
        <div className="empty"><p>There are no open changes.</p><ArrowLink href={`${base}/changes/new`}>Open a change →</ArrowLink></div>
      )}
      {merged.length ? <><h2 className="section-title">Merged</h2><ul className="row-list" aria-label="Merged changes">{merged.map(row)}</ul></> : null}
    </Screen>
  );
}

export function NewChange({ org, repo }: R) {
  const r = { org, repo };
  const { data, missing } = useData(`${org}/${repo}/new`, () => api<{ name: string }[]>('GET', `${apiBase(r)}/branches`));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [head, setHead] = useState('');
  const [base, setBase] = useState('main');
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (missing) return <NotFound />;
  if (!data) return <Screen><Loading /></Screen>;
  const names = data.map((branch) => branch.name);
  const headValue = head || names.find((name) => name !== 'main') || names[0] || '';
  const baseValue = names.includes(base) ? base : names[0] ?? '';
  const create = async (): Promise<void> => {
    setBusy(true);
    setErrors({});
    announcement.set(null);
    actionStatus.set('Working...');
    try {
      const made = await api<ChangeObject>('POST', `${apiBase(r)}/changes`, { title, description, head: headValue, base: baseValue, draft });
      navigate(`/${org}/${repo}/changes/${made.number}`);
      actionStatus.set(`Change #${made.number} created.`);
    } catch (error) {
      actionStatus.set('');
      if (error instanceof ApiError && error.status === 422) setErrors(error.fields);
      else if (!refuse(error)) throw error;
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Heading r={r}>New change</Heading>
      <div className="card form-grid new-change">
        <Field label="Title" error={errors.title}>
          <input type="text" value={title} onInput={(event) => setTitle(event.currentTarget.value)} />
        </Field>
        <Field label="Description" error={errors.description}>
          <textarea value={description} rows={4} onInput={(event) => setDescription(event.currentTarget.value)} />
        </Field>
        <div className="grid-2">
          <Field label="Head branch" error={errors.head}>
            <select value={headValue} onChange={(event) => setHead(event.currentTarget.value)}>
              {names.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </Field>
          <Field label="Base branch" error={errors.base}>
            <select value={baseValue} onChange={(event) => setBase(event.currentTarget.value)}>
              {names.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </Field>
        </div>
        <label className="check"><input type="checkbox" checked={draft} onChange={(event) => setDraft(event.currentTarget.checked)} /> Open as draft</label>
        <div className="toolbar"><Button kind="primary" busy={busy} onClick={() => void create()}>Create change</Button></div>
      </div>
    </Screen>
  );
}
