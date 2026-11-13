import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { Link } from '../lib/router.js';
import { useStore } from '../lib/store.js';
import { useIsPhone } from '../lib/hooks.js';
import { Dialog, ErrorSummary } from './Dialog.js';
import { signedInNotice } from '../../shared/copy.js';
import type { User } from '../../shared/types.js';

const NAV_LINKS: { to: string; label: string }[] = [
  { to: '/', label: 'Chapters' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/sources', label: 'Sources' },
  { to: '/sessions', label: 'Sessions' },
  { to: '/support', label: 'Support' },
];

function MainNavigation({ onNavigate }: { onNavigate?: () => void }): JSX.Element {
  return (
    <nav aria-label="Main">
      <ul>
        {NAV_LINKS.map((link) => (
          <li key={link.to}>
            <Link to={link.to} onNavigate={onNavigate}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SignInDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { signedIn, announce, setServiceNotice } = useStore();
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function submit(): Promise<void> {
    setPending(true);
    setMessage(null);
    setFields({});
    try {
      const result = registering
        ? await api<{ user: User }>('/api/auth/register', { method: 'POST', body: { name, email, password } })
        : await api<{ user: User }>('/api/auth/login', { method: 'POST', body: { email, password } });
      signedIn(result.user);
      announce(signedInNotice(result.user.name));
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        setMessage(error.message);
        setFields(error.fields);
        if (error.code === 'accounts_unavailable') setServiceNotice(error.message);
        if (error.code === 'email_taken') setFields({ email: error.message });
      }
      setPending(false);
    }
  }

  return (
    <Dialog title={registering ? 'Create an account' : 'Sign in'} onClose={onClose}>
      <ErrorSummary
        message={message}
        fields={fields}
        fieldIds={{ name: 'auth-name', email: 'auth-email', password: 'auth-password' }}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {registering ? (
          <div className="field">
            <label htmlFor="auth-name">Name</label>
            <input
              id="auth-name"
              type="text"
              aria-label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {fields.name ? <span className="field-error">{fields.name}</span> : null}
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            type="text"
            aria-label="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {fields.email ? <span className="field-error">{fields.email}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            type="password"
            aria-label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {fields.password ? <span className="field-error">{fields.password}</span> : null}
        </div>
        <div className="inline-actions">
          {registering ? (
            <button type="submit" disabled={pending}>
              Create account
            </button>
          ) : (
            <>
              <button type="submit" disabled={pending}>
                Sign in
              </button>
              <button type="button" onClick={() => setRegistering(true)}>
                Create an account
              </button>
            </>
          )}
        </div>
      </form>
    </Dialog>
  );
}

export function Header({ onOpenPlan }: { onOpenPlan: () => void }): JSX.Element {
  const { user, preferences, setPreference, signedOut } = useStore();
  const isPhone = useIsPhone();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);

  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand">
          Halden Reading Room
        </Link>
        {isPhone ? (
          <button type="button" onClick={() => setMenuOpen(true)}>
            Menu
          </button>
        ) : (
          <MainNavigation />
        )}
        <div className="header-tools">
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="Motion"
              aria-checked={preferences.motion}
              checked={preferences.motion}
              onChange={(event) => setPreference({ motion: event.target.checked })}
            />
            Motion
          </label>
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="Sound"
              aria-checked={preferences.sound}
              checked={preferences.sound}
              onChange={(event) => setPreference({ sound: event.target.checked })}
            />
            Sound
          </label>
          <button type="button" onClick={onOpenPlan}>
            Support
          </button>
          {user ? (
            <>
              <span className="secondary">{user.name}</span>
              <Link to="/account">Account</Link>
              <button
                type="button"
                onClick={() => {
                  void api('/api/auth/logout', { method: 'POST' }).then(() => signedOut());
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setSignInOpen(true)}>
              Sign in
            </button>
          )}
        </div>
      </header>
      {menuOpen ? (
        <Dialog title="Menu" variant="bottom-sheet" onClose={() => setMenuOpen(false)}>
          <MainNavigation onNavigate={() => setMenuOpen(false)} />
        </Dialog>
      ) : null}
      {signInOpen ? <SignInDialog onClose={() => setSignInOpen(false)} /> : null}
    </>
  );
}
