import { type ReactNode, useCallback, useEffect, useState } from "react";
import { type Role, asFailure, del, get, patch, post } from "../api.js";
import { useToast } from "../components/Toast.js";
import { useShell } from "../shell/ProjectShell.js";

interface Member {
  user_id: string;
  email: string;
  name: string;
  role: Role;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
}

export function Members(): ReactNode {
  const { project, role } = useShell();
  const toast = useToast();
  const base = `/api/projects/${project.id}`;
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("reader");
  const [message, setMessage] = useState("");
  const owner = role === "owner";

  const load = useCallback(async () => {
    const answer = await get<{ members: Member[]; invitations: Invitation[] }>(`${base}/members`);
    setMembers(answer.members);
    setInvitations(answer.invitations);
  }, [base]);
  useEffect(() => void load(), [load]);

  const act = async (work: () => Promise<unknown>, done?: string): Promise<void> => {
    try {
      await work();
      await load();
      if (done) toast(done);
    } catch (error) {
      setMessage(asFailure(error).body.error === "owner_role_fixed" ? "The owner's role cannot change" : "That did not work. Try again");
    }
  };

  const invite = async (): Promise<void> => {
    setMessage("");
    try {
      const sentTo = email.trim().toLowerCase();
      await post(`${base}/invitations`, { email, role: inviteRole });
      setMessage(`Invitation created for ${sentTo}`);
      setEmail("");
      await load();
    } catch (error) {
      const code = asFailure(error);
      setMessage(
        code.body.error === "already_member" ? "Already a member"
        : code.body.error === "already_invited" ? "Already invited"
        : code.body.error === "invalid_field" && code.body["field"] === "email" ? "Enter a valid email address"
        : "Could not send the invitation",
      );
    }
  };

  return (
    <>
      <h1>Members</h1>
      <ul className="rows" role="list" aria-label="Members" aria-busy={members === null || undefined}>
        {members === null ? (
          <li className="skeleton-row" />
        ) : (
          members.map((member) => (
            <li key={member.user_id} className="row">
              <span className="row-main">
                <strong>{member.name}</strong> <span className="muted">{member.email}</span>
              </span>
              {owner && member.role !== "owner" ? (
                <span className="row-actions">
                  <select
                    className="input select"
                    aria-label={`Role for ${member.email}`}
                    value={member.role}
                    onChange={(event) => {
                      const next = event.target.value as Role;
                      setMembers((current) => current?.map((item) => (item.user_id === member.user_id ? { ...item, role: next } : item)) ?? null);
                      void act(() => patch(`${base}/members/${member.user_id}`, { role: next }));
                    }}
                  >
                    <option value="editor">editor</option>
                    <option value="reader">reader</option>
                  </select>
                  <button type="button" className="btn" aria-label={`Remove ${member.email}`} onClick={() => void act(() => del(`${base}/members/${member.user_id}`), "Member removed")}>
                    Remove
                  </button>
                </span>
              ) : (
                <span className="chip">{member.role}</span>
              )}
            </li>
          ))
        )}
      </ul>
      {/* Below the list only once it is known, so the list filling in never pushes the forms down. */}
      {owner && members !== null ? (
        <>
          <h2>Invite someone</h2>
          <form
            className="stack"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void invite();
            }}
          >
            <label className="field">
              <span className="field-label">Invite email</span>
              <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Invite role</span>
              <select className="input select" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
                <option value="editor">editor</option>
                <option value="reader">reader</option>
              </select>
            </label>
            <p className="status-line" role="status" aria-label="Members status">
              {message}
            </p>
            <div className="actions">
              <button type="submit" className="btn btn-lime">
                Send invitation
              </button>
            </div>
          </form>
          <h2>Pending invitations</h2>
          <ul className="rows" role="list" aria-label="Pending invitations">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="row">
                <span>
                  {invitation.email} <span className="chip">{invitation.role}</span>
                </span>
                <button type="button" className="btn" aria-label={`Revoke ${invitation.email}`} onClick={() => void act(() => del(`${base}/invitations/${invitation.id}`), "Invitation revoked")}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
          {invitations.length === 0 ? <p className="muted">No pending invitations.</p> : null}
        </>
      ) : null}
    </>
  );
}
