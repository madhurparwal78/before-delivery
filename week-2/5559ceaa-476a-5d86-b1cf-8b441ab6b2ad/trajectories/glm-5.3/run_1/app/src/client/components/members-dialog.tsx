import { useEffect, useState } from "react";
import { api, ApiCallError } from "../lib/api";
import { Dialog } from "./dialogs";
import type { Member, Session } from "../../shared/types";
import type { WorkspaceProject } from "../workspace/state";

export function MembersDialog({
  project,
  onClose,
}: {
  project: WorkspaceProject;
  onClose: () => void;
}): React.ReactElement {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [pending, setPending] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);

  const load = async () => {
    const res = await api<{ project: WorkspaceProject }>("GET", `/api/projects/${project.id}`);
    setMembers(res.data?.project.members ?? []);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const invite = async () => {
    if (pending) return;
    if (!email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setStatus("Enter an email address like name@example.com.");
      return;
    }
    if (name.trim().length < 1 || name.trim().length > 80) {
      setStatus("Enter the learner's name (1 to 80 characters).");
      return;
    }
    setPending(true);
    setStatus("Sending invite…");
    try {
      const res = await api<{ invite: { email_status: string } }>(
        "POST",
        `/api/projects/${project.id}/invites`,
        { email: email.trim(), name: name.trim() },
        { "Idempotency-Key": crypto.randomUUID() },
      );
      const chip = res.data?.invite.email_status === "queued" ? " Email queued" : " Email sent";
      setStatus(`Invite recorded for ${email.trim()}.${chip}`);
      setEmail("");
      setName("");
      await load();

    } catch (err) {
      if (err instanceof ApiCallError) {
        if (err.code === "seat_taken") setStatus("This one-to-one project already has a learner. Remove them first.");
        else if (err.code === "group_full") setStatus("This group already has six learners.");
        else if (err.code === "idempotency_conflict") setStatus("Something went wrong. Try again.");
        else setStatus("Something went wrong. Try again.");
      } else {
        setStatus("Something went wrong. Try again.");
      }
    } finally {
      setPending(false);
    }
  };

  const remove = async (target: Member) => {
    setStatus(`Removing ${target.name}…`);
    try {
      await api("DELETE", `/api/projects/${project.id}/members/${target.user_id}`);
      setStatus(`${target.name} was removed. Their access has ended.`);
      await load();

    } catch {
      setStatus("Something went wrong. Try again.");
    }
  };

  return (
    <Dialog label="Members" onClose={onClose} wide>
      <h2>Members</h2>
      <label htmlFor="learner-email">Learner email</label>
      <input id="learner-email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="learner-name">Learner name</label>
      <input id="learner-name" value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={() => void invite()} disabled={pending}>
        Send invite
      </button>
      <ul aria-label="Members" className="members-list">
        {members.map((m) => (
          <li key={m.user_id} className="member-row">
            <span>{m.name}</span>
            <span>{m.role === "mentor" ? "Mentor" : "Student"}</span>
            {m.email_status === "queued" ? <span className="chip mono">Email queued</span> : null}
            {m.role === "student" && m.user_id !== project.owner.id ? (
              <button onClick={() => setRemoveTarget(m)} aria-label={`Remove ${m.name}`}>
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="status" role="status" aria-label="Members status">
        {status}
      </p>
      {removeTarget ? (
        <div className="dialog-backdrop destructive" onMouseDown={(e) => {
          if (e.target === e.currentTarget) setRemoveTarget(null);
        }}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={`Remove ${removeTarget.name}?`}
            className="dialog"
            ref={(node) => {
              const cancel = node?.querySelector<HTMLElement>('[data-autofocus="cancel"]');
              cancel?.focus();
            }}
          >
            <h2>Remove {removeTarget.name}?</h2>
            <p>They lose access straight away, including any open session.</p>
            <div className="dialog-actions">
              <button data-autofocus="cancel" onClick={() => setRemoveTarget(null)}>
                Cancel
              </button>
              <button className="danger" onClick={() => { void remove(removeTarget); setRemoveTarget(null); }}>
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

export function ScheduleDialog({
  project,
  onClose,
  onScheduled,
}: {
  project: WorkspaceProject;
  onClose: () => void;
  onScheduled: (session: Session) => void;
}): React.ReactElement {
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [pending, setPending] = useState(false);
  const schedule = async () => {
    if (pending) return;
    setPending(true);
    try {
      const when = startsAt ? new Date(startsAt) : new Date(Date.now() + 3600_000);
      const res = await api<{ session: Session }>("POST", `/api/projects/${project.id}/sessions`, {
        title,
        scheduled_for: when.toISOString(),
      });
      if (res.data?.session) onScheduled(res.data.session);
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog label="Schedule session" onClose={onClose}>
      <h2>Schedule session</h2>
      <label htmlFor="session-title">Session title</label>
      <input id="session-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="starts-at">Starts at</label>
      <input id="starts-at" className="mono" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
      <button onClick={() => void schedule()} disabled={pending}>
        Schedule
      </button>
    </Dialog>
  );
}
