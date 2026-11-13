import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, call, get } from "./api";
import { Dialog, useDialogClose } from "./Dialog";
import { ROLE_NAMES } from "./layout";
import { INVITABLE_ROLES, type InvitableRole, type Member } from "../shared/types";

interface Props {
  boardId: string;
  tick: number;
  onClose: () => void;
}

export function MembersDialog({ boardId, tick, onClose }: Props) {
  return (
    <Dialog label="Members" onClose={onClose}>
      <Members boardId={boardId} tick={tick} />
    </Dialog>
  );
}

function Members({ boardId, tick }: { boardId: string; tick: number }) {
  const close = useDialogClose();
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("viewer");
  const [emailError, setEmailError] = useState("");
  const [status, setStatus] = useState("");
  const [alert, setAlert] = useState("");
  const [busy, setBusy] = useState(false);
  const focusAfter = useRef<string | null>(null);
  const base = `/api/boards/${boardId}/members`;

  const refresh = useCallback(async (): Promise<void> => {
    setMembers((await get<{ members: Member[] }>(base)).members);
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh, tick]);

  useEffect(() => {
    if (!focusAfter.current) return;
    document.querySelector<HTMLElement>(focusAfter.current)?.focus();
    focusAfter.current = null;
  }, [members]);

  const changeRole = async (member: Member, next: InvitableRole): Promise<void> => {
    setMembers((current) => current.map((candidate) => (candidate.user_id === member.user_id ? { ...candidate, role: next } : candidate)));
    await call("PATCH", `${base}/${member.user_id}`, { role: next });
    await refresh();
  };

  const remove = async (member: Member): Promise<void> => {
    const rows = members.filter((candidate) => candidate.role !== "owner");
    const following = rows[rows.findIndex((candidate) => candidate.user_id === member.user_id) + 1];
    focusAfter.current = following ? `[data-role-for="${following.user_id}"]` : "#invite-email";
    await call("DELETE", `${base}/${member.user_id}`);
    await refresh();
  };

  const invite = async (): Promise<void> => {
    setBusy(true);
    setEmailError("");
    setAlert("");
    setStatus("");
    try {
      await call("POST", `/api/boards/${boardId}/invites`, { email, role });
      setStatus(`Invite sent to ${email.trim()}.`);
      setEmail("");
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status === 503) setAlert("Invites can't be sent right now. Try again in a few minutes.");
      else if (error.status === 422) setEmailError(error.body.errors?.["email"] ?? error.firstError);
      else throw error;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form">
      <h2 className="form-heading">Members</h2>
      <ul className="members">
        {members.map((member) => (
          <li key={member.user_id}>
            <span className="member-name">
              {member.display_name} <span className="small muted">{member.email}</span>
            </span>
            {member.role === "owner" ? (
              <span className="small muted owner-role">{ROLE_NAMES.owner}</span>
            ) : (
              <>
                <select aria-label={`Role for ${member.display_name}`} data-role-for={member.user_id} value={member.role} onChange={(event) => void changeRole(member, event.target.value as InvitableRole)}>
                  {INVITABLE_ROLES.map((value) => (
                    <option key={value} value={value}>
                      {ROLE_NAMES[value]}
                    </option>
                  ))}
                </select>
                <button type="button" className="quiet" aria-label={`Remove ${member.display_name}`} onClick={() => void remove(member)}>
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="form invite"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void invite();
        }}
      >
        <div className="field">
          <label htmlFor="invite-email">Invite by email</label>
          <input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
          {emailError && <p className="field-error">{emailError}</p>}
        </div>
        <div className="field">
          <label htmlFor="invite-role">Invite role</label>
          <select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as InvitableRole)}>
            {INVITABLE_ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_NAMES[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-actions">
          <button type="button" className="quiet" onClick={close}>
            Close
          </button>
          <button type="submit" aria-busy={busy}>
            {busy ? "Sending…" : "Send invite"}
          </button>
        </div>
        <p role="status" aria-label="Invite status" className="small">
          {status}
        </p>
        <div role="alert" className="field-error">
          {alert}
        </div>
      </form>
    </div>
  );
}
