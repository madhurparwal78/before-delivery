import { useCallback, useEffect, useState } from 'react';
import { api, isFailure, type MemberRow, type OpsWorkspace, type ReviewResponse, type SeatsInfo } from '../api/client';
import { useSession, useAnnouncer } from '../api/session';
import { SubscriptionBanner } from '../shell';
import { PendingButton, GENERIC_ERROR } from '../components';
import { isoWeekOf } from '../../src-shared/domain';

export function WorkspaceScreen(): JSX.Element {
  const { me } = useSession();
  const { announce } = useAnnouncer();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [seats, setSeats] = useState<SeatsInfo>({ active: 0, billed: null });
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePending, setInvitePending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [week, setWeek] = useState<string>('');
  const [review, setReview] = useState<ReviewResponse | null>(null);

  const loadMembers = useCallback(async () => {
    try {
      const res = await api.get<{ members: MemberRow[]; seats: SeatsInfo }>('/api/workspace/members');
      setMembers(res.members);
      setSeats(res.seats);
    } catch {
      /* keep the last view */
    }
  }, []);

  const loadReview = useCallback(async (w: string) => {
    try {
      const res = await api.get<ReviewResponse>(`/api/workspace/review?week=${encodeURIComponent(w)}`);
      setReview(res);
      setWeek(res.week);
    } catch {
      /* keep the last view */
    }
  }, []);

  useEffect(() => {
    void loadMembers();
    const today = new Date().toISOString().slice(0, 10);
    void loadReview(isoWeekOf(today));
  }, [loadMembers, loadReview]);

  if (me === null || me.member.role !== 'owner') {
    return <main className="ops-page"><p>Only the owner can see this page.</p></main>;
  }

  const invite = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setInvitePending(true);
    setInviteError(null);
    try {
      const res = await api.post<{ email?: 'sent' | 'queued'; billing?: 'queued' }>('/api/workspace/invitations', { email: inviteEmail });
      if (res.billing === 'queued') {
        announce(`Invite saved. Billing is unreachable, so the seat and email will go through when it's back.`);
      } else if (res.email === 'queued') {
        announce(`Invite saved. Mail is unreachable, so the email to ${inviteEmail} is queued.`);
      } else {
        announce(`Invite sent to ${inviteEmail}.`);
      }
      setInviteEmail('');
      await loadMembers();
    } catch (err) {
      if (isFailure(err)) {
        if (err.code === 'already_member') setInviteError(`${inviteEmail} is already in this workspace.`);
        else if (err.code === 'email_taken') setInviteError(`${inviteEmail} already has a Daybook.`);
        else setInviteError(GENERIC_ERROR);
        announce(isFailure(err) && (err.code === 'already_member' || err.code === 'email_taken') ? err.message : GENERIC_ERROR);
      } else {
        setInviteError(GENERIC_ERROR);
        announce(GENERIC_ERROR);
      }
    } finally {
      setInvitePending(false);
    }
  };

  const removeMember = async (member: MemberRow): Promise<void> => {
    setRemoving(member.id);
    try {
      const res = await api.delete<{ seats: SeatsInfo }>(`/api/workspace/members/${member.id}`);
      setSeats(res.seats);
      const label = member.name.length > 0 ? member.name : member.email;
      announce(`Removed ${label}. Active seats: ${res.seats.active}.`);
      await loadMembers();
    } catch (err) {
      if (isFailure(err) && err.code === 'cannot_remove_owner') announce("The owner can't be removed.");
      else if (isFailure(err) && err.code === 'billing_unavailable')
        announce(`Billing is unreachable, so ${member.name || member.email} is still a member. Try again shortly.`);
      else announce(GENERIC_ERROR);
    } finally {
      setRemoving(null);
    }
  };

  const stepWeek = (delta: number): void => {
    const m = /^(\d{4})-W(\d{2})$/.exec(week);
    if (m === null) return;
    const year = Number(m[1]);
    const w = Number(m[2]) + delta;
    const next = `${year}-W${String(((w % 53) + 53) % 53 === 0 ? 53 : ((w % 53) + 53) % 53).padStart(2, '0')}`;
    void loadReview(next);
  };

  const mondayLabel = review !== null ? weekLabel(review.week) : '';

  return (
    <main className="ops-page">
      <SubscriptionBanner />
      <div className="workspace-section">
        <section aria-label="Seats" className="settings-section">
          <h2>Seats</h2>
          <p className="seats-line">Active seats: <span className="mono">{seats.active}</span></p>
          <form className="invite-form" aria-label="Invite a member" onSubmit={(e) => { void invite(e); }}>
            <div>
              <label htmlFor="invite-email">Email</label>
              <input id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
              {inviteError !== null ? <p className="field-error" id="invite-error">{inviteError}</p> : null}
            </div>
            <PendingButton type="submit" pending={invitePending} pendingLabel="Sending…" className="primary">Send invite</PendingButton>
          </form>
        </section>

        <section aria-label="Members" className="settings-section">
          <h2>Members</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td data-label="Name">{m.name}</td>
                    <td data-label="Email">{m.email}</td>
                    <td data-label="Role">{m.role === 'owner' ? 'Owner' : 'Member'}</td>
                    <td data-label="Status">
                      {m.status === 'active' ? 'Active' : m.status === 'invited' ? 'Invited' : 'Waiting for billing'}
                    </td>
                    <td data-label="Actions">
                      {m.role !== 'owner' ? (
                        <button type="button" disabled={removing !== null} onClick={() => { void removeMember(m); }} aria-label={`Remove ${m.name || m.email}`}>
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-label="Weekly review" className="settings-section">
          <h2 id="review-heading">Week of {mondayLabel}</h2>
          <p className="review-nav">
            <button type="button" onClick={() => stepWeek(-1)}>Previous week</button>
            <button type="button" onClick={() => stepWeek(1)}>Next week</button>
          </p>
          {review !== null ? (
            <div className="table-wrap">
              <table className="data" aria-labelledby="review-heading">
                <thead>
                  <tr>
                    <th scope="col">Member</th>
                    <th scope="col" className="num">Planned</th>
                    <th scope="col" className="num">Done</th>
                  </tr>
                </thead>
                <tbody>
                  {review.members.map((r) => (
                    <tr key={r.memberId}>
                      <td data-label="Member">{r.name}</td>
                      <td data-label="Planned" className="num">{r.plannedMinutes}m</td>
                      <td data-label="Done" className="num">{r.doneMinutes}m</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="num">{review.totals.plannedMinutes}m</td>
                    <td className="num">{review.totals.doneMinutes}m</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

const weekLabel = (week: string): string => {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (m === null) return week;
  const year = Number(m[1]);
  const w = Number(m[2]);
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const jan1Dow = jan1.getUTCDay() === 0 ? 7 : jan1.getUTCDay();
  const week1Mon = new Date(jan1.getTime() - (jan1Dow - 1) * 86_400_000);
  const monday = new Date(week1Mon.getTime() + (w - 1) * 7 * 86_400_000);
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(monday);
};

export function OperationsScreen(): JSX.Element {
  const { me } = useSession();
  const { announce } = useAnnouncer();
  const [workspaces, setWorkspaces] = useState<OpsWorkspace[]>([]);

  useEffect(() => {
    void api
      .get<{ workspaces: OpsWorkspace[] }>('/api/ops/workspaces')
      .then((res) => setWorkspaces(res.workspaces))
      .catch(() => setWorkspaces([]));
  }, [announce]);

  if (me === null || me.member.role !== 'operator') {
    return <main className="ops-page"><p>Only the operator can see this page.</p></main>;
  }

  return (
    <main className="ops-page">
      <div className="workspace-section">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Workspace</th>
                <th scope="col">State</th>
                <th scope="col">Trial ends</th>
                <th scope="col" className="num">Seats</th>
                <th scope="col" className="num">Queued</th>
                <th scope="col">Last import</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => (
                <tr key={w.id}>
                  <td data-label="Workspace">{w.name}</td>
                  <td data-label="State">{w.state}</td>
                  <td data-label="Trial ends" className="mono">{w.trialEndsAt.slice(0, 10)}</td>
                  <td data-label="Seats" className="num">
                    {w.activeSeats} / {w.billedSeats === null ? '—' : w.billedSeats}
                  </td>
                  <td data-label="Queued" className="num">{w.outbox.pending}</td>
                  <td data-label="Last import" className="mono">{w.imports.lastAt === null ? '—' : w.imports.lastAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
