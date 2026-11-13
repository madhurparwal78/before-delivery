import { useEffect, useState } from 'react';
import { api, ApiFailure, type Account } from '../api';
import { useApp } from '../app';
import { Shell } from '../shell';

interface InviteState {
  patternName: string;
  hasAccount: boolean;
  status: 'sent' | 'accepted' | 'expired';
}

export function InviteScreen({ token }: { token: string }): JSX.Element {
  const { navigate, setAccount } = useApp();
  const [invite, setInvite] = useState<InviteState | null>(null);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [field, setField] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setInvite(await api.get<InviteState>(`/api/invites/${encodeURIComponent(token)}`));
      } catch {
        setMissing(true);
      }
    })();
  }, [token]);

  const join = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const joined = await api.post<{ patternId: string }>(
        `/api/invites/${encodeURIComponent(token)}/accept`,
        invite?.hasAccount ? { password } : { name, password },
      );
      setAccount(await api.get<Account>('/api/me'));
      navigate(`/follow/${joined.patternId}`, true);
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setError(failure.body.message ?? '');
        setField(failure.body.field ?? '');
        if (failure.body.error === 'invite_expired' || failure.body.error === 'invite_used') {
          setInvite((state) =>
            state
              ? { ...state, status: failure.body.error === 'invite_used' ? 'accepted' : 'expired' }
              : state,
          );
        }
      }
      setBusy(false);
    }
  };

  if (missing) {
    return (
      <Shell lead="This page is not here.">
        <h1>Not found.</h1>
      </Shell>
    );
  }
  if (!invite) return <Shell lead="Loading..." />;

  return (
    <Shell lead={`Join ${invite.patternName} as a tester.`}>
      {invite.status === 'expired' ? (
        <p>This invitation has expired. Ask the designer for a new one.</p>
      ) : invite.status === 'accepted' ? (
        <p>This invitation has already been used.</p>
      ) : (
        <form className="form" onSubmit={join}>
          {invite.hasAccount ? null : (
            <label className="field">
              <span>Name</span>
              <input
                aria-label="Name"
                value={name}
                aria-invalid={field === 'name' ? 'true' : undefined}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              aria-invalid={field === 'password' ? 'true' : undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <p role="alert" aria-label="Invite error" className="alert">
            {error}
          </p>
          <button type="submit" className="primary" disabled={busy} aria-busy={busy}>
            Join as tester
          </button>
        </form>
      )}
    </Shell>
  );
}
