import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CommunityView } from '../../shared/types.js';
import { ApiError, api, get, query } from '../api.js';
import { announce } from '../announce.js';
import { JoinButton, membersLabel } from '../community.js';
import { useLive } from '../live.js';
import { Link, navigate } from '../router.js';
import { useSession } from '../session.js';
import { Button, Empty, Field, RadioGroup, Skeleton, pageTitle, useFocusFirstInvalid } from '../ui.js';
import './pages.css';

interface Page { items: CommunityView[]; nextCursor: string | null }

export function CommunitiesPage(_props: Record<string, unknown>): React.JSX.Element {
  pageTitle('Communities');
  const { user, loading } = useSession();
  const [items, setItems] = useState<CommunityView[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (loading) return;
    setItems(null);
    void get<Page>('/api/communities').then((page) => { setItems(page.items); setCursor(page.nextCursor); }, () => setItems([]));
  }, [userId, loading]);

  useLive(['home'], (event, data) => {
    if (event !== 'membership') return;
    const payload = data as { communityName: string; memberCount: number };
    setItems((all) => all && all.map((c) => (c.name.toLowerCase() === payload.communityName.toLowerCase() ? { ...c, memberCount: payload.memberCount } : c)));
  });

  const loadMore = async (): Promise<void> => {
    setMore(true);
    try {
      const page = await get<Page>(`/api/communities${query({ cursor })}`);
      setItems((all) => [...(all ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      announce("Couldn't load more communities", true);
    } finally {
      setMore(false);
    }
  };

  return (
    <div className="page-solo">
      <h1>Communities</h1>
      {items === null && <Skeleton rows={4} />}
      {items !== null && items.length === 0 && <Empty title="No communities yet">Be the first to start one.</Empty>}
      {items?.map((community) => (
        <article key={community.id} id={`community-${community.name}`} className="community-card" aria-labelledby={`community-title-${community.name}`}>
          <div>
            <h2 id={`community-title-${community.name}`}><Link to={`/c/${community.name}`}>{community.title}</Link></h2>
            <div className="card-meta">
              <span className="num">{`c/${community.name}`}</span>
              <span id={`members-${community.name}`} className="num">{membersLabel(community.memberCount)}</span>
              {community.type === 'restricted' && <span className="tag">Restricted</span>}
            </div>
          </div>
          <JoinButton quiet community={community} onChange={(next) => setItems((all) => all && all.map((c) => (c.id === next.id ? next : c)))} />
          {community.description !== '' && <p>{community.description}</p>}
        </article>
      ))}
      {cursor !== null && <div className="load-more"><Button disabled={more} onClick={() => void loadMore()}>Load more communities</Button></div>}
    </div>
  );
}

export function CreateCommunityPage(_props: Record<string, unknown>): React.JSX.Element {
  pageTitle('Create community');
  const { user, loading } = useSession();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('public');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(form, tries);

  useEffect(() => {
    if (!loading && !user) navigate('/login?next=%2Fcommunities%2Fnew', true);
  }, [loading, user]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const made = await api<CommunityView>('POST', '/api/communities', { name, title, description, type });
      navigate(`/c/${made.name}`);
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fields).length > 0) {
        setErrors(error.fields);
        setTries((n) => n + 1);
      } else if (error instanceof ApiError && (error.code === 'NOT_ELIGIBLE' || error.code === 'EMAIL_UNVERIFIED')) {
        announce(error.message, true);
      } else {
        announce("We couldn't create the community. Try again.", true);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!user) return <Skeleton rows={2} />;
  return (
    <div className="narrow form-card">
      <h1>Create community</h1>
      <form ref={form} onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Name" error={errors.name} hint="3 to 21 letters, digits or underscores. It cannot change later.">
          {(p) => <input {...p} type="text" name="name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Title" error={errors.title}>
          {(p) => <input {...p} type="text" name="title" autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Description" error={errors.description}>
          {(p) => <textarea {...p} name="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <RadioGroup
          label="Type" name="type" value={type} onChange={setType} error={errors.type}
          options={[{ value: 'public', label: 'Public' }, { value: 'restricted', label: 'Restricted' }]}
        />
        <div className="form-actions">
          <Button type="submit" variant="primary" busy={busy} disabled={busy}>{busy ? 'Creating...' : 'Create community'}</Button>
        </div>
      </form>
    </div>
  );
}
