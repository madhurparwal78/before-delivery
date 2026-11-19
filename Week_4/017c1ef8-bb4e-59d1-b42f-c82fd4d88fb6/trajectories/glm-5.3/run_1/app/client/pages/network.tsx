import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../app-context.js';
import { announce } from '../main.js';
import type { PersonCard } from '../types.js';
import { degreeLabel } from '../format.js';
import { Dialog } from '../dialog.js';
import { useNavigationCounts } from '../chrome/counts.js';

export const NetworkPage = (): JSX.Element => {
  const { navigate, liveEvents, config } = useApp();
  const [data, setData] = useState<{ received: PersonCard[]; sent: PersonCard[]; connections: PersonCard[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  useNavigationCounts();

  const load = useCallback(async (): Promise<void> => {
    const result = await api.get<{ received: PersonCard[]; sent: PersonCard[]; connections: PersonCard[] }>('/api/network');
    setData(result);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    return liveEvents.subscribe((event) => {
      if (event === 'connection' || event === 'blocked' || event === 'blocked_by' || event === 'clock') void load();
    });
  }, [liveEvents, load]);

  const accept = async (member: PersonCard): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/api/connections/${member.id}/accept`, {});
      announce('Network announcements', `You are now connected with ${member.name}.`);
      await load();
      focusNextInvite(member.id);
    } catch {
      announce('Network announcements', 'Invitation not sent.');
    } finally {
      setBusy(false);
    }
  };

  const ignore = async (member: PersonCard): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/api/connections/${member.id}/ignore`, {});
      announce('Network announcements', 'Invitation ignored.');
      await load();
      focusNextInvite(member.id);
    } finally {
      setBusy(false);
    }
  };

  const focusNextInvite = (leavingId: string): void => {
    const remaining = (data?.received ?? []).filter((r) => r.id !== leavingId);
    requestAnimationFrame(() => {
      const nodes = document.querySelectorAll<HTMLButtonElement>('[data-invitation-id] button');
      const next = remaining[0];
      const target = next ? document.querySelector(`[data-invitation-id="${next.id}"] button`) : document.querySelector('h2[aria-level="2"]');
      (target as HTMLElement | null)?.focus();
      void nodes;
    });
  };

  const withdrawBatch = async (): Promise<void> => {
    if (busy || selected.size === 0) return;
    setBusy(true);
    setAlert(null);
    try {
      await api.post('/api/invitations/withdraw', { member_ids: [...selected] });
      announce('Network announcements', `Withdrew ${selected.size} invitation${selected.size === 1 ? '' : 's'}.`);
      setSelected(new Set());
      setConfirmOpen(false);
      await load();
      requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>('[data-grid-cell]');
        first?.focus();
      });
    } catch (err) {
      const e2 = err as { body?: { error?: string; member_id?: string } };
      setConfirmOpen(false);
      if (e2.body?.error === 'not_pending' && e2.body?.member_id) {
        const member = (data?.sent ?? []).find((m) => m.id === e2.body?.member_id);
        setAlert(`${member?.name ?? 'That member'}'s invitation is no longer pending. Nothing was withdrawn.`);
      } else {
        setAlert('Something went wrong. Try again.');
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const sent = data?.sent ?? [];
  const tz = config?.time_zone ?? 'UTC';

  return (
    <>
      {alert && <div role="alert">{alert}</div>}
      <section aria-label="Invitations">
        <h2 aria-level={2}>Invitations</h2>
        {(data?.received ?? []).length === 0 ? (
          <p className="big-empty"><span>No pending invitations.</span></p>
        ) : (
          <ul aria-label="Invitations">
            {(data?.received ?? []).map((member) => (
              <li key={member.id} className="person-card" data-member-id={member.id} data-degree={member.degree}
                data-connection-state={member.connection_state} data-invitation-id={member.id}>
                <a href={`/in/${member.handle}`} onClick={(e) => { e.preventDefault(); navigate(`/in/${member.handle}`); }}>{member.name}</a>
                <p className="entry-headline">{member.headline}</p>
                <span className="degree-label-badge" data-degree-badge data-degree={member.degree}>{degreeLabel(member.degree)}</span>
                <div className="entry-actions">
                  <button type="button" className="pink-button" onClick={() => { void accept(member); }} disabled={busy}>Accept {member.name}</button>
                  <button type="button" className="text-button" onClick={() => { void ignore(member); }} disabled={busy}>Ignore {member.name}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Sent invitations">
        <h2 aria-level={2}>Sent invitations</h2>
        {sent.length === 0 ? (
          <p>No pending invitations.</p>
        ) : (
          <>
            <button
              type="button"
              className="pink-button"
              disabled={selected.size === 0 || busy}
              onClick={() => setConfirmOpen(true)}
            >
              Withdraw selected ({selected.size})
            </button>
            <div role="grid" aria-label="Sent invitations">
              <div role="row">
                <span role="columnheader">Name</span>
                <span role="columnheader">Headline</span>
                <span role="columnheader">Sent</span>
                <span role="columnheader">Action</span>
              </div>
              {sent.map((member) => {
                const sentAt = member.requested_at
                  ? new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(member.requested_at))
                  : '';
                return (
                  <div
                    key={member.id}
                    role="row"
                    data-member-id={member.id}
                    aria-selected={selected.has(member.id)}
                    onKeyDown={(e) => {
                      if (e.key === ' ') { e.preventDefault(); toggle(member.id); }
                    }}
                  >
                    <span role="gridcell" tabIndex={0} data-grid-cell onClick={() => toggle(member.id)}>{member.name}</span>
                    <span role="gridcell">{member.headline}</span>
                    <span role="gridcell">{sentAt}</span>
                    <span role="gridcell">
                      <button type="button" className="text-button" onClick={() => {
                        void (async () => {
                          setBusy(true);
                          try {
                            await api.post(`/api/connections/${member.id}/withdraw`, {});
                            announce('Network announcements', 'Invitation withdrawn.');
                            await load();
                          } finally { setBusy(false); }
                        })();
                      }} disabled={busy}>Withdraw request to {member.name}</button>
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section aria-label="Connections">
        <h2 aria-level={2}>Connections</h2>
        <ul aria-label="Connections">
          {(data?.connections ?? []).map((member) => (
            <li key={member.id} className="person-card" data-member-id={member.id} data-degree={member.degree} data-connection-state={member.connection_state}>
              <a href={`/in/${member.handle}`} onClick={(e) => { e.preventDefault(); navigate(`/in/${member.handle}`); }}>{member.name}</a>
              <p className="entry-headline">{member.headline}</p>
              <span className="degree-label-badge" data-degree-badge data-degree={member.degree}>{degreeLabel(member.degree)}</span>
              <div className="entry-actions">
                <button type="button" className="text-button" onClick={() => navigate(`/messaging/with/${member.handle}`)}>
                  Message {member.name}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {confirmOpen && (
        <Dialog label={`Withdraw ${selected.size} invitation${selected.size === 1 ? '' : 's'}?`} onClose={() => setConfirmOpen(false)} closeButton={false}>
          <h2>Withdraw {selected.size} invitation{selected.size === 1 ? '' : 's'}?</h2>
          <div className="dialog-actions">
            <button type="button" className="pink-button" onClick={() => { void withdrawBatch(); }}>Withdraw</button>
            <button type="button" className="text-button" onClick={() => setConfirmOpen(false)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </>
  );

  function toggle(memberId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }
};
