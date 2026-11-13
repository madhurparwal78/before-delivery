import { useEffect, useState } from 'react';
import { inviteScreenCopy, pageCopy } from '../../shared/copy.js';
import { ROLE_LABELS, type InviteRole, type InviteStatus } from '../../shared/states.js';
import { ApiFault, api } from '../api.js';
import { LiveRegions } from '../components/LiveRegions.jsx';
import { Toolbar, Wordmark } from '../components/Toolbar.jsx';
import { useSession } from '../session.js';

interface InviteView {
  workspaceName: string;
  email: string;
  role: InviteRole;
  status: InviteStatus;
  reason: 'owner' | 'superseded' | null;
  expiresAt: string;
}

export function Invite({ token }: { token: string }): JSX.Element {
  const { me, loading } = useSession();
  const [invite, setInvite] = useState<InviteView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void api<{ invite: InviteView }>(`/api/invites/${token}`, { allowUnauthenticated: true })
      .then((response) => {
        setInvite(response.invite);
        if (response.invite.status === 'expired') setProblem(inviteScreenCopy.expired);
        else if (response.invite.status === 'accepted') setProblem(inviteScreenCopy.used);
        else if (response.invite.status === 'revoked') setProblem(inviteScreenCopy.revoked);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFault && error.code === 'invite_superseded')
          setProblem(inviteScreenCopy.superseded);
        else setProblem(pageCopy.notFound);
      });
  }, [token]);

  const accept = async (): Promise<void> => {
    try {
      const response = await api<{ landing: string }>(`/api/invites/${token}/accept`, {
        method: 'POST',
        allowUnauthenticated: true,
      });
      window.location.assign(response.landing);
    } catch (error) {
      if (!(error instanceof ApiFault)) return;
      if (error.code === 'invite_email_mismatch' && invite)
        setProblem(inviteScreenCopy.mismatch(invite.email));
      else if (error.code === 'invite_superseded') setProblem(inviteScreenCopy.superseded);
      else if (error.code === 'invite_revoked') setProblem(inviteScreenCopy.revoked);
      else if (error.code === 'invite_expired') setProblem(inviteScreenCopy.expired);
      else if (error.code === 'invite_used') setProblem(inviteScreenCopy.used);
      else if (error.status === 401) window.location.assign(`/sign-in?invite=${token}`);
    }
  };

  const signedIn = me !== null;
  const mismatch =
    signedIn && invite
      ? me.user.email.trim().toLowerCase() !== invite.email.trim().toLowerCase()
      : false;

  return (
    <div className="screen">
      <Toolbar>
        <Wordmark />
      </Toolbar>
      <div className="screen-body">
        <div className="panel">
          <div className="panel-body">
            <h1>{invite ? `Join ${invite.workspaceName}` : pageCopy.loading}</h1>
            {invite ? (
              <p className="muted">
                {invite.email} · {ROLE_LABELS[invite.role]}
              </p>
            ) : null}
            {problem ? <p className="danger-text">{problem}</p> : null}
            {mismatch && invite && !problem ? (
              <p className="danger-text">{inviteScreenCopy.mismatch(invite.email)}</p>
            ) : null}
            {!loading && !signedIn ? (
              <p className="row">
                <a className="chip" href={`/sign-in?invite=${token}`}>
                  Sign in
                </a>
                <a className="chip" href={`/sign-up?invite=${token}`}>
                  Create account
                </a>
              </p>
            ) : null}
            {signedIn && invite && invite.status === 'pending' && !problem ? (
              <button type="button" className="chip on" onClick={() => void accept()}>
                Accept invite
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <LiveRegions />
    </div>
  );
}
