import { useEffect, useState } from 'preact/hooks';
import { StudioLayout } from './StudioLayout';
import { api, ApiError } from '../api';
import { Dialog, Spinner } from '../components/ui';
import { useAuth } from '../store';
import { longDate } from '../format';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'member';
  joined_at: string;
}

interface Invitation {
  id: string;
  email: string;
  created_at: string;
}

interface TeamView {
  members: TeamMember[];
  invitations: Invitation[];
  seats_used: number;
  seat_limit: number;
}

function InviteDialog({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    setSending(true);
    setProblem('');
    try {
      await api('/api/team/invitations', { method: 'POST', body: { email } });
      onSent();
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        setProblem(error.status === 422 ? error.fieldErrors.email : error.code);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog title="Invite teammate" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div class="field">
          <label for="field-invite-email">Email</label>
          <input
            class="input"
            id="field-invite-email"
            name="invite_email"
            type="email"
            value={email}
            aria-invalid={problem ? 'true' : undefined}
            aria-describedby={problem ? 'field-invite-email-error' : undefined}
            onInput={(event) => setEmail((event.target as HTMLInputElement).value)}
          />
          {problem ? (
            <span class="field-error" id="field-invite-email-error" role="alert">
              {problem}
            </span>
          ) : null}
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-light" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="btn btn-accent" disabled={sending}>
            {sending ? <Spinner /> : null}
            Send invite
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RemoveDialog({
  member,
  onClose,
  onRemoved
}: {
  member: TeamMember;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [working, setWorking] = useState(false);
  return (
    <Dialog title="Remove member" onClose={onClose}>
      <p>
        Remove {member.name} from the workspace? Their generations and the credits they used stay in the history.
      </p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-light" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-danger-quiet"
          disabled={working}
          onClick={async () => {
            setWorking(true);
            await api(`/api/team/members/${member.id}`, { method: 'DELETE' }).catch(() => undefined);
            onRemoved();
            onClose();
          }}
        >
          {working ? <Spinner /> : null}
          Remove
        </button>
      </div>
    </Dialog>
  );
}

export function Team() {
  const auth = useAuth();
  const [team, setTeam] = useState<TeamView | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<TeamMember | null>(null);

  const reload = async () => setTeam(await api<TeamView>('/api/team'));

  useEffect(() => {
    if (auth.state === 'signed-in') void reload();
  }, [auth.state]);

  const isTeamPlan = auth.me?.workspace.plan === 'team';
  const isOwner = auth.me?.user.role === 'owner';

  return (
    <StudioLayout current="team">
      <h1 style="font-size:clamp(1.8rem,3vw,2.3rem)">Team</h1>

      {!isTeamPlan ? (
        <div class="panel-soft">
          <p>Teams share one credit balance. Team workspaces are set up by our sales team.</p>
          <a class="btn btn-light" href="/team-plan">
            About the Team plan
          </a>
        </div>
      ) : (
        <>
          <div class="studio-head">
            <p class="mono" style="margin:0">
              {team ? `${team.seats_used} of ${team.seat_limit} seats used` : ''}
            </p>
            {isOwner ? (
              <button type="button" class="btn btn-accent" onClick={() => setInviteOpen(true)}>
                Invite teammate
              </button>
            ) : null}
          </div>

          <div class="panel-soft table-wrap">
            <h2 style="font-size:1.1rem">Members</h2>
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Joined</th>
                  {isOwner ? <th scope="col">Manage</th> : null}
                </tr>
              </thead>
              <tbody>
                {team?.members.map((member) => (
                  <tr key={member.id}>
                    <td>{member.name}</td>
                    <td>{member.email}</td>
                    <td>{member.role === 'owner' ? 'Owner' : 'Member'}</td>
                    <td>{longDate(member.joined_at)}</td>
                    {isOwner ? (
                      <td>
                        {member.id === auth.me?.user.id ? null : (
                          <button type="button" class="btn btn-danger-quiet" onClick={() => setRemoving(member)}>
                            Remove
                          </button>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div class="panel-soft table-wrap" style="margin-top:20px">
            <h2 style="font-size:1.1rem">Pending invitations</h2>
            {team && team.invitations.length === 0 ? (
              <p class="muted" style="margin:0">
                No pending invitations.
              </p>
            ) : (
              <table class="table">
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Sent</th>
                    {isOwner ? <th scope="col">Manage</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {team?.invitations.map((invitation) => (
                    <tr key={invitation.id}>
                      <td>{invitation.email}</td>
                      <td>{longDate(invitation.created_at)}</td>
                      {isOwner ? (
                        <td>
                          <button
                            type="button"
                            class="btn btn-danger-quiet"
                            onClick={async () => {
                              await api(`/api/team/invitations/${invitation.id}`, { method: 'DELETE' }).catch(
                                () => undefined
                              );
                              void reload();
                            }}
                          >
                            Revoke
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {inviteOpen ? <InviteDialog onClose={() => setInviteOpen(false)} onSent={() => void reload()} /> : null}
      {removing ? (
        <RemoveDialog member={removing} onClose={() => setRemoving(null)} onRemoved={() => void reload()} />
      ) : null}
    </StudioLayout>
  );
}
