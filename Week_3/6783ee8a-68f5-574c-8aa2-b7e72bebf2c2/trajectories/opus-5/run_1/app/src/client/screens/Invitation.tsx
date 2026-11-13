import { useEffect, useState } from 'react';
import { apiSend, apiGet } from '../api.js';
import { useApp } from '../app.js';
import { WorkspaceHeader } from '../components/Header.js';

interface InvitationAnswer {
  email: string;
  role: 'editor' | 'viewer';
  notebook_title: string;
  owner_display_name: string;
  account_exists: boolean;
}

export function Invitation({ token }: { token: string }): JSX.Element {
  const app = useApp();
  const [invitation, setInvitation] = useState<InvitationAnswer | null>(null);
  const [unknown, setUnknown] = useState(false);

  useEffect(() => {
    void apiGet<InvitationAnswer>(`/api/invitations/${encodeURIComponent(token)}`)
      .then(setInvitation)
      .catch(() => setUnknown(true));
  }, [token]);

  const open = async (): Promise<void> => {
    const accepted = await apiSend<{ notebook_id: string }>(
      'POST',
      `/api/invitations/${encodeURIComponent(token)}/accept`,
    );
    app.navigate(`/notebooks/${accepted.notebook_id}`);
  };

  const signOut = async (): Promise<void> => {
    await apiSend('POST', '/api/auth/signout');
    app.setUser(null);
  };

  const body = ((): JSX.Element => {
    if (unknown || invitation === null) {
      return <h1>{unknown ? 'This invitation is not valid.' : 'Invitation'}</h1>;
    }
    const roleWord = invitation.role === 'editor' ? 'Editor' : 'Viewer';
    const signedInAsInvited =
      app.user !== null && app.user.email.toLowerCase() === invitation.email.toLowerCase();

    if (signedInAsInvited) {
      return (
        <>
          <h1>{`${invitation.owner_display_name} shared “${invitation.notebook_title}” with you`}</h1>
          <p className="lead">{`Role: ${roleWord}`}</p>
          <button
            type="button"
            className="button-embossed"
            onClick={() => {
              void open();
            }}
          >
            Open notebook
          </button>
        </>
      );
    }
    if (app.user !== null) {
      return (
        <>
          <h1>This invitation is for another account.</h1>
          <button
            type="button"
            className="button-plain"
            onClick={() => {
              void signOut();
            }}
          >
            Sign out
          </button>
        </>
      );
    }
    if (invitation.account_exists) {
      return (
        <>
          <h1>{`Sign in as ${invitation.email} to open the shared notebook.`}</h1>
          <a
            className="inline-link"
            href="/signin"
            onClick={(event) => {
              event.preventDefault();
              window.sessionStorage.setItem('brackenpad.return_to', `/invite/${token}`);
              app.navigate('/signin');
            }}
          >
            Sign in
          </a>
        </>
      );
    }
    return (
      <>
        <h1>{`Create an account to open “${invitation.notebook_title}”`}</h1>
        <a
          className="inline-link"
          href={`/signup?invitation=${encodeURIComponent(token)}`}
          onClick={(event) => {
            event.preventDefault();
            app.navigate(`/signup?invitation=${encodeURIComponent(token)}`);
          }}
        >
          Create an account
        </a>
      </>
    );
  })();

  return (
    <div className="page">
      <WorkspaceHeader />
      <section className="band band-grey band-tall">
        <div className="container narrow">
          <div className="card form-card">{body}</div>
        </div>
      </section>
    </div>
  );
}
