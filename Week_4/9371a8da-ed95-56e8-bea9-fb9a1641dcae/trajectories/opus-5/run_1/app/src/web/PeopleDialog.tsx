import { useEffect, useRef, useState } from 'react';
import { api, ApiFailure } from './api.js';
import { Dialog } from './components/Dialog.js';
import { copy } from './copy.js';
import { DialogContext } from './ProjectDialogs.js';
import { Invite, Member, ProjectRole, ShareLink, User } from './types.js';

interface Props {
  context: DialogContext;
  role: ProjectRole;
  onClose: () => void;
  returnFocusTo: () => HTMLElement | null;
}

function emailOf(member: Member): string | null {
  const user = member.user as User;
  return typeof user.email === 'string' ? user.email : null;
}

export function PeopleDialog(props: Props): JSX.Element {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [shareLink, setShareLink] = useState<ShareLink | null>(null);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('reviewer');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [invitePending, setInvitePending] = useState(false);
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const roleAnswers = useRef(0);
  const isOwner = props.role === 'owner';

  const load = async (): Promise<void> => {
    const at = roleAnswers.current;
    const memberAnswer = await api<{ members: Member[] }>(
      `/api/projects/${props.context.projectId}/members`,
    );
    if (roleAnswers.current !== at) return;
    setMembers(memberAnswer.members);
    if (!isOwner) return;
    const [inviteAnswer, share] = await Promise.all([
      api<{ invites: Invite[] }>(`/api/projects/${props.context.projectId}/invites`),
      api<{ shareLink: ShareLink | null }>(
        `/api/projects/${props.context.projectId}/share-link`,
      ),
    ]);
    if (roleAnswers.current !== at) return;
    setInvites(inviteAnswer.invites);
    setShareLink(share.shareLink);
  };

  useEffect(() => {
    void load().catch(() => undefined);
    const timer = window.setInterval(() => void load().catch(() => undefined), 5_000);
    return () => window.clearInterval(timer);
  }, [props.role]);

  const sendInvite = async (): Promise<void> => {
    setInvitePending(true);
    setEmailError(null);
    props.context.notify(copy.invitePending);
    try {
      await api(`/api/projects/${props.context.projectId}/invites`, {
        method: 'POST',
        body: { email, role: inviteRole },
      });
      props.context.notify(copy.inviteSent(email));
      setEmail('');
      await load();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        if (failure.code === 'mail_unavailable') props.context.notify(copy.inviteMailDown);
        else if (failure.code === 'rate_limited') {
          const seconds = Number(failure.body.retryAfterSeconds ?? 60);
          props.context.notify(copy.inviteRateLimited(Math.ceil(seconds / 60)));
        } else if (failure.code === 'already_member') {
          props.context.notify(copy.inviteAlreadyMember(email));
        } else if (failure.code === 'invite_pending') {
          props.context.notify(copy.inviteAlreadyPending(email));
        } else if (failure.status === 403) {
          props.context.forbidden();
          props.onClose();
          return;
        } else if (failure.field('email') !== null) {
          setEmailError(copy.fields.email);
          props.context.notify('');
        } else {
          props.context.notify(copy.somethingWrong);
        }
      } else {
        props.context.notify(copy.somethingWrong);
      }
    } finally {
      setInvitePending(false);
    }
  };

  const revoke = async (invite: Invite): Promise<void> => {
    try {
      await api(`/api/projects/${props.context.projectId}/invites/${invite.id}/revoke`, {
        method: 'POST',
        body: {},
      });
      props.context.notify(copy.inviteRevoked(invite.email));
      await load();
    } catch {
      props.context.notify(copy.somethingWrong);
    }
  };

  const changeRole = async (member: Member, role: string): Promise<void> => {
    const person = member.user;
    setBusyRole(person.id ?? null);
    try {
      const answer = await api<{ member: Member }>(
        `/api/projects/${props.context.projectId}/members/${person.id}`,
        { method: 'PATCH', body: { role } },
      );
      roleAnswers.current += 1;
      setMembers((previous) =>
        previous.map((row) => (row.user.id === person.id ? answer.member : row)),
      );
      props.context.notify(copy.memberRole(person.displayName, answer.member.role));
      props.context.afterAction();
    } catch (failure) {
      roleAnswers.current += 1;
      if (failure instanceof ApiFailure && failure.code === 'last_owner') {
        props.context.notify(copy.lastOwner);
      } else if (failure instanceof ApiFailure && failure.status === 403) {
        props.context.forbidden();
      } else {
        props.context.notify(copy.somethingWrong);
      }
      await load().catch(() => undefined);
    } finally {
      setBusyRole(null);
    }
  };

  const removeMember = async (member: Member): Promise<void> => {
    try {
      await api(`/api/projects/${props.context.projectId}/members/${member.user.id}`, {
        method: 'DELETE',
      });
      roleAnswers.current += 1;
      props.context.notify(copy.memberRemoved(member.user.displayName));
      await load();
      props.context.afterAction();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'last_owner') {
        props.context.notify(copy.lastOwner);
      } else {
        props.context.notify(copy.somethingWrong);
      }
      await load().catch(() => undefined);
    }
  };

  const writeShareLink = async (): Promise<void> => {
    const existed = shareLink !== null;
    try {
      const answer = await api<{ shareLink: ShareLink }>(
        `/api/projects/${props.context.projectId}/share-link`,
        { method: 'POST', body: {} },
      );
      setShareLink(answer.shareLink);
      props.context.notify(existed ? copy.shareRegenerated : copy.shareCreated);
    } catch {
      props.context.notify(copy.somethingWrong);
    }
  };

  const revokeShareLink = async (): Promise<void> => {
    try {
      await api(`/api/projects/${props.context.projectId}/share-link`, { method: 'DELETE' });
      setShareLink(null);
      props.context.notify(copy.shareRevoked);
    } catch {
      props.context.notify(copy.somethingWrong);
    }
  };

  return (
    <Dialog
      name="People and sharing"
      onClose={props.onClose}
      returnFocusTo={props.returnFocusTo}
      className="dialog-tall"
    >
      <h2>People and sharing</h2>
      <table aria-label="Members" className="ledger">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Handle</th>
            <th scope="col">Role</th>
            {isOwner ? <th scope="col">Email</th> : null}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.user.id ?? member.user.displayName}>
              <td>{member.user.displayName}</td>
              <td>{member.user.handle === undefined ? '' : `@${member.user.handle}`}</td>
              <td>
                {isOwner ? (
                  <select
                    aria-label={`Role for ${member.user.displayName}`}
                    value={member.role}
                    disabled={busyRole === member.user.id}
                    aria-busy={busyRole === member.user.id ? true : undefined}
                    onChange={(event) => void changeRole(member, event.target.value)}
                  >
                    <option value="owner">owner</option>
                    <option value="editor">editor</option>
                    <option value="reviewer">reviewer</option>
                    <option value="viewer">viewer</option>
                  </select>
                ) : (
                  member.role
                )}
              </td>
              {isOwner ? (
                <td>
                  {emailOf(member) ?? ''}
                  <button type="button" onClick={() => void removeMember(member)}>
                    Remove {member.user.displayName}
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      {isOwner ? (
        <>
          <div className="invite-form">
            <label>
              <span className="field-label">Email</span>
              <input
                value={email}
                aria-describedby={emailError === null ? undefined : 'invite-email-error'}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {emailError === null ? null : (
              <p className="field-error" id="invite-email-error">
                {emailError}
              </p>
            )}
            <label>
              <span className="field-label">Invite role</span>
              <select
                aria-label="Invite role"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value)}
              >
                <option value="editor">editor</option>
                <option value="reviewer">reviewer</option>
                <option value="viewer">viewer</option>
              </select>
            </label>
            <button
              type="button"
              disabled={invitePending}
              aria-busy={invitePending ? true : undefined}
              onClick={() => void sendInvite()}
            >
              Send invite
            </button>
          </div>

          <table aria-label="Invitations" className="ledger">
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Status</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td>{invite.email}</td>
                  <td>{invite.status}</td>
                  <td>
                    {invite.status === 'pending' ? (
                      <button type="button" onClick={() => void revoke(invite)}>
                        Revoke invite to {invite.email}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className="share-section">
            <h3>Share link</h3>
            <button type="button" onClick={() => void writeShareLink()}>
              {shareLink === null ? 'Create share link' : 'Regenerate share link'}
            </button>
            {shareLink === null ? null : (
              <>
                <label>
                  <span className="field-label">Share link</span>
                  <input aria-label="Share link" readOnly value={shareLink.url} />
                </label>
                <p>
                  {shareLink.active
                    ? copy.expiresOn(new Date(shareLink.expiresAt).toLocaleString())
                    : copy.expiredOn(new Date(shareLink.expiresAt).toLocaleString())}
                </p>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(shareLink.url)}
                >
                  Copy link
                </button>
                <button type="button" onClick={() => void revokeShareLink()}>
                  Revoke share link
                </button>
              </>
            )}
          </section>
        </>
      ) : null}
    </Dialog>
  );
}
