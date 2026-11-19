import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, HttpError } from '../lib/api.js';

function AuthPane({ title, children, status }: { title: string; children: ReactNode; status: string }): ReactNode {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 16 }}>
      <section className="pane" aria-label={title} style={{ width: '100%', maxWidth: 400 }}>
        <div className="pane-title"><h2>{title}</h2></div>
        <div className="pane-body" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {children}
        </div>
        <div className="pane-status" role="status" aria-label="Account status">{status}</div>
      </section>
    </div>
  );
}

export function SignupPage({ onSignedUp }: { onSignedUp: () => void }): ReactNode {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <AuthPane title="Sign up" status={status}>
      <input type="text" aria-label="Display name" placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={{ padding: 8, border: '1px solid var(--divider)' }} />
      <input type="email" aria-label="Email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: 8, border: '1px solid var(--divider)' }} />
      <input type="password" aria-label="Password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ padding: 8, border: '1px solid var(--divider)' }} />
      <button
        className="btn primary"
        aria-busy={busy}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.signup(displayName, email, password);
            setStatus(`Check your inbox. We sent a confirmation link to ${email}.`);
            onSignedUp();
          } catch (e) {
            setStatus(e instanceof HttpError ? e.message : 'Sign-up failed.');
          } finally { setBusy(false); }
        }}
      >
        Create account
      </button>
      <a href="/signin">Sign in instead</a>
    </AuthPane>
  );
}

export function SigninPage({ onSignedIn }: { onSignedIn: () => void }): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <AuthPane title="Sign in" status={status}>
      <input type="email" aria-label="Email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: 8, border: '1px solid var(--divider)' }} />
      <input type="password" aria-label="Password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ padding: 8, border: '1px solid var(--divider)' }} />
      <button
        className="btn primary"
        aria-busy={busy}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.signin(email, password);
            onSignedIn();
            location.href = '/';
          } catch (e) {
            setStatus(e instanceof HttpError ? e.message : 'Sign-in failed.');
          } finally { setBusy(false); }
        }}
      >
        Sign in
      </button>
      <a href="/signup">Create an account</a>
    </AuthPane>
  );
}

export function VerifyPage({ token, onVerified }: { token: string; onVerified: () => void }): ReactNode {
  const [status, setStatus] = useState('');
  const tried = useRef(false);
  const attempt = useCallback(async () => {
    try {
      await api.verify(token);
      setStatus('Your account is confirmed. You can sign in now.');
      onVerified();
    } catch (e) {
      setStatus(e instanceof HttpError && e.status === 404
        ? 'This link is no longer valid.'
        : e instanceof HttpError ? e.message : 'Verification failed.');
    }
  }, [token, onVerified]);
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    void attempt();
  }, [attempt]);
  return <AuthPane title="Verify" status={status}><p style={{ margin: 0, fontSize: 13.5 }}>{status || 'Confirming…'}</p><a href="/signin">Go to sign in</a></AuthPane>;
}

export function InvitePage({ token, onJoined }: { token: string; onJoined: () => void }): ReactNode {
  const [info, setInfo] = useState<{ teamName: string; inviterName: string; email: string } | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(true);
  useEffect(() => {
    void api.inviteInfo(token).then((r) => setInfo(r.invite)).catch(() => setStatus('This link is no longer valid.'));
    void api.me().then(() => setSignedOut(false)).catch(() => setSignedOut(true));
  }, [token]);

  return (
    <AuthPane title={info ? `Join ${info.teamName}` : 'Join'} status={status}>
      {info ? (
        <>
          <p style={{ margin: 0, fontSize: 13.5 }}>
            {signedOut
              ? `Sign in or create an account with ${info.email} to join ${info.teamName}.`
              : `${info.inviterName} invites you to join ${info.teamName}.`}
          </p>
          <button
            className="btn primary"
            aria-busy={busy}
            disabled={busy}
            aria-label={`Join ${info.teamName}`}
            onClick={async () => {
              setBusy(true);
              try {
                await api.acceptInvite(token);
                setStatus(`You joined ${info.teamName}.`);
                onJoined();
              } catch (e) {
                setStatus(e instanceof HttpError ? e.message : 'Join failed.');
              } finally { setBusy(false); }
            }}
          >
            Join {info.teamName}
          </button>
          <a href="/">Go to the workbench</a>
        </>
      ) : (
        <p style={{ margin: 0, fontSize: 13.5 }}>{status || 'Loading invite…'}</p>
      )}
    </AuthPane>
  );
}
