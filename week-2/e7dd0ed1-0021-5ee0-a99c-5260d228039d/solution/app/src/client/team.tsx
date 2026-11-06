// Team page (brief: Screens and layout, Team page; Interactions, Team changes; Feedback states, Invite and Team changes).
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { formatTime } from "../shared/format";
import { ApiError, type Invite, type Member, type Role, api, retryAfter } from "./api";
import type { Scope } from "./console";
import { Dialog, Field, Status } from "./dialog";
import { Icon } from "./icons";

const ROLE_LABELS: Record<Role, string> = { owner: "Owner", developer: "Developer", viewer: "Viewer" };
const ROLE_WORDS: Record<Role, string> = { owner: "an owner", developer: "a developer", viewer: "a viewer" };
const LAST_OWNER = "A workspace needs at least one owner.";

export function Team({ scope }: { scope: Scope }): JSX.Element {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [shownRoles, setShownRoles] = useState<Record<string, Role>>({});
  const [teamStatus, setTeamStatus] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");
  const [inviting, setInviting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const membersPath = `/api/w/${scope.ws}/members`;
  const invitesPath = `/api/w/${scope.ws}/invites`;

  const loadInvites = async (): Promise<void> => setInvites((await api<{ invites: Invite[] }>("GET", invitesPath)).invites);
  // The page renders once both lists settle, so the members table never grows and pushes Invites down.
  useEffect(() => {
    setLoaded(false);
    void Promise.allSettled([
      api<{ members: Member[] }>("GET", membersPath).then((r) => setMembers(r.members), (e: unknown) => setTeamStatus(scope.report(e))),
      loadInvites().catch((e: unknown) => setInviteStatus(scope.report(e))),
    ]).then(() => setLoaded(true));
  }, [scope.ws]);

  const refusal = (error: unknown): string =>
    error instanceof ApiError && error.code === "last_owner" ? LAST_OWNER : scope.report(error);

  const changeRole = async (member: Member, role: Role): Promise<void> => {
    setShownRoles({ ...shownRoles, [member.user_id]: role });
    setTeamStatus(`Updating ${member.name}…`);
    try {
      const updated = await api<Member>("PATCH", `${membersPath}/${member.user_id}`, { role });
      setMembers((all) => all.map((m) => (m.user_id === updated.user_id ? updated : m)));
      setTeamStatus(`${member.name} is now ${ROLE_WORDS[updated.role]}.`);
    } catch (error) {
      setShownRoles((shown) => ({ ...shown, [member.user_id]: member.role }));
      setTeamStatus(refusal(error));
    }
  };

  const remove = async (member: Member): Promise<void> => {
    setTeamStatus(`Updating ${member.name}…`);
    try {
      await api("DELETE", `${membersPath}/${member.user_id}`);
      setMembers((all) => all.filter((m) => m.user_id !== member.user_id));
      setTeamStatus(`${member.name} removed. Their share links were revoked.`);
    } catch (error) {
      setTeamStatus(refusal(error));
    }
  };

  if (!loaded) return <section class="page" aria-label="Team" />;
  return (
    <section class="page" aria-labelledby="team-title">
      <div class="page__head">
        <h1 id="team-title" class="page__title">
          Team
        </h1>
        <button type="button" class="button button--primary" onClick={() => setInviting(true)}>
          <Icon name="plus" />
          Invite teammate
        </button>
      </div>
      <div class="notices">
        <Status label="Team status" text={teamStatus} />
        <Status label="Invite status" text={inviteStatus} />
      </div>
      <h2 class="page__subtitle">Members</h2>
      <div class="table-frame">
        <table class="table table--cards" aria-label="Members">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col" class="cell--actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const self = member.user_id === scope.me.user.id;
              return (
                <tr key={member.user_id}>
                  <td data-label="Name">{member.name}</td>
                  <td data-label="Email">{member.email}</td>
                  <td data-label="Role">
                    {self ? (
                      ROLE_LABELS[member.role]
                    ) : (
                      <select aria-label={`Role for ${member.name}`} value={shownRoles[member.user_id] ?? member.role}
                        onChange={(e) => void changeRole(member, e.currentTarget.value as Role)}>
                        {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td class="cell--actions">
                    {!self && (
                      <button type="button" class="button button--small" onClick={() => void remove(member)}>
                        Remove<span class="vh"> {member.name}</span>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h2 class="page__subtitle">Invites</h2>
      <div class="table-frame">
        <table class="table table--cards" aria-label="Invites">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Expires (UTC)</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((invite) => (
              <tr key={invite.id}>
                <td data-label="Email">{invite.email}</td>
                <td data-label="Role">{ROLE_LABELS[invite.role]}</td>
                <td data-label="Expires (UTC)" class="mono">{formatTime(invite.expires_at)}</td>
                <td data-label="State">
                  <span class={`state state--${invite.state}`}>{invite.state}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {invites.length === 0 && <p class="empty">No invites yet.</p>}
      {inviting && (
        <InviteDialog
          scope={scope}
          path={invitesPath}
          onStatus={setInviteStatus}
          onDone={() => {
            setInviting(false);
            void loadInvites();
          }}
          onClose={() => setInviting(false)}
        />
      )}
    </section>
  );
}

interface InviteDialogProps {
  scope: Scope;
  path: string;
  onStatus: (text: string) => void;
  onDone: () => void;
  onClose: () => void;
}

function InviteDialog({ scope, path, onStatus, onDone, onClose }: InviteDialogProps): JSX.Element {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"developer" | "viewer">("developer");
  const [emailError, setEmailError] = useState("");
  const [pending, setPending] = useState(false);

  const send = async (event: Event): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setEmailError("");
    onStatus("Sending invite…");
    try {
      const invite = await api<Invite>("POST", path, { email, role });
      onStatus(`Invite created for ${invite.email}. It expires ${formatTime(invite.expires_at)}.`);
      onDone();
    } catch (error) {
      setPending(false);
      if (error instanceof ApiError && error.body.errors?.["email"]) {
        setEmailError("Enter a valid email address.");
        onStatus("Enter a valid email address.");
      } else if (error instanceof ApiError && error.code === "already_member") {
        onStatus(`${email} is already in this workspace.`);
      } else if (error instanceof ApiError && error.code === "rate_limited") {
        onStatus(`Too many invites right now. Try again in ${retryAfter(error)} seconds.`);
      } else {
        onStatus(scope.report(error));
      }
    }
  };

  return (
    <Dialog title="Invite teammate" onClose={onClose}>
      <form class="form" noValidate onSubmit={send}>
        <Field label="Email" error={emailError}>
          {(described, id) => (
            <input id={id} type="email" value={email} autocomplete="off" aria-describedby={described}
              aria-invalid={emailError ? true : undefined} onInput={(e) => setEmail(e.currentTarget.value)} />
          )}
        </Field>
        <Field label="Role">
          {(described, id) => (
            <select id={id} value={role} aria-describedby={described}
              onChange={(e) => setRole(e.currentTarget.value === "viewer" ? "viewer" : "developer")}>
              <option value="developer">Developer</option>
              <option value="viewer">Viewer</option>
            </select>
          )}
        </Field>
        <div class="form__actions">
          <button type="button" class="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="button button--primary" disabled={pending}>
            Send invite
          </button>
        </div>
      </form>
    </Dialog>
  );
}
