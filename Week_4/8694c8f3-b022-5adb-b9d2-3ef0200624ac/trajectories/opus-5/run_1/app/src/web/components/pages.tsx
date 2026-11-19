import { useEffect, useState } from 'react';
import { api, ApiFailure } from '../api.js';
import { store } from '../store.js';
import { Dialog, Emblem, LiveRegions, Menu, useStoreState } from './common.js';
import { Shell, WORKBENCH } from './Shell.js';
import { Stage } from './Stage.js';
import { buildDemoSet } from '../demo.js';
import type { Role, SetSummary, ShowBundle } from '../../shared/types.js';

type BoothView = 'home' | 'sign-in' | 'create';

function AuthFields({
  view,
  onDone,
}: {
  view: 'sign-in' | 'create';
  onDone: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (): Promise<void> => {
    setErrors({});
    try {
      if (view === 'create') await api.signup(email, password, displayName);
      else await api.login(email, password);
      onDone();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.body.fields !== undefined) setErrors(error.body.fields);
      else setErrors({ password: error.body.message });
    }
  };

  return (
    <div>
      <div className="form-row">
        <span className="label">Email</span>
        <input type="email" aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      {errors['email'] === undefined ? null : <p className="field-error">{errors['email']}</p>}
      <div className="form-row">
        <span className="label">Password</span>
        <input
          type="password"
          aria-label="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {errors['password'] === undefined ? null : <p className="field-error">{errors['password']}</p>}
      {view === 'create' ? (
        <>
          <div className="form-row">
            <span className="label">Display name</span>
            <input
              type="text"
              aria-label="Display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          {errors['display_name'] === undefined ? null : (
            <p className="field-error">{errors['display_name']}</p>
          )}
        </>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="row-button" onClick={() => void submit()}>
          {view === 'create' ? 'Create account' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}

export function PublicPage() {
  const [open, setOpen] = useState(true);
  const [view, setView] = useState<BoothView>('home');

  useEffect(() => {
    const demo = buildDemoSet();
    store.openDemo(demo.doc, demo.shaderSources);
  }, []);

  return (
    <Shell>
      {open ? (
        <Dialog title="Afterglass" plain onClose={() => setOpen(false)}>
          <Emblem />
          <h1>Afterglass</h1>
          <p className="body-line">Build the set in a browser. Play it on any screen in the room.</p>
          <div className="links">
            <a
              href="#sign-in"
              onClick={(event) => {
                event.preventDefault();
                setView('sign-in');
              }}
            >
              Sign in
            </a>
            <a
              href="#create-account"
              onClick={(event) => {
                event.preventDefault();
                setView('create');
              }}
            >
              Create account
            </a>
          </div>
          {view === 'home' ? null : (
            <AuthFields view={view} onDone={() => window.location.assign('/workspace')} />
          )}
          <div className="dialog-actions">
            <button type="button" className="row-button" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </Dialog>
      ) : null}
    </Shell>
  );
}

export function Workspace() {
  const state = useStoreState();
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [dialog, setDialog] = useState(false);
  const [name, setName] = useState('Tonight');

  useEffect(() => {
    void api
      .me()
      .then((result) => store.patch({ user: result.user }))
      .catch(() => window.location.assign('/'));
    void api.listSets().then((result) => setSets(result.sets));
  }, []);

  return (
    <div className="shell">
      <nav className="workbench" aria-label="Workbench">
        {WORKBENCH.map((tile) => (
          <button key={tile.label} type="button" aria-current={tile.label === 'Layers'}>
            {tile.icon}
            <span className="caption">{tile.label}</span>
          </button>
        ))}
      </nav>
      <div className="menubar">
        <div className="menubar-menus" role="menubar" aria-label="Set menu">
          <Menu label="Set" items={[{ label: 'New set', action: () => setDialog(true) }]} />
        </div>
        <div className="menubar-spacer" />
        {state.user === null ? null : (
          <Menu
            label={state.user.display_name}
            name="Account"
            items={[{ label: 'Sign out', action: () => void store.signOut() }]}
          />
        )}
      </div>
      <div className="centre">
        <div className="stage">
          <div className="empty-state">
            {sets.length === 0 ? (
              <>
                <span className="embossed" aria-hidden="true">
                  No sets yet
                </span>
                <p>No sets yet</p>
              </>
            ) : (
              <p>Choose a set in the rig panel</p>
            )}
            <button type="button" className="row-button" onClick={() => setDialog(true)}>
              New set
            </button>
          </div>
        </div>
      </div>
      <aside className="rig" aria-label="Rig panel">
        <div className="rig-title">
          <h3>Sets</h3>
        </div>
        <div className="rig-body">
          <div className="tree" role="tree" aria-label="Sets">
            {sets.map((entry) => (
              <div
                key={entry.id}
                className="tree-row"
                role="treeitem"
                aria-selected={false}
                tabIndex={0}
                onClick={() => window.location.assign(`/sets/${entry.id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') window.location.assign(`/sets/${entry.id}`);
                }}
              >
                <span className="grow">{entry.name}</span>
                <span className="kind">{entry.role}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>
      {dialog ? (
        <Dialog title="New set" onClose={() => setDialog(false)}>
          <div className="form-row">
            <span className="label">Set name</span>
            <input
              type="text"
              aria-label="Set name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <label className="checkrow">
            <input type="radio" name="starter" defaultChecked aria-label="Blank stage" />
            Blank stage
          </label>
          <div className="dialog-actions">
            <button
              type="button"
              className="row-button"
              onClick={() => {
                void api.createSet(name).then((document) => {
                  window.location.assign(`/sets/${document.set.id}`);
                });
              }}
            >
              Create set
            </button>
          </div>
        </Dialog>
      ) : null}
      <LiveRegions regions={state.regions} />
    </div>
  );
}

export function SetEditor({ setId }: { setId: string }) {
  useEffect(() => {
    void api
      .me()
      .then((result) => store.patch({ user: result.user }))
      .catch(() => window.location.assign('/'));
    void store.openSet(setId);
  }, [setId]);
  return <Shell />;
}

export function JoinPage({ token }: { token: string }) {
  const [invite, setInvite] = useState<{ set_name: string; role: Role; used: boolean } | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void api
      .getInvite(token)
      .then((result) => setInvite(result))
      .catch(() => setMessage('This invite link has already been used'));
    void api
      .me()
      .then(() => setSignedIn(true))
      .catch(() => setSignedIn(false));
  }, [token]);

  return (
    <div className="shell">
      <Dialog title={`Join ${invite?.set_name ?? 'this set'}`} plain onClose={() => window.location.assign('/')}>
        <Emblem />
        <h1>{`Join ${invite?.set_name ?? 'this set'}`}</h1>
        {message === '' ? null : <p className="field-error">{message}</p>}
        {signedIn === false ? (
          <>
            <p className="body-line">Sign in to join this set.</p>
            <AuthFields view="sign-in" onDone={() => setSignedIn(true)} />
          </>
        ) : null}
        {signedIn === true && invite !== null ? (
          <div className="dialog-actions">
            <button
              type="button"
              className="row-button"
              onClick={() => {
                void api
                  .acceptInvite(token)
                  .then((result) => window.location.assign(`/sets/${result.set_id}`))
                  .catch((error: unknown) => {
                    if (error instanceof ApiFailure && error.body.code === 'invite_used') {
                      setMessage('This invite link has already been used');
                    }
                  });
              }}
            >
              {`Join as ${invite.role}`}
            </button>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

export function ShowPage({ token }: { token: string }) {
  const state = useStoreState();
  const [info, setInfo] = useState(false);
  const [version, setVersion] = useState<{
    number: number;
    sha256: string;
    published_at: string;
    set_name: string;
  } | null>(null);
  const [nothing, setNothing] = useState(false);

  useEffect(() => {
    store.showChrome = false;
    const bus = new URLSearchParams(window.location.search).get('bus');
    store.bus = bus === 'side' ? 'side' : bus === 'led' ? 'led' : 'main';
    store.assetUrl = (assetId) => `/api/show/${token}/assets/${assetId}`;

    const load = async (): Promise<void> => {
      try {
        const info = await api.showInfo(token);
        setVersion({
          number: info.version.number,
          sha256: info.version.sha256,
          published_at: info.version.published_at,
          set_name: info.set_name,
        });
        setNothing(false);
        const response = await fetch(`/api/show/${token}/bundle`);
        if (!response.ok) return;
        const bundle = (await response.json()) as ShowBundle;
        store.openShowBundle(bundle);
        store.play();
      } catch {
        setNothing(true);
      }
    };
    void load();
    const stream = new EventSource(`/api/show/${token}/events`);
    stream.addEventListener('show', () => void load());
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === 'i') setInfo((open) => !open);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      stream.close();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [token]);

  return (
    <div className="show-page">
      <Stage chrome={false} />
      <button
        type="button"
        className="row-button show-info-button"
        onClick={() => setInfo(!info)}
        aria-expanded={info}
      >
        Show info
      </button>
      {nothing ? <div className="show-info">Nothing is live yet</div> : null}
      {info && version !== null ? (
        <div className="show-info" role="region" aria-label="Show info">
          <div>{version.set_name}</div>
          <div>{`Version ${version.number}`}</div>
          <div>{`SHA-256 ${version.sha256}`}</div>
          <div>{`Published ${version.published_at}`}</div>
        </div>
      ) : null}
      <LiveRegions regions={state.regions} />
    </div>
  );
}
