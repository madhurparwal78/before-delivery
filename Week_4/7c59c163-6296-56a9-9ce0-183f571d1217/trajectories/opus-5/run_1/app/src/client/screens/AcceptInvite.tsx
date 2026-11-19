import { useEffect, useState } from 'react';
import { COPY } from '../copy.js';
import { RequestFailed, get, post } from '../api.js';
import { Sticker } from '../components/Stickers.js';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; email: string; venueName: string }
  | { kind: 'expired' }
  | { kind: 'unknown' }
  | { kind: 'accepted'; email: string };

export function AcceptInvite(props: { token: string }): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void get<{ email: string; venue_name: string }>(`/api/invites/${props.token}`)
      .then((value) => setState({ kind: 'ready', email: value.email, venueName: value.venue_name }))
      .catch((error: unknown) => {
        if (error instanceof RequestFailed && error.code === 'invite_expired') {
          setState({ kind: 'expired' });
          return;
        }
        setState({ kind: 'unknown' });
      });
  }, [props.token]);

  const accept = async (): Promise<void> => {
    setMessage('');
    try {
      const result = await post<{ email: string }>(`/api/invites/${props.token}/accept`, { password });
      setState({ kind: 'accepted', email: result.email });
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.code === 'invite_expired') setState({ kind: 'expired' });
      else if (error.code === 'identity_unavailable') setMessage(COPY.identityUnavailable);
      else setMessage('Choose a password of 12 to 128 characters.');
    }
  };

  if (state.kind === 'loading') {
    return (
      <main className="field field--slate">
        <div className="wrap">
          <div className="skeleton" />
        </div>
      </main>
    );
  }

  if (state.kind === 'unknown') {
    return (
      <main className="field field--slate centre-page">
        <h1>{COPY.notFoundHeading}</h1>
        <Sticker kind="cube" size={150} className="hero__sticker hero__sticker--right" />
      </main>
    );
  }

  if (state.kind === 'expired') {
    return (
      <main className="field field--slate centre-page">
        <h1>{COPY.inviteExpired}</h1>
        <Sticker kind="envelope" size={150} className="hero__sticker hero__sticker--right" />
      </main>
    );
  }

  if (state.kind === 'accepted') {
    return (
      <main className="field field--slate centre-page">
        <h1>Invite accepted</h1>
        <p>You can sign in as {state.email}.</p>
        <a className="pill" href="/auth/login">
          Sign in
        </a>
      </main>
    );
  }

  return (
    <main className="field field--slate centre-page">
      <div className="card" style={{ maxWidth: 480, textAlign: 'left' }}>
        <h1>Accept invite</h1>
        <p>
          {state.email} · {state.venueName}
        </p>
        <form
          aria-label="Accept invite"
          onSubmit={(event) => {
            event.preventDefault();
            void accept();
          }}
        >
          <div className="form-row">
            <label htmlFor="invite-password">Choose a password</label>
            <input
              id="invite-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {message !== '' ? <p className="banner">{message}</p> : null}
          <button type="submit" className="pill">
            Accept invite
          </button>
        </form>
      </div>
    </main>
  );
}
