import { useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MapPayload, Role } from '../../shared/model.ts';
import { api, HttpError } from '../api.ts';
import { setInboxUnread } from '../inbox.ts';
import { navigate } from '../router.ts';
import { AppBar } from '../ui/AppBar.tsx';
import { Icon } from '../ui/Icon.tsx';
import { InboxButton } from '../ui/InboxButton.tsx';
import { Link } from '../ui/Link.tsx';
import { MiniMap } from '../ui/MiniMap.tsx';
import { Modal } from '../ui/Modal.tsx';
import { Spinner } from '../ui/Spinner.tsx';
import { usePageHeading } from '../ui/usePageHeading.ts';

interface MapEntry {
  id: string;
  title: string;
  role: Role;
  updated_at: string;
  revision: number;
  topic_count: number;
}

interface Loaded {
  me: string;
  maps: MapEntry[];
  payloads: Map<string, MapPayload>;
}

type Template = 'street-fair' | 'exam-revision' | 'house-move' | null;

const TEMPLATE_CHOICES: { value: Template; label: string; hint: string }[] = [
  { value: null, label: 'Blank', hint: 'Just the central idea.' },
  { value: 'street-fair', label: 'Street fair', hint: 'Stalls, music, volunteers and a budget.' },
  { value: 'exam-revision', label: 'Exam revision', hint: 'Subjects, past papers and a task to track.' },
  { value: 'house-move', label: 'House move', hint: 'Boxes, utilities, address changes, moving day.' },
];

const formatDate = (iso: string): string => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const topicsLabel = (n: number): string => `${n} ${n === 1 ? 'topic' : 'topics'}`;
const roleLabel = (role: Role): string => role.charAt(0).toUpperCase() + role.slice(1);

export function Maps() {
  const heading = usePageHeading();
  const newMap = useRef<HTMLButtonElement>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useLayoutEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [me, list] = await Promise.all([
          api<{ user: { username: string } }>('GET', '/api/me'),
          api<{ maps: MapEntry[] }>('GET', '/api/maps'),
        ]);
        const found = await Promise.all(list.maps.map((m) => api<MapPayload>('GET', `/api/maps/${encodeURIComponent(m.id)}`).catch(() => null)));
        const payloads = new Map<string, MapPayload>();
        found.forEach((payload, at) => {
          const entry = list.maps[at];
          if (payload && entry) payloads.set(entry.id, payload);
        });
        if (live) setData({ me: me.user.username, maps: list.maps, payloads });
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) navigate('/signin', { replace: true });
        else if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const recent = useMemo(() => (data ? [...data.maps].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3) : []), [data]);

  const signOut = async (): Promise<void> => {
    if (leaving) return;
    setLeaving(true);
    try {
      await api('POST', '/api/auth/logout');
    } catch {
      /* the cookie may already be gone */
    }
    setInboxUnread(0);
    navigate('/');
  };

  return (
    <div class="maps-page">
      <AppBar>
        <InboxButton />
        <button type="button" class="btn btn-secondary" onClick={() => void signOut()} disabled={leaving}>
          <Icon name="log-out" size={18} />
          <span>Sign out</span>
        </button>
      </AppBar>
      <main class="maps-main">
        <div class="maps-head">
          <div>
            <h1 ref={heading} tabIndex={-1}>
              Your maps
            </h1>
            {data ? <p class="maps-sub">Signed in as {data.me}</p> : null}
          </div>
          <button ref={newMap} type="button" class="btn btn-primary btn-lg" onClick={() => setCreating(true)}>
            <Icon name="plus" size={20} />
            <span>New map</span>
          </button>
        </div>

        {failed ? (
          <div class="notice" role="alert">
            <Icon name="circle-alert" size={20} />
            <div>
              <p class="notice-title">We couldn't load your maps.</p>
              <p class="notice-text">Check your connection and reload the page.</p>
            </div>
          </div>
        ) : data === null ? (
          <p class="maps-loading" role="status">
            <Spinner /> <span>Loading your maps</span>
          </p>
        ) : data.maps.length === 0 ? (
          <div class="maps-empty">
            <EmptyArt />
            <p>You have no maps yet. Start one from a central idea.</p>
          </div>
        ) : (
          <>
            <section class="recent" aria-label="Recent maps">
              <h2 class="maps-section">Recently updated</h2>
              <div class="recent-grid">
                {recent.map((m) => (
                  <article class="recent-card" key={m.id}>
                    <div class="recent-thumb">{thumb(data.payloads.get(m.id))}</div>
                    <div class="recent-info">
                      <h3>
                        <Link href={`/m/${m.id}`} class="card-link">
                          {m.title}
                        </Link>
                      </h3>
                      <p class="card-meta">
                        <span class="tnum">{topicsLabel(m.topic_count)}</span>
                        <span aria-hidden="true">·</span>
                        <time dateTime={m.updated_at}>{formatDate(m.updated_at)}</time>
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
            <section class="all-maps">
              <h2 class="maps-section">All maps</h2>
              <ul class="maps-grid plain" aria-label="All maps">
                {data.maps.map((m) => (
                  <li class="map-card" key={m.id}>
                    <div class="map-thumb">{thumb(data.payloads.get(m.id), 20)}</div>
                    <h3>
                      <Link href={`/m/${m.id}`} class="card-link">
                        {m.title}
                      </Link>
                    </h3>
                    <p class="card-meta">
                      <span class="badge">{roleLabel(m.role)}</span>
                      <span class="tnum">{topicsLabel(m.topic_count)}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={m.updated_at}>{formatDate(m.updated_at)}</time>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
      {creating ? <NewMapDialog opener={newMap.current} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function thumb(payload: MapPayload | undefined, padding = 12, minZoom = 0) {
  if (!payload) return <div class="thumb-missing" />;
  return <MiniMap topics={payload.topics} links={payload.links} layout={payload.map.layout} theme={payload.map.theme} padding={padding} minZoom={minZoom} initial={{ w: 340, h: 190 }} />;
}

function EmptyArt() {
  return (
    <svg class="empty-art" viewBox="0 0 320 170" aria-hidden="true" focusable="false">
      <path d="M124 85C88 85 76 44 30 44" fill="none" stroke="var(--c-indigo)" stroke-width="12" stroke-linecap="round" />
      <path d="M124 85C86 85 76 126 30 126" fill="none" stroke="var(--c-teal)" stroke-width="12" stroke-linecap="round" />
      <path d="M196 85C232 85 244 44 290 44" fill="none" stroke="var(--c-orange)" stroke-width="12" stroke-linecap="round" stroke-dasharray="1 30" />
      <path d="M196 85C234 85 244 126 290 126" fill="none" stroke="var(--c-violet)" stroke-width="12" stroke-linecap="round" stroke-dasharray="1 30" />
      <rect x="112" y="61" width="96" height="48" rx="12" fill="var(--accent)" />
      <path d="M136 85h48" stroke="#fff" stroke-width="5" stroke-linecap="round" />
    </svg>
  );
}

function NewMapDialog({ opener, onClose }: { opener: HTMLElement | null; onClose: () => void }) {
  const ids = useId();
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState<Template>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const made = await api<{ map: { id: string } }>('POST', '/api/maps', { title, template });
      navigate(`/m/${made.map.id}`);
    } catch (e) {
      setError(e instanceof HttpError ? (e.fields.title ?? e.message) : 'Something went wrong. Try again.');
      setPending(false);
      input.current?.focus();
    }
  };

  return (
    <Modal label="New map" onClose={onClose} opener={opener} className="sheet-phone">
      <form class="modal-body" onSubmit={(event) => void submit(event)} noValidate>
        <h2 class="modal-title">New map</h2>
        <div class="field">
          <label class="field-label" for={`${ids}-t`}>
            Central idea
          </label>
          <input
            ref={input}
            id={`${ids}-t`}
            class="input"
            type="text"
            name="title"
            required
            aria-required="true"
            autocomplete="off"
            value={title}
            onInput={(event) => setTitle(event.currentTarget.value)}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? `${ids}-e` : undefined}
          />
          {error ? (
            <p class="field-error" id={`${ids}-e`}>
              <Icon name="circle-alert" size={18} />
              <span>{error}</span>
            </p>
          ) : null}
        </div>
        <div class="start-from">
          <p class="field-label" id={`${ids}-g`}>
            Start from
          </p>
          <div class="choices" role="radiogroup" aria-labelledby={`${ids}-g`}>
            {TEMPLATE_CHOICES.map((choice) => {
              const id = `${ids}-c-${choice.value ?? 'blank'}`;
              return (
                <div class="choice" key={id}>
                  <input id={id} type="radio" name={`${ids}-template`} checked={template === choice.value} onChange={() => setTemplate(choice.value)} aria-describedby={`${id}-d`} />
                  <label for={id}>{choice.label}</label>
                  <span class="choice-hint" id={`${id}-d`}>
                    {choice.hint}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="btn btn-primary" disabled={pending} aria-busy={pending ? 'true' : undefined}>
            <span class="btn-label">Create map</span>
            {pending ? <Spinner /> : null}
          </button>
        </div>
      </form>
    </Modal>
  );
}
