import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { CommunityView, Rule } from '../../shared/types.js';
import { ApiError, api, get } from '../api.js';
import { announce } from '../announce.js';
import { CommunityHead, useCommunity } from '../community.js';
import { navigate, usePath } from '../router.js';
import { useSession } from '../session.js';
import { Banner, Button, Empty, Field, Skeleton, Tabs, pageTitle, useFocusFirstInvalid } from '../ui.js';
import './pages.css';

type Tool = 'moderators' | 'approved' | 'rules' | 'settings';
const TOOLS = [
  { value: 'moderators', label: 'Moderators' },
  { value: 'approved', label: 'Approved posters' },
  { value: 'rules', label: 'Rules' },
  { value: 'settings', label: 'Settings' },
] as const;

interface Moderator { username: string; isOwner: boolean }

/** A moderator who needs two-factor is sent to set it up and brought back here. */
function useTotpGate(): (error: unknown) => boolean {
  const path = usePath();
  return useCallback((error: unknown) => {
    if (error instanceof ApiError && error.code === 'TOTP_REQUIRED') {
      navigate(`/settings/2fa?next=${encodeURIComponent(path)}`, true);
      return true;
    }
    return false;
  }, [path]);
}

/** One username box with its button: Enter submits. */
function UsernameForm({ action, onSubmit }: { action: string; onSubmit: (username: string) => Promise<string | null> }): React.JSX.Element {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(form, tries);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    const problem = await onSubmit(username.trim());
    setBusy(false);
    setError(problem ?? undefined);
    if (problem === null) setUsername('');
    else setTries((n) => n + 1);
  };
  return (
    <form ref={form} className="inline-form" onSubmit={(e) => void submit(e)} noValidate>
      <Field label="Username" error={error}>
        {(p) => <input {...p} type="text" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />}
      </Field>
      <Button type="submit" variant="primary" disabled={busy}>{action}</Button>
    </form>
  );
}

function ModeratorsPanel({ community, onTotp }: { community: CommunityView; onTotp: (e: unknown) => boolean }): React.JSX.Element {
  const [items, setItems] = useState<Moderator[] | null>(null);
  const isOwner = community.viewer.isOwner;
  const base = `/api/communities/${community.name}/moderators`;

  useEffect(() => {
    get<{ items: Moderator[] }>(base).then((r) => setItems(r.items), (error: unknown) => { if (!onTotp(error)) setItems([]); });
  }, [base, onTotp]);

  const add = async (username: string): Promise<string | null> => {
    try {
      const added = await api<Moderator>('POST', base, { username });
      setItems((all) => [...(all ?? []), added]);
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return 'No member has that username';
      if (error instanceof ApiError && error.code === 'CONFLICT') return 'That member is already a moderator';
      if (error instanceof ApiError && error.status === 422) return error.fields.username ?? 'Enter a username';
      announce("The moderator wasn't added", true);
      return 'The moderator was not added';
    }
  };

  const remove = async (username: string): Promise<void> => {
    try {
      await api('DELETE', `${base}/${encodeURIComponent(username)}`);
      setItems((all) => (all ?? []).filter((m) => m.username !== username));
    } catch {
      announce("The moderator wasn't removed", true);
    }
  };

  if (items === null) return <Skeleton rows={2} />;
  return (
    <>
      {isOwner && <UsernameForm action="Add moderator" onSubmit={add} />}
      <ul className="list-plain">
        {items.map((m) => (
          <li key={m.username} className="list-row">
            <span>{`u/${m.username}`}{m.isOwner && <>{' '}<span className="tag">Owner</span></>}</span>
            {isOwner && !m.isOwner && <Button onClick={() => void remove(m.username)}>{`Remove ${m.username} as moderator`}</Button>}
          </li>
        ))}
      </ul>
    </>
  );
}

function ApprovedPanel({ community }: { community: CommunityView }): React.JSX.Element {
  const [items, setItems] = useState<Array<{ username: string }> | null>(null);
  const base = `/api/communities/${community.name}/approved`;
  useEffect(() => {
    get<{ items: Array<{ username: string }> }>(base).then((r) => setItems(r.items), () => setItems([]));
  }, [base]);

  const approve = async (username: string): Promise<string | null> => {
    try {
      await api('PUT', `${base}/${encodeURIComponent(username)}`);
      setItems((all) => ((all ?? []).some((a) => a.username === username) ? all : [...(all ?? []), { username }]));
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return 'No member has that username';
      announce("The approval didn't save", true);
      return 'The approval was not saved';
    }
  };

  const unapprove = async (username: string): Promise<void> => {
    try {
      await api('DELETE', `${base}/${encodeURIComponent(username)}`);
      setItems((all) => (all ?? []).filter((a) => a.username !== username));
    } catch {
      announce("The approval wasn't removed", true);
    }
  };

  if (items === null) return <Skeleton rows={2} />;
  return (
    <>
      {community.type === 'public' && <p className="muted">This community is public, so anyone verified can post. Approvals apply if it becomes restricted.</p>}
      <UsernameForm action="Approve" onSubmit={approve} />
      {items.length === 0 && <p className="muted">No approved posters yet.</p>}
      <ul className="list-plain">
        {items.map((a) => (
          <li key={a.username} className="list-row">
            <span>{`u/${a.username}`}</span>
            <Button onClick={() => void unapprove(a.username)}>{`Remove approval for ${a.username}`}</Button>
          </li>
        ))}
      </ul>
    </>
  );
}

interface RuleDraft { key: number; title: string; description: string }

function RulesPanel({ community, onSaved }: { community: CommunityView; onSaved: (next: CommunityView) => void }): React.JSX.Element {
  const counter = useRef(0);
  const draft = (r: Pick<Rule, 'title' | 'description'>): RuleDraft => ({ key: counter.current++, title: r.title, description: r.description });
  const [rules, setRules] = useState<RuleDraft[]>(() => community.rules.map(draft));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const change = (key: number, patch: Partial<RuleDraft>): void => setRules((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const next = await api<CommunityView>('PUT', `/api/communities/${community.name}/rules`, { rules: rules.map(({ title, description }) => ({ title, description })) });
      setError(undefined);
      onSaved(next);
      announce('Rules saved');
    } catch (caught) {
      setError(caught instanceof ApiError && caught.fields.rules ? caught.fields.rules : 'The rules were not saved');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} noValidate>
      {rules.length === 0 && <p className="muted">No rules yet.</p>}
      {rules.map((r, i) => (
        <fieldset key={r.key} className="rule-edit">
          <legend>{`Rule ${i + 1}`}</legend>
          <Field label={`Rule ${i + 1} title`}>
            {(p) => <input {...p} type="text" value={r.title} onChange={(e) => change(r.key, { title: e.target.value })} />}
          </Field>
          <Field label={`Rule ${i + 1} description`}>
            {(p) => <textarea {...p} rows={2} value={r.description} onChange={(e) => change(r.key, { description: e.target.value })} />}
          </Field>
          <Button onClick={() => setRules((all) => all.filter((x) => x.key !== r.key))}>{`Remove rule ${i + 1}`}</Button>
        </fieldset>
      ))}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="form-actions">
        <Button onClick={() => setRules((all) => [...all, draft({ title: '', description: '' })])} disabled={rules.length >= 15}>Add rule</Button>
        <Button type="submit" variant="primary" busy={busy}>Save rules</Button>
      </div>
    </form>
  );
}

function SettingsPanel({ community, onSaved }: { community: CommunityView; onSaved: (next: CommunityView) => void }): React.JSX.Element {
  const [title, setTitle] = useState(community.title);
  const [description, setDescription] = useState(community.description);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const patch = async (body: Record<string, unknown>): Promise<CommunityView | null> => {
    try {
      const next = await api<CommunityView>('PATCH', `/api/communities/${community.name}`, body);
      onSaved(next);
      setErrors({});
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) setErrors(error.fields);
      else announce("The setting didn't save", true);
      return null;
    }
  };

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    if (await patch({ title, description })) announce('Settings saved');
    setBusy(false);
  };

  return (
    <>
      <label className="check">
        <input
          type="checkbox" checked={community.showModNames}
          onChange={(e) => void patch({ showModNames: e.target.checked }).then((next) => { if (next) announce('Settings saved'); })}
        />
        <span>Show moderator names in the public log</span>
      </label>
      <form onSubmit={(e) => void save(e)} noValidate>
        <Field label="Title" error={errors.title}>
          {(p) => <input {...p} type="text" value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Description" error={errors.description}>
          {(p) => <textarea {...p} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <div className="form-actions"><Button type="submit" variant="primary" busy={busy}>Save settings</Button></div>
      </form>
    </>
  );
}

export function ModToolsPage({ name }: { name: string }): React.JSX.Element {
  const { user, loading } = useSession();
  const community = useCommunity(name);
  const [tool, setTool] = useState<Tool>('moderators');
  const onTotp = useTotpGate();
  const data = community.data;
  pageTitle(data ? `Moderator tools · c/${data.name}` : 'Moderator tools');
  const isModerator = data?.viewer.isModerator ?? false;

  // Moderator endpoints answer TOTP_REQUIRED until two-factor is on; probe once so the redirect happens at once.
  useEffect(() => {
    if (!isModerator) return;
    get(`/api/communities/${name}/moderators`).catch((error: unknown) => { onTotp(error); });
  }, [isModerator, name, onTotp]);

  if (community.error?.status === 404) return <Empty title="Community not found">There is no community called c/{name}.</Empty>;
  if (loading || !data) return <Skeleton rows={3} />;
  if (!user) {
    return <Empty title="Sign in to continue"><p><a href={`/login?next=${encodeURIComponent(`/c/${name}/about/mod`)}`}>Sign in</a> to use moderator tools.</p></Empty>;
  }
  if (!isModerator) {
    return <Empty title="Moderators only">Only the moderators of c/{data.name} can open these tools.</Empty>;
  }
  return (
    <div className="page-wide">
      <CommunityHead community={data} onChange={(next) => community.setData(next)} />
      <h2>Moderator tools</h2>
      <Banner>Changes here take effect for everyone at once and are recorded in the public mod log.</Banner>
      <Tabs label="Moderator tools" value={tool} options={[...TOOLS]} onChange={setTool} panelId="mod-panel" />
      <div id="mod-panel" role="tabpanel" className="tabpanel">
        {tool === 'moderators' && <ModeratorsPanel community={data} onTotp={onTotp} />}
        {tool === 'approved' && <ApprovedPanel community={data} />}
        {tool === 'rules' && <RulesPanel community={data} onSaved={(next) => community.setData(next)} />}
        {tool === 'settings' && <SettingsPanel community={data} onSaved={(next) => community.setData(next)} />}
      </div>
    </div>
  );
}
