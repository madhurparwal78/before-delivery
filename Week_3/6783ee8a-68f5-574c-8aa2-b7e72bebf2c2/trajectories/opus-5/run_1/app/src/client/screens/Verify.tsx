import { useEffect, useState } from 'react';
import type { User } from '../../shared/types.js';
import { apiSend } from '../api.js';
import { useApp } from '../app.js';
import { WorkspaceHeader } from '../components/Header.js';

export function Verify({ token }: { token: string }): JSX.Element {
  const app = useApp();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void apiSend<{ user: User }>('POST', '/api/auth/verify', { token })
      .then(() => setMessage('Email verified. You can sign in now.'))
      .catch(() => setMessage('This verification link is not valid.'));
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
            <h1>Email verification</h1>
            {message ? <p className="lead">{message}</p> : null}
            <a
              className="inline-link"
              href="/signin"
              onClick={(event) => {
                event.preventDefault();
                app.navigate('/signin');
              }}
            >
              Sign in
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
