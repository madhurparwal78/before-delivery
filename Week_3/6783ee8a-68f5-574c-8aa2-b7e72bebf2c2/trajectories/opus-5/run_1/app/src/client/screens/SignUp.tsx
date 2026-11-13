import { useEffect, useState } from 'react';
import { apiGet } from '../api.js';
import { useApp } from '../app.js';
import { WorkspaceHeader } from '../components/Header.js';
import { SignUpForm } from '../components/SignUpForm.js';

interface InvitationAnswer {
  email: string;
  role: 'editor' | 'viewer';
  notebook_title: string;
  owner_display_name: string;
  account_exists: boolean;
}

export function SignUp(): JSX.Element {
  const app = useApp();
  const token = new URLSearchParams(app.search).get('invitation');
  const [invitation, setInvitation] = useState<InvitationAnswer | null>(null);

  useEffect(() => {
    if (token === null) return;
    void apiGet<InvitationAnswer>(`/api/invitations/${encodeURIComponent(token)}`)
      .then(setInvitation)
      .catch(() => setInvitation(null));
  }, [token]);

  return (
    <div className="page">
      <WorkspaceHeader>
        <a
          className="header-link"
          href="/signin"
          onClick={(event) => {
            event.preventDefault();
            app.navigate('/signin');
          }}
        >
          Sign in
        </a>
      </WorkspaceHeader>
      <section className="band band-grey band-tall">
        <div className="container narrow">
          <div className="card form-card">
            <h1>Create your account</h1>
            {invitation ? (
              <p className="lead">{`Create an account to open “${invitation.notebook_title}”`}</p>
            ) : null}
            <SignUpForm
              invitation={token !== null && invitation ? { token, email: invitation.email } : null}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
