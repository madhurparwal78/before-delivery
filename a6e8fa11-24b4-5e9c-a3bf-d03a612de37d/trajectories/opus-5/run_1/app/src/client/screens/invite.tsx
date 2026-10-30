import { useEffect, useState } from 'react';
import { SessionUser } from '../../shared/api';
import { ApiFailure, api } from '../lib/api';
import { FieldError } from '../components/shell';

interface InviteProps {
  token: string;
  onAccepted: (user: SessionUser) => void;
}

export function InviteScreen({ token, onAccepted }: InviteProps): JSX.Element {
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ name: string; stationName: string } | null>(null);

  useEffect(() => {
    const read = async () => {
      try {
        const result = await api<{ invite: { name: string; stationName: string } }>(`/api/invites/${token}`);
        setInvited(result.invite);
      } catch {
        setFailure('This invite has already been used or does not exist.');
      }
    };
    void read();
  }, [token]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setFailure(null);
    try {
      const result = await api<{ user: SessionUser }>(`/api/invites/${token}/accept`, {
        method: 'POST',
        body: { password },
      });
      onAccepted(result.user);
    } catch (problem) {
      if (problem instanceof ApiFailure) {
        setFailure(
          problem.status === 404
            ? 'This invite has already been used or does not exist.'
            : problem.field('password') ?? 'Use at least 10 characters.',
        );
      }
      setPending(false);
    }
  };

  return (
    <main className="centre-screen">
      <form className="paper-card" onSubmit={submit}>
        <h1>{invited ? `Welcome, ${invited.name}` : 'Welcome to Furrowbook'}</h1>
        <p className="muted">
          {invited
            ? `Set a password to join ${invited.stationName} on Furrowbook.`
            : 'Set a password to join your station.'}
        </p>
        <label className="field">
          <span>New password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <FieldError text={failure} />
        <button type="submit" className="primary-button" disabled={pending}>
          {pending ? 'Saving…' : 'Accept invite'}
        </button>
      </form>
    </main>
  );
}
