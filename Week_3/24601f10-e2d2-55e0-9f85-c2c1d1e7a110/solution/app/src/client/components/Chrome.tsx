import type { ReactNode } from 'react';
import { api } from '../api.js';
import { Bands } from '../notices.js';
import { Link, navigate } from '../router.js';
import { useSession } from '../session.js';

export function SignOut(): ReactNode {
  const { setUsername } = useSession();
  const signOut = async (): Promise<void> => {
    await api.post('/api/auth/signout');
    setUsername(null);
    navigate('/');
  };
  return <button type="button" className="btn btn-quiet" onClick={() => void signOut()}>Sign out</button>;
}

function Header(): ReactNode {
  const { ready, username } = useSession();
  return (
    <header className="topbar">
      <Link to="/" className="topbar-mark">Cupfold</Link>
      <nav className="topbar-nav">
        {!ready ? null : username ? (
          <>
            <Link to="/t" className="navlink">Your tournaments</Link>
            <Link to={`/u/${username}`} className="navlink">{username}</Link>
            <SignOut />
          </>
        ) : (
          <>
            <Link to="/signin" className="navlink">Sign in</Link>
            <Link to="/signup" className="navlink">Create account</Link>
          </>
        )}
      </nav>
    </header>
  );
}

// Every page carries the notice and error bands; working pages also carry the top bar.
// Until the session answers, the top bar is unsettled (its links, and so its height, depend on who is signed in), so the
// page below it stays unpainted rather than shifting when the links arrive.
export function Chrome({ children, bare = false }: { children: ReactNode; bare?: boolean }): ReactNode {
  const { ready } = useSession();
  return (
    <div className="app">
      <Bands />
      {bare ? null : <Header />}
      <main className={ready || bare ? 'page' : 'page page-unsettled'}>{children}</main>
    </div>
  );
}

export function EmptyState({ object, text }: { object: ReactNode; text: string }): ReactNode {
  return (
    <div className="empty">
      <div className="empty-object" aria-hidden="true">{object}</div>
      <p>{text}</p>
    </div>
  );
}
