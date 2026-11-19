import { useState } from 'preact/hooks';
import { Link, navigate } from '../router.tsx';
import { Button, Loading, NotFound, Screen, StatusWord } from '../ui.tsx';
import { api } from '../api.ts';
import type { ChangeState } from '../../shared/types.ts';
import { SelectField, TextField, useAction, useLoad } from './shared.tsx';
import './lists.css';

interface InboxItem { number: number; title: string; state: ChangeState; author: string; org: string; repo: string }

function EmptyNote({ text, href, link }: { text: string; href: string; link: string }) {
  return (
    <div className="empty">
      <p>{text}</p>
      <Link href={href} className="empty-link">{link}</Link>
    </div>
  );
}

function ChangeRows({ items }: { items: InboxItem[] }) {
  return (
    <ul className="row-list">
      {items.map((item) => (
        <li key={`${item.org}/${item.repo}#${item.number}`} className="row-card" data-state={item.state}>
          <Link className="title" href={`/${item.org}/${item.repo}/changes/${item.number}`}>#{item.number} {item.title}</Link>
          <span className="sub">{`${item.author} • ${item.org}/${item.repo}`}</span>
          <StatusWord state={item.state} />
        </li>
      ))}
    </ul>
  );
}

export function Inbox() {
  const { data } = useLoad(() => api<{ review: InboxItem[]; mine: InboxItem[] }>('GET', '/api/inbox'), 'inbox');
  return (
    <Screen>
      <h1 className="page-title">Inbox</h1>
      {!data ? <Loading /> : (
        <>
          <div className="list-head">
            <h2>Needs your review</h2>
            <span className="count-chip num" aria-label={`${data.review.length} waiting`}>{data.review.length}</span>
          </div>
          {data.review.length ? <ChangeRows items={data.review} /> : <EmptyNote text="Nothing is waiting for your review." href="/repos" link="Browse repositories →" />}
          <div className="list-head"><h2>Your changes</h2></div>
          {data.mine.length ? <ChangeRows items={data.mine} /> : <EmptyNote text="You have no unmerged changes." href="/repos" link="Open a change →" />}
        </>
      )}
    </Screen>
  );
}

interface RepoItem { id: number; org: string; name: string; visibility: string; your_role: string }
interface OrgItem { slug: string; name: string; owner: boolean }

export function Repos() {
  const { data, reload } = useLoad(async () => {
    const [repos, orgs] = await Promise.all([api<RepoItem[]>('GET', '/api/repos'), api<OrgItem[]>('GET', '/api/orgs')]);
    return { repos, owned: orgs.filter((org) => org.owner) };
  }, 'repos');
  const [org, setOrg] = useState({ slug: '', name: '' });
  const [orgErrors, setOrgErrors] = useState<Record<string, string>>({});
  const [repo, setRepo] = useState({ org: '', name: '', visibility: 'private' });
  const [repoErrors, setRepoErrors] = useState<Record<string, string>>({});
  const orgAction = useAction();
  const repoAction = useAction();
  const chosen = repo.org || data?.owned[0]?.slug || '';
  return (
    <Screen>
      <h1 className="page-title">Repositories</h1>
      {!data ? <Loading /> : (
        <>
          {data.repos.length ? (
            <ul className="row-list repo-grid">
              {data.repos.map((item) => (
                <li key={item.id} className="bento repo-card">
                  <h2><Link href={`/${item.org}/${item.name}`}>{item.org}/{item.name}</Link></h2>
                  <div className="meta"><span className="chip">{item.visibility === 'public' ? 'Public' : 'Private'}</span><span className="chip">{item.your_role}</span></div>
                </li>
              ))}
            </ul>
          ) : <EmptyNote text="You have no repositories yet." href="#create-repository" link="Create a repository →" />}
          <div className="create-forms" id="create-repository">
            <form
              className="bento"
              noValidate
              onSubmit={async (event) => {
                event.preventDefault();
                setOrgErrors({});
                const result = await orgAction.run('Working...', 'Created.', () => api('POST', '/api/orgs', org));
                if (result.ok) navigate(`/${org.slug}`);
                else setOrgErrors(result.fields);
              }}
            >
              <h2>New organisation</h2>
              <TextField label="Organisation address" type="text" autoCapitalize="none" value={org.slug} onValue={(slug) => setOrg({ ...org, slug })} error={orgErrors.slug} />
              <TextField label="Organisation name" type="text" value={org.name} onValue={(name) => setOrg({ ...org, name })} error={orgErrors.name} />
              <Button kind="secondary" type="submit" busy={orgAction.busy}>Create organisation</Button>
            </form>
            <form
              className="bento"
              noValidate
              onSubmit={async (event) => {
                event.preventDefault();
                setRepoErrors({});
                const result = await repoAction.run('Working...', 'Created.', () => api('POST', `/api/orgs/${encodeURIComponent(chosen)}/repos`, { name: repo.name, visibility: repo.visibility }));
                if (result.ok) {
                  await reload();
                  navigate(`/${chosen}/${repo.name}`);
                } else setRepoErrors(result.fields);
              }}
            >
              <h2>New repository</h2>
              <SelectField label="Organisation" value={chosen} onValue={(value) => setRepo({ ...repo, org: value })} options={data.owned.map((item) => ({ value: item.slug, label: item.slug }))} />
              <TextField label="Repository name" type="text" autoCapitalize="none" value={repo.name} onValue={(name) => setRepo({ ...repo, name })} error={repoErrors.name} />
              <SelectField label="Visibility" value={repo.visibility} onValue={(visibility) => setRepo({ ...repo, visibility })} options={[{ value: 'private', label: 'Private' }, { value: 'public', label: 'Public' }]} />
              {repoErrors.visibility ? <span role="alert" className="field-error">{repoErrors.visibility}</span> : null}
              <Button kind="secondary" type="submit" busy={repoAction.busy} disabled={!data.owned.length}>Create repository</Button>
            </form>
          </div>
        </>
      )}
    </Screen>
  );
}

interface TeamItem { name: string; members: { username: string; name: string }[] }
interface OrgView { slug: string; name: string; owner: boolean; teams: TeamItem[] }

function TeamCard({ org, team, owner, onChanged }: { org: string; team: TeamItem; owner: boolean; onChanged: () => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  return (
    <li className="bento team-card">
      <h2>{team.name}</h2>
      {team.members.length ? (
        <ul className="member-list" aria-label={`Members of ${team.name}`}>
          {team.members.map((member) => <li key={member.username} className="chip">{member.name} · {member.username}</li>)}
        </ul>
      ) : <p className="muted">No members yet.</p>}
      {owner ? (
        <form
          className="inline-form"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setErrors({});
            const result = await run('Working...', 'Created.', () => api('PUT', `/api/orgs/${org}/teams/${team.name}/members/${encodeURIComponent(username)}`));
            if (result.ok) {
              setUsername('');
              await onChanged();
            }
          }}
        >
          <TextField label={`Username to add to ${team.name}`} type="text" autoCapitalize="none" value={username} onValue={setUsername} error={errors.username} />
          <Button kind="secondary" type="submit" busy={busy}>{`Add to ${team.name}`}</Button>
        </form>
      ) : null}
    </li>
  );
}

export function Organisation({ org }: { org: string }) {
  const { data, error, reload } = useLoad(() => api<OrgView>('GET', `/api/orgs/${encodeURIComponent(org)}`), `org:${org}`);
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  if (error) return <NotFound />;
  return (
    <Screen>
      {!data ? <Loading /> : (
        <>
          <h1 className="page-title">{data.name}</h1>
          <p className="muted">{data.slug}</p>
          <div className="list-head"><h2>Teams</h2></div>
          {data.owner ? (
            <form
              className="bento inline-form"
              noValidate
              onSubmit={async (event) => {
                event.preventDefault();
                setErrors({});
                const result = await run('Working...', 'Created.', () => api('POST', `/api/orgs/${org}/teams`, { name }));
                if (result.ok) {
                  setName('');
                  await reload();
                } else setErrors(result.fields);
              }}
            >
              <TextField label="Team name" type="text" autoCapitalize="none" value={name} onValue={setName} error={errors.name} />
              <Button kind="secondary" type="submit" busy={busy}>Create team</Button>
            </form>
          ) : null}
          {data.teams.length ? (
            <ul className="row-list team-list">
              {data.teams.map((team) => <TeamCard key={team.name} org={org} team={team} owner={data.owner} onChanged={reload} />)}
            </ul>
          ) : <p className="muted">This organisation has no teams yet.</p>}
        </>
      )}
    </Screen>
  );
}
