import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Me } from '../shared/types.js';
import { COPY } from '../shared/copy.js';
import { fetchMe } from './api.js';
import { Editor } from './editor.jsx';
import { TesterPage } from './tester.jsx';
import { PublicPage } from './public.jsx';
import { PackPage } from './pack.jsx';

/** Routing: /, /signin, /app, /app/rooms/:id, /play/:token, /pack/:token. */
function App(): ReactNode {
  const [me, setMe] = useState<Me | null | 'loading'>('loading');
  const [path, setPath] = useState(window.location.pathname);

  const navigate = (p: string): void => {
    window.history.pushState(null, '', p);
    setPath(p);
  };

  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    void fetchMe().then((m) => setMe(m));
  }, []);

  const signin = window.location.pathname === '/signin';
  const appPath = path === '/app' || path.startsWith('/app/rooms/');
  const roomId = path.startsWith('/app/rooms/') ? path.split('/app/rooms/')[1] : null;
  const playToken = path.startsWith('/play/') ? path.split('/play/')[1] : null;
  const packToken = path.startsWith('/pack/') ? path.split('/pack/')[1] : null;

  if (me === 'loading') return null;

  if (playToken) return <TesterPage token={playToken} />;
  if (packToken) return <PackPage token={packToken} />;

  if (appPath) {
    if (!me) {
      window.location.replace('/signin');
      return null;
    }
    return <Editor me={me} roomId={roomId} navigate={navigate} />;
  }

  if (signin) {
    if (me) {
      window.location.replace('/app');
      return null;
    }
    return <SignInPage onSignedIn={() => navigate('/app')} />;
  }

  // the public page
  if (me) {
    window.location.replace('/app');
    return null;
  }
  return <PublicPage navigate={navigate} />;
}

function SignInPage(props: { onSignedIn: () => void }): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password }),
    });
    if (r.ok) {
      props.onSignedIn();
      return;
    }
    setStatus(COPY.badCredentials);
  };
  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--ground)' }}>
      <form
        aria-label="Sign in"
        className="sheet"
        style={{ width: 360 }}
        onSubmit={(e) => void submit(e)}
      >
        <div className="sheet-head">
          <h2>Keyway <span className="muted" style={{ fontWeight: 400 }}>bench</span></h2>
        </div>
        <div className="field">
          <label htmlFor="si-email">Email</label>
          <input id="si-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="si-pw">Password</label>
          <input id="si-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="cluster-btn primary" type="submit" style={{ width: '100%' }}>Sign in</button>
        {status && <p className="muted" role="status" aria-live="polite" style={{ marginTop: 10 }}>{status}</p>}
        <p className="muted" style={{ marginTop: 14, textAlign: 'center' }}>
          <a href="/">Back to the tour</a>
        </p>
      </form>
    </div>
  );
}

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
