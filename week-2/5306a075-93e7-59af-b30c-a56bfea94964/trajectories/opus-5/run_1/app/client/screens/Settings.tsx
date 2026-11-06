import { useCallback, useEffect, useState } from 'react';
import type { Objective, Role, ShareLink } from '../../shared/types';
import { ApiError, request } from '../api';
import { useApp } from '../app-state';
import { FieldError } from '../components/Dialog';
import { ROLE_LABELS } from '../labels';

const STATUS_WORDS: Record<ShareLink['status'], string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
};

export function Settings(): JSX.Element {
  const app = useApp();
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [weightError, setWeightError] = useState<string | undefined>(undefined);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('product_manager');
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [lifetime, setLifetime] = useState('');
  const [lifetimeError, setLifetimeError] = useState<string | undefined>(undefined);

  const loadLinks = useCallback(async () => {
    const data = await request<{ shareLinks: ShareLink[] }>('/api/roadmap/share-links');
    setShareLinks(data.shareLinks);
  }, []);

  useEffect(() => {
    void request<{ objectives: Objective[] }>('/api/objectives').then((data) => {
      setObjectives(data.objectives);
      setWeights(Object.fromEntries(data.objectives.map((objective) => [objective.id, objective.weight])));
    });
    void loadLinks();
  }, [loadLinks]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadLinks(), 30000);
    return () => window.clearInterval(timer);
  }, [loadLinks]);

  const saveWeights = async (): Promise<void> => {
    setWeightError(undefined);
    app.setPending('Saving weights…');
    try {
      for (const objective of objectives) {
        await request(`/api/objectives/${objective.id}`, {
          method: 'PATCH',
          body: { weight: weights[objective.id] },
        });
      }
      app.setSaveStatus('Weights saved. Priorities updated.');
    } catch (error) {
      app.setSaveStatus('');
      if (error instanceof ApiError) {
        setWeightError(error.fields.weight ?? error.message);
        app.setAlert(error.fields.weight ?? error.message);
      }
    }
  };

  const invite = async (): Promise<void> => {
    app.setPending('Sending invitation…');
    try {
      await request('/api/invitations', { method: 'POST', body: { email: inviteEmail, role: inviteRole } });
      app.setSaveStatus(`Invitation queued for ${inviteEmail}.`);
      setInviteEmail('');
    } catch (error) {
      app.setSaveStatus('');
      if (error instanceof ApiError) app.setAlert(error.message);
    }
  };

  const createLink = async (): Promise<void> => {
    setLifetimeError(undefined);
    const body: { expiresInSeconds?: number } = {};
    if (lifetime.trim() !== '') body.expiresInSeconds = Number(lifetime);
    try {
      await request('/api/roadmap/share-links', { method: 'POST', body });
      app.setSaveStatus('Share link created.');
      await loadLinks();
    } catch (error) {
      if (error instanceof ApiError) {
        const message = error.fields.expiresInSeconds ?? error.message;
        setLifetimeError(message);
        app.setAlert(message);
      }
    }
  };

  return (
    <main className="settings">
      <h1 className="display">Settings</h1>

      <section className="panel" role="region" aria-label="Objectives">
        <h2>Objectives</h2>
        {objectives.map((objective) => (
          <div className="field" key={objective.id}>
            <label htmlFor={`weight-${objective.id}`}>{objective.name} weight</label>
            <input
              id={`weight-${objective.id}`}
              type="number"
              min={0}
              max={100}
              step={1}
              aria-label={`${objective.name} weight`}
              aria-describedby="weights-error"
              value={weights[objective.id] ?? 0}
              onChange={(event) =>
                setWeights((current) => ({ ...current, [objective.id]: Number(event.target.value) }))
              }
            />
          </div>
        ))}
        <FieldError id="weights-error" message={weightError} />
        <button type="button" className="button accent" onClick={() => void saveWeights()}>
          Save weights
        </button>
      </section>

      <section className="panel" role="region" aria-label="Members">
        <h2>Members</h2>
        <div className="field">
          <label htmlFor="invite-email">Invite email</label>
          <input
            id="invite-email"
            type="email"
            aria-label="Invite email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="invite-role">Role</label>
          <select
            id="invite-role"
            aria-label="Role"
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value as Role)}
          >
            {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="button accent" onClick={() => void invite()}>
          Send invitation
        </button>
      </section>

      <section className="panel" role="region" aria-label="Share links">
        <h2>Share links</h2>
        <div className="field">
          <label htmlFor="link-lifetime">Link lifetime (seconds)</label>
          <input
            id="link-lifetime"
            type="number"
            min={30}
            max={31536000}
            step={1}
            aria-label="Link lifetime (seconds)"
            aria-describedby="lifetime-error"
            value={lifetime}
            onChange={(event) => setLifetime(event.target.value)}
          />
          <FieldError id="lifetime-error" message={lifetimeError} />
        </div>
        <button type="button" className="button accent" onClick={() => void createLink()}>
          Create share link
        </button>
        <ul aria-label="Share links" className="share-links">
          {shareLinks.map((link) => (
            <li key={link.id}>
              <span className="link-state">{STATUS_WORDS[link.status]}</span>
              <span className="link-url">{link.url}</span>
              <span className="link-dates">
                Created {link.createdAt}
                {link.expiresAt !== null ? ` · Expires ${link.expiresAt}` : ' · No expiry'}
                {link.revokedAt !== null ? ` · Revoked ${link.revokedAt}` : ''}
              </span>
              <button
                type="button"
                className="button quiet"
                onClick={() => {
                  void navigator.clipboard?.writeText(link.url).catch(() => undefined);
                  app.setSaveStatus('Link copied.');
                }}
              >
                Copy link
              </button>
              {link.status === 'revoked' ? null : (
                <>
                  <button
                    type="button"
                    className="button quiet"
                    onClick={() => {
                      void request(`/api/roadmap/share-links/${link.id}/regenerate`, { method: 'POST' })
                        .then(() => {
                          app.setSaveStatus('New link created. The old link no longer works.');
                          return loadLinks();
                        })
                        .catch((error: unknown) => {
                          if (error instanceof ApiError) app.setAlert(error.message);
                        });
                    }}
                  >
                    Regenerate
                  </button>
                  <button
                    type="button"
                    className="button quiet"
                    onClick={() => {
                      void request(`/api/roadmap/share-links/${link.id}`, { method: 'DELETE' })
                        .then(() => {
                          app.setSaveStatus('Link revoked. It no longer works.');
                          return loadLinks();
                        })
                        .catch(() => undefined);
                    }}
                  >
                    Revoke
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
