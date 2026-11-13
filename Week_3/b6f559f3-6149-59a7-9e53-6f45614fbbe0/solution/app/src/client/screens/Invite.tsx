import { useEffect, useState, type FormEvent } from 'react';
import '../styles/pages.css';
import { api, ApiError } from '../api';
import { joinHeading, MESSAGES } from '../../shared/messages';
import { navigate } from '../router';
import { useSession } from '../session';
import { WorkspaceFooter, WorkspaceHeader } from '../ui/Chrome';

interface InviteSummary {
  projectName: string;
  role: string;
  email: string;
  accountExists: boolean;
}

export function Invite({ token }: { token: string }) {
  const session = useSession();
  const [invite, setInvite] = useState<InviteSummary | null>(null);
  const [gone, setGone] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api
      .get<InviteSummary>(`/api/invites/${token}`)
      .then(setInvite)
      .catch((failure: unknown) => {
        if (failure instanceof ApiError && failure.status === 410) setGone(true);
        else throw failure;
      });
  }, [token]);

  const signedInAsInvited = session.status === 'in' && session.user?.email.toLowerCase() === invite?.email.toLowerCase();

  const accept = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending || !invite) return;
    setPending(true);
    setError(null);
    const body = signedInAsInvited ? {} : invite.accountExists ? { password } : { name, password };
    try {
      const result = await api.post<{ projectId: string }>(`/api/invites/${token}/accept`, body);
      await session.refresh();
      navigate(`/projects/${result.projectId}`);
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      if (failure.status === 410) setGone(true);
      else setError(failure.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <WorkspaceHeader />
      <main className="auth-page">
        {gone ? (
          <section className="panel auth-panel" aria-label="Invite">
            <p className="notice" role="alert">
              {MESSAGES.inviteGone}
            </p>
          </section>
        ) : invite ? (
          <form className="panel auth-panel" onSubmit={(event) => void accept(event)} noValidate>
            <h1>{joinHeading(invite.projectName, invite.role)}</h1>
            <p className="muted">This invite was sent to {invite.email}.</p>
            {!signedInAsInvited && !invite.accountExists && (
              <>
                <label className="field-label">
                  Your name
                  <input type="text" role="textbox" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="field-label">
                  Choose a password
                  <input type="password" role="textbox" name="new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
              </>
            )}
            {!signedInAsInvited && invite.accountExists && (
              <label className="field-label">
                Password
                <input type="password" role="textbox" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
            )}
            {error && (
              <p className="notice" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
              {pending ? MESSAGES.joining : 'Accept invite'}
            </button>
          </form>
        ) : (
          <section className="panel auth-panel skeleton-panel" aria-label="Loading invite" aria-busy="true" />
        )}
      </main>
      <WorkspaceFooter />
    </>
  );
}
