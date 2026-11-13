import { useEffect, useState } from 'react';
import { api, type SessionUser } from './api.js';
import type { JSX } from 'react';

interface InvitePageProps {
  token: string;
  me: SessionUser | null;
  navigate: (path: string) => void;
}

interface InviteInfo {
  board_title: string;
  inviter_name: string;
  role: string;
  expired: boolean;
}

export function InvitePage({ token, me, navigate }: InvitePageProps): JSX.Element {
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    api<InviteInfo>(`/api/invites/${token}`)
      .then(setInvite)
      .catch(() => setMissing(true));
  }, [token]);

  if (missing) {
    return (
      <main className="not-found">
        <h1>Board not found</h1>
        <p>This board doesn't exist, or you don't have access to it.</p>
        <p>
          <a href="/">Go home</a>
        </p>
      </main>
    );
  }
  if (!invite) return <p className="empty-line">Loading…</p>;

  const join = async () => {
    const r = await api<{ board_id: string; role: string }>(`/api/invites/${token}/accept`, { method: 'POST' });
    navigate(`/b/${r.board_id}`);
  };

  return (
    <main className="auth-page">
      {invite.expired ? (
        <>
          <h1>This invite has expired.</h1>
          <p>
            <a href="/">Go home</a>
          </p>
        </>
      ) : (
        <>
          <h1>{invite.board_title}</h1>
          <p className="hint">
            {invite.inviter_name} invited you as a {invite.role}.
          </p>
          {me ? (
            <button className="btn" name="Join board" onClick={() => void join()}>
              Join board
            </button>
          ) : (
            <div className="row">
              <a className="btn" href={`/signin?then=/invite/${token}`}>
                Sign in
              </a>
              <a className="btn secondary" href={`/signup?then=/invite/${token}`}>
                Create account
              </a>
            </div>
          )}
        </>
      )}
    </main>
  );
}
