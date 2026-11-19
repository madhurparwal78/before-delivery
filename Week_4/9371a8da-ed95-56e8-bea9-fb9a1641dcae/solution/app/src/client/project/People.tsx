import type { JSX } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import type { Invite, InviteRole, Member, Role, ShareLink, User } from "../../shared/api.ts";
import { api, get, post } from "../api.ts";
import { Dialog, Field } from "../dialog.tsx";
import { actions } from "../latest.ts";
import { formatWhen } from "../text.ts";
import { SOMETHING_WRONG, type ViewContext } from "./model.ts";

const ROLES: Role[] = ["owner", "editor", "reviewer", "viewer"];
const INVITE_ROLES: InviteRole[] = ["editor", "reviewer", "viewer"];

function emailOf(member: Member): string | null {
  return "email" in member.user ? (member.user as User).email : null;
}

export function PeopleDialog(props: { context: ViewContext; onClose: () => void }): JSX.Element {
  const { context } = props;
  const owner = context.role === "owner";
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [link, setLink] = useState<ShareLink | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("reviewer");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Map<string, Role>>(() => new Map());

  // Members and invites answers sent before the answer to the latest own action (a role change included) are discarded.
  const load = async (asOwner: boolean) => {
    const sent = actions.now();
    try {
      const people = await get<{ members: Member[] }>(`${context.base}/members`);
      if (!actions.current(sent)) return;
      if (people.ok) setMembers(people.data.members);
      if (!asOwner) return;
      const [listed, shared] = await Promise.all([
        get<{ invites: Invite[] }>(`${context.base}/invites`),
        get<{ shareLink: ShareLink | null }>(`${context.base}/share-link`),
      ]);
      if (!actions.current(sent)) return;
      if (listed.ok) setInvites(listed.data.invites);
      if (shared.ok) setLink(shared.data.shareLink);
    } catch {
      /* keep the tables as they are */
    }
  };

  useLayoutEffect(() => {
    void load(owner);
    const timer = setInterval(() => void load(context.role === "owner"), 5000);
    return () => clearInterval(timer);
  }, [owner]);

  const changeRole = async (member: Member, role: Role) => {
    setRoleDrafts((drafts) => new Map(drafts).set(member.user.id, role));
    setBusy(member.user.id);
    const answer = await context.act(() => api<{ member: Member }>("PATCH", `${context.base}/members/${member.user.id}`, { role }));
    setBusy(null);
    const settle = () =>
      setRoleDrafts((drafts) => {
        const next = new Map(drafts);
        next.delete(member.user.id);
        return next;
      });
    if (answer?.ok) {
      const changed = answer.data.member;
      setMembers((current) => (current ?? []).map((row) => (row.user.id === changed.user.id ? changed : row)));
      settle();
      context.say(`${member.user.displayName} is now ${changed.role}`);
      void load(context.role === "owner");
      return;
    }
    if (!answer) context.say(SOMETHING_WRONG);
    else if (answer.status === 409) context.say("A project needs at least one owner");
    else if (answer.status >= 500) context.say(SOMETHING_WRONG);
    // A refused change rereads members at once; the picker then shows the role the server reports.
    await load(context.role === "owner");
    settle();
  };

  const remove = async (member: Member) => {
    setBusy(member.user.id);
    const answer = await context.act(() => api("DELETE", `${context.base}/members/${member.user.id}`));
    setBusy(null);
    if (!answer) return context.say(SOMETHING_WRONG);
    if (answer.ok) context.say(`${member.user.displayName} was removed`);
    else if (answer.status === 409) context.say("A project needs at least one owner");
    else if (answer.status >= 500) context.say(SOMETHING_WRONG);
    void load(true);
  };

  const invite = async (event: Event) => {
    event.preventDefault();
    if (sending) return;
    const typed = email;
    setSending(true);
    setEmailError(null);
    context.say("Sending invitation…");
    const answer = await context.act(() => post<{ invite: Invite }>(`${context.base}/invites`, { email: typed, role: inviteRole }));
    setSending(false);
    if (!answer) return context.say(SOMETHING_WRONG);
    if (answer.ok) {
      setEmail("");
      context.say(`Invitation sent to ${answer.data.invite.email}`);
      void load(true);
      return;
    }
    const shown = typed.trim();
    if (answer.status === 503) context.say("Invitation not sent: email is unavailable. Try again shortly.");
    else if (answer.status === 429) {
      const minutes = Math.ceil((answer.error.retryAfterSeconds ?? 60) / 60);
      context.say(`Invitation not sent: this project has reached 10 invitations this hour. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`);
    } else if (answer.status === 409 && answer.error.error === "already_member") context.say(`${shown} is already a member`);
    else if (answer.status === 409) context.say(`${shown} already has a pending invitation`);
    else if (answer.status === 422) {
      setEmailError("Enter a valid email address.");
      context.say("");
      document.getElementById("invite-email")?.focus();
    } else if (answer.status >= 500) context.say(SOMETHING_WRONG);
  };

  const revoke = async (item: Invite) => {
    const answer = await context.act(() => post<{ invite: Invite }>(`${context.base}/invites/${item.id}/revoke`));
    if (!answer) return context.say(SOMETHING_WRONG);
    if (answer.ok) context.say(`Invitation to ${item.email} revoked`);
    void load(true);
  };

  const shareAction = async (kind: "create" | "regenerate" | "revoke") => {
    setBusy(`share-${kind}`);
    const answer = await context.act(() =>
      kind === "revoke" ? api("DELETE", `${context.base}/share-link`) : post<{ shareLink: ShareLink }>(`${context.base}/share-link`),
    );
    setBusy(null);
    if (!answer) return context.say(SOMETHING_WRONG);
    if (answer.ok) {
      if (kind === "revoke") {
        setLink(null);
        context.say("Share link revoked");
      } else {
        setLink((answer.data as { shareLink: ShareLink }).shareLink);
        context.say(kind === "create" ? "Share link created" : "Share link regenerated. The old link no longer works.");
      }
    } else if (answer.status >= 500) context.say(SOMETHING_WRONG);
  };

  const copy = async () => {
    if (!link) return;
    const field = document.getElementById("share-link-url") as HTMLInputElement | null;
    field?.select();
    try {
      await navigator.clipboard.writeText(link.url);
      context.say("Share link copied");
    } catch {
      context.say("Share link selected; copy it with your keyboard.");
    }
  };

  return (
    <Dialog title="People and sharing" onClose={props.onClose} wide tall>
      <section class="people-section">
        <h3>Members</h3>
        <div class="table-wrap">
          <table aria-label="Members" class="ruled-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Handle</th>
                {owner ? <th scope="col">Email</th> : null}
                <th scope="col">Role</th>
                {owner ? <th scope="col"><span class="visually-hidden">Remove</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {(members ?? []).map((member) => (
                <tr key={member.user.id}>
                  <td>{member.user.displayName}</td>{" "}
                  <td class="mono">@{member.user.handle}</td>{" "}
                  {owner ? <td class="mono">{emailOf(member) ?? ""}</td> : null}
                  <td>
                    {owner ? (
                      <select aria-label={`Role for ${member.user.displayName}`} value={roleDrafts.get(member.user.id) ?? member.role}
                        disabled={busy === member.user.id} aria-busy={busy === member.user.id ? "true" : undefined}
                        onChange={(e) => void changeRole(member, e.currentTarget.value as Role)}>
                        {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                      </select>
                    ) : (
                      member.role
                    )}
                  </td>{" "}
                  {owner ? (
                    <td>
                      <button type="button" class="small quiet" disabled={busy === member.user.id} onClick={() => void remove(member)}>
                        Remove <span class="visually-hidden">{member.user.displayName}</span>
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {owner ? (
        <>
          <section class="people-section">
            <h3>Invite a collaborator</h3>
            <form class="invite-form" onSubmit={invite} noValidate>
              <Field id="invite-email" label="Email" error={emailError}>
                {(described) => (
                  <input id="invite-email" type="email" value={email} aria-describedby={described} aria-invalid={emailError ? "true" : undefined}
                    onInput={(e) => setEmail(e.currentTarget.value)} />
                )}
              </Field>
              <div class="field">
                <label for="invite-role">Invite role</label>
                <select id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.currentTarget.value as InviteRole)}>
                  {INVITE_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </div>
              <button type="submit" class="primary" disabled={sending} aria-busy={sending ? "true" : undefined}>
                Send invite
              </button>
            </form>
            <div class="table-wrap">
              <table aria-label="Invitations" class="ruled-table">
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col">Expires</th>
                    <th scope="col"><span class="visually-hidden">Revoke</span></th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((item) => (
                    <tr key={item.id}>
                      <td class="mono">{item.email}</td>{" "}
                      <td>{item.role}</td>{" "}
                      <td>{item.status}</td>{" "}
                      <td>{formatWhen(item.expiresAt)}</td>{" "}
                      <td>
                        {item.status === "pending" ? (
                          <button type="button" class="small quiet" onClick={() => void revoke(item)}>
                            Revoke <span class="visually-hidden">invite to {item.email}</span>
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {invites.length === 0 ? <p class="muted">No invitations yet.</p> : null}
            </div>
          </section>
          <section class="people-section">
            <h3>Share link</h3>
            {link ? (
              <>
                <div class="field">
                  <label for="share-link-url">Share link</label>
                  <input id="share-link-url" type="text" class="mono" readOnly value={link.url} />
                </div>
                <p class="expiry">{link.active ? `Expires on ${formatWhen(link.expiresAt)}` : `Expired on ${formatWhen(link.expiresAt)}`}</p>
                <div class="dialog-actions start">
                  <button type="button" onClick={() => void copy()}>Copy link</button>
                  <button type="button" disabled={busy === "share-regenerate"} onClick={() => void shareAction("regenerate")}>
                    Regenerate share link
                  </button>
                  <button type="button" class="quiet" disabled={busy === "share-revoke"} onClick={() => void shareAction("revoke")}>
                    Revoke share link
                  </button>
                </div>
              </>
            ) : (
              <>
                <p class="muted">Anyone holding the link reads this project without an account and can change nothing.</p>
                <button type="button" disabled={busy === "share-create"} onClick={() => void shareAction("create")}>
                  Create share link
                </button>
              </>
            )}
          </section>
        </>
      ) : null}
    </Dialog>
  );
}
