import { useEffect, useState } from 'react';
import type { Role, User } from '../../shared/types';
import { ApiError, request } from '../api';
import { useApp } from '../app-state';
import { FieldError } from '../components/Dialog';
import { Announcements } from '../components/Shell';
import { navigate, useRoute } from '../router';

const GONE_HEADINGS: Record<string, string> = {
  invitation_used: 'This invitation has already been used',
  invitation_expired: 'This invitation has expired',
  invitation_replaced: 'This invitation was replaced by a newer one',
};

export function Invite(): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const token = route.slice('/invite/'.length);
  const [invitation, setInvitation] = useState<{ email: string; role: Role; workspaceName: string } | null>(
    null,
  );
  const [heading, setHeading] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void request<{ email: string; role: Role; workspaceName: string }>(`/api/invitations/${token}`)
      .then(setInvitation)
      .catch((error: unknown) => {
        if (error instanceof ApiError) {
          setHeading(GONE_HEADINGS[error.code] ?? 'This invitation is not available');
        }
      });
  }, [token]);

  if (heading !== null) {
    return (
      <main className="invite">
        <h1 className="display">{heading}</h1>
      </main>
    );
  }

  return (
    <main className="invite">
      <Announcements />
      <h1 className="display">Join {invitation?.workspaceName ?? 'Evidence Desk'}</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setErrors({});
          setBusy(true);
          app.setPending('Joining…');
          void request<{ user: User }>(`/api/invitations/${token}/accept`, {
            method: 'POST',
            body: { name, password },
          })
            .then((data) => {
              app.signIn(data.user);
              navigate('/inbox');
            })
            .catch((error: unknown) => {
              app.setSaveStatus('');
              if (!(error instanceof ApiError)) return;
              if (error.status === 422) setErrors(error.fields);
              else setHeading(GONE_HEADINGS[error.code] ?? 'This invitation is not available');
            })
            .finally(() => setBusy(false));
        }}
      >
        <div className="field">
          <label htmlFor="invite-name">Your name</label>
          <input
            id="invite-name"
            type="text"
            aria-label="Your name"
            aria-describedby="invite-name-error"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <FieldError id="invite-name-error" message={errors.name} />
        </div>
        <div className="field">
          <label htmlFor="invite-password">Password</label>
          <input
            id="invite-password"
            type="password"
            aria-label="Password"
            aria-describedby="invite-password-error"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <FieldError id="invite-password-error" message={errors.password} />
        </div>
        <button type="submit" className="button accent" disabled={busy}>
          {busy ? 'Joining…' : 'Join workspace'}
        </button>
      </form>
    </main>
  );
}
