import { useLayoutEffect, useState } from 'preact/hooks';
import { copy, roleLabel } from '../../shared/copy';
import type { BootOf, InviteJson, TeamJson } from '../../shared/types';
import { announce, setBusy, tell } from '../shared/dom';
import { api } from './api';
import { useEventStream } from './hooks';
import { AppHeader, FieldError, fieldProps, siteLinks } from './ui';

const statusText = (invite: InviteJson): string =>
  invite.status === 'held' ? copy.inviteStatusHeld : invite.status === 'sent' ? 'Sent' : invite.status === 'accepted' ? 'Accepted' : 'Expired';

export function Team({ boot }: { boot: BootOf<'team'> }) {
  const { me } = boot;
  const [team, setTeam] = useState<TeamJson | null>(boot.team);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [caption, setCaption] = useState('');
  const load = (): void => {
    void api<TeamJson>('GET', '/api/team').then((result) => result.ok && setTeam(result.data));
  };
  useLayoutEffect(load, []);
  useEventStream('', {
    invite: (invite) =>
      setTeam((previous) => {
        if (previous === null) {
          return previous;
        }
        const known = previous.invites.some((candidate) => candidate.id === invite.id);
        return { ...previous, invites: known ? previous.invites.map((candidate) => (candidate.id === invite.id ? invite : candidate)) : [...previous.invites, invite] };
      }),
    role: (change) => setTeam((previous) => previous && { ...previous, members: previous.members.map((member) => (member.userId === change.userId ? { ...member, role: change.role } : member)) }),
  });

  return (
    <>
      <AppHeader me={me} current="team" {...siteLinks(boot.sites)} />
      <main class="page-wrap">
        <p class="crumbs">{me.team.name}</p>
        <h1>Team</h1>
        <div class="data-wrap">
          <table class="data-table">
            <caption>Members</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
              </tr>
            </thead>
            <tbody>
              {(team?.members ?? []).map((member) => (
                <tr key={member.userId}>
                  <td>{member.name}</td>
                  <td class="mono">{member.email}</td>
                  <td>
                    {member.role === 'owner' ? (
                      roleLabel('owner')
                    ) : (
                      <select
                        aria-label={`Role for ${member.name}`}
                        value={member.role}
                        onChange={async (event) => {
                          const role = event.currentTarget.value;
                          const result = await api('PUT', `/api/team/members/${member.userId}`, { role });
                          if (result.ok) {
                            tell(copy.saved);
                          } else {
                            announce(result.failure.message);
                            load();
                          }
                        }}
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h2>Invite someone</h2>
        <form
          class="inline-form"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            const formElement = event.currentTarget as HTMLFormElement;
            const form = new FormData(formElement);
            const button = formElement.querySelector('button') as HTMLElement;
            setBusy(button, true);
            const email = String(form.get('email')).trim();
            const result = await api<InviteJson>('POST', '/api/team/invites', { email, role: form.get('role') });
            setBusy(button, false);
            if (!result.ok) {
              const found = result.failure.fields ?? { email: result.failure.message };
              setErrors(found);
              document.getElementById('invite-email')?.focus();
              announce(Object.values(found)[0] ?? result.failure.message);
              return;
            }
            setErrors({});
            formElement.reset();
            setTeam((previous) => previous && { ...previous, invites: [...previous.invites.filter((invite) => invite.id !== result.data.id), result.data] });
            if (result.data.status === 'sent') {
              announce(copy.inviteSent(result.data.email));
            } else {
              announce(copy.inviteHeldMessage);
            }
          }}
        >
          <div class="field">
            <label for="invite-email">Email</label>
            <input id="invite-email" name="email" type="email" autocomplete="off" {...fieldProps('invite-email', errors.email)} />
            <FieldError id="invite-email" message={errors.email} />
          </div>
          <div class="field">
            <label for="invite-role">Role</label>
            <select id="invite-role" name="role" {...fieldProps('invite-role', errors.role)}>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <button type="submit" class="button primary">
            Send invite
          </button>
        </form>
        <div class="data-wrap">
          <table class="data-table">
            <caption>Invites</caption>
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {(team?.invites ?? []).map((invite) => (
                <tr key={invite.id}>
                  <td class="mono">{invite.email}</td>
                  <td>{roleLabel(invite.role)}</td>
                  <td>{statusText(invite)}</td>
                  <td>
                    {invite.status === 'held' && (
                      <button
                        type="button"
                        class="button"
                        onClick={async (event) => {
                          const button = event.currentTarget;
                          setBusy(button, true);
                          const result = await api<InviteJson>('POST', `/api/team/invites/${invite.id}/send`);
                          setBusy(button, false);
                          if (result.ok) {
                            setTeam((previous) => previous && { ...previous, invites: previous.invites.map((row) => (row.id === invite.id ? result.data : row)) });
                            announce(copy.inviteSent(invite.email));
                          } else {
                            setCaption(result.failure.message);
                            announce(result.failure.message);
                          }
                        }}
                      >
                        Send now
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {caption && <p class="field-error">{caption}</p>}
      </main>
    </>
  );
}
