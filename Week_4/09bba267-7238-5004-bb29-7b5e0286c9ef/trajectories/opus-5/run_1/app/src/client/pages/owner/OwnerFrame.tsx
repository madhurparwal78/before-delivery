import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { COPY } from '../../../shared/copy';
import { api } from '../../lib/api';
import { useAnnouncer } from '../../lib/announce';
import { Link, useRouter } from '../../lib/router';

function SignInForm({ onSignedIn }: { readonly onSignedIn: () => void }): ReactNode {
  const { announce } = useAnnouncer();
  const [passcode, setPasscode] = useState('');
  const [working, setWorking] = useState(false);
  return (
    <section className="owner">
      <h1>Box office</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setWorking(true);
          void api.ownerSignIn(passcode).then((result) => {
            setWorking(false);
            if (result.status === 204) onSignedIn();
            else announce(COPY.ownerSignInFailed);
          });
        }}
      >
        <div className="field">
          <label htmlFor="owner-passcode">Passcode</label>
          <input
            id="owner-passcode"
            type="password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
          />
        </div>
        <button type="submit" className="primary" disabled={working}>
          Sign in
        </button>
      </form>
    </section>
  );
}

function OwnerNav(): ReactNode {
  const { go } = useRouter();
  return (
    <nav className="owner-nav" aria-label="Owner">
      <Link to="/owner" className="action-link">
        All performances
      </Link>
      <Link to="/owner/new" className="action-link">
        Publish performance
      </Link>
      <Link to="/owner/orders" className="action-link">
        Orders
      </Link>
      <Link to="/owner/outbox" className="action-link">
        Outbox
      </Link>
      <button
        type="button"
        onClick={() => {
          void api.ownerSignOut().then(() => go('/owner'));
        }}
      >
        Sign out
      </button>
    </nav>
  );
}

/** Owner pages need the owner session; without it they show the sign-in form. */
export function OwnerFrame({
  children,
  load,
}: {
  readonly children: ReactNode;
  readonly load: () => Promise<number>;
}): ReactNode {
  const [state, setState] = useState<'checking' | 'signed-out' | 'signed-in'>('checking');
  const loader = useRef(load);
  loader.current = load;

  const check = useCallback(async () => {
    const status = await loader.current();
    setState(status === 401 ? 'signed-out' : 'signed-in');
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (state === 'checking') return <section className="owner" />;
  if (state === 'signed-out') {
    return (
      <SignInForm
        onSignedIn={() => {
          void check();
        }}
      />
    );
  }
  return (
    <section className="owner">
      <OwnerNav />
      {children}
    </section>
  );
}
