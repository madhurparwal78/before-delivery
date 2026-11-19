import { ChevronDown, UserMinus, UserPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Team as TeamDetail, TeamMember } from "../../shared/api";
import { api, ApiFailure } from "../api";
import { onLiveCatchUp, onLiveMessage } from "../live";
import { Link } from "../router";
import { refreshSession, session } from "../session";
import { useStore } from "../store";
import { Modal } from "../ui/Modal";
import { Screen } from "../ui/Screen";
import { pluralize } from "../workbench/InputPane";

function InviteDialog({ team, onClose, onSent }: { team: TeamDetail; onClose: () => void; onSent: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const sent = await api<{ invite: { email: string } }>("POST", `/api/teams/${team.id}/invites`, { email });
      onSent(sent.invite.email);
      onClose();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setProblem(error.details?.fields?.email ?? error.message);
      setBusy(false);
    }
  };
  return (
    <Modal title="Invite teammate" onClose={onClose} initialFocus={field}>
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="form-field">
          <label htmlFor="invite-email">Email</label>
          <input id="invite-email" ref={field} type="email" value={email} autoComplete="off" onChange={(event) => setEmail(event.target.value)} aria-invalid={problem !== null} />
          {problem && <p className="field-error">{problem}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" aria-busy={busy}>Send invite</button>
        </div>
      </form>
    </Modal>
  );
}

function RemoveDialog({ team, member, onClose, onRemoved }: { team: TeamDetail; member: TeamMember; onClose: () => void; onRemoved: (name: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const remove = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await api<void>("DELETE", `/api/teams/${team.id}/members/${member.id}`);
      onRemoved(member.displayName);
      onClose();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setProblem(error.message);
      setBusy(false);
    }
  };
  return (
    <Modal title="Remove teammate" onClose={onClose}>
      <p className="modal-note">Remove {member.displayName} from {team.name}? They lose sight of the team's recipes at once.</p>
      {problem && <p className="field-error">{problem}</p>}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" aria-busy={busy} onClick={() => void remove()}>Remove</button>
      </div>
    </Modal>
  );
}

type TeamDialog = { invite: TeamDetail } | { remove: TeamDetail; member: TeamMember } | null;

export function TeamSettings() {
  const user = useStore(session, (state) => state.user);
  const roles = useStore(session, (state) => state.teams);
  const [teams, setTeams] = useState<TeamDetail[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [fieldProblem, setFieldProblem] = useState<string | null>(null);
  const [dialog, setDialog] = useState<TeamDialog>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    await refreshSession();
    const ids = session.get().teams.map((team) => team.id);
    const details = await Promise.all(ids.map((id) => api<{ team: TeamDetail }>("GET", `/api/teams/${id}`)));
    setTeams(details.map((detail) => detail.team));
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user?.id, load]);

  useEffect(() => {
    const offMessage = onLiveMessage((live) => {
      if (live.type === "membership_changed") void load();
    });
    const offCatchUp = onLiveCatchUp(() => void load());
    return () => {
      offMessage();
      offCatchUp();
    };
  }, [load]);

  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldProblem(null);
    try {
      const made = await api<{ team: TeamDetail }>("POST", "/api/teams", { name });
      setName("");
      await load();
      setOpen(made.team.id);
      setMessage(`Created ${made.team.name}.`);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setFieldProblem(error.details?.fields?.name ?? error.message);
    }
    setBusy(false);
  };

  return (
    <Screen
      label="Team settings"
      title="Team settings"
      strip={<div role="status" aria-label="Team announcements" aria-live="polite">{message || pluralize(teams.length, "team")}</div>}
    >
      {!user ? (
        <p className="empty"><Link to="/signin">Sign in</Link> to manage teams.</p>
      ) : (
        <>
          <form className="form team-create" onSubmit={(event) => void create(event)} noValidate>
            <div className="form-field">
              <label htmlFor="team-name">Team name</label>
              <input id="team-name" value={name} autoComplete="off" onChange={(event) => setName(event.target.value)} aria-invalid={fieldProblem !== null} />
              {fieldProblem && <p className="field-error">{fieldProblem}</p>}
            </div>
            <button type="submit" className="primary" aria-busy={busy}>Create team</button>
          </form>
          <div className="accordion">
            {teams.map((team) => {
              const owner = team.owner === user.id;
              const expanded = open === team.id;
              return (
                <section key={team.id} className="team" data-open={expanded}>
                  <button type="button" className="team-header" aria-expanded={expanded} aria-controls={`team-${team.id}`} onClick={() => setOpen(expanded ? null : team.id)}>
                    {team.name}
                    <ChevronDown size={18} aria-hidden="true" className="chevron" />
                  </button>
                  <div id={`team-${team.id}`} className="team-body" hidden={!expanded}>
                    <ul role="list" aria-label={`Members of ${team.name}`} className="rows">
                      {team.members.map((member) => (
                        <li key={member.id} className="row member-row">
                          <span className="row-name">{member.displayName}</span>
                          <span className="row-meta">{member.email} · {member.role}</span>
                          {owner && member.role !== "owner" && (
                            <button type="button" className="row-action" aria-label={`Remove ${member.displayName}`} onClick={() => setDialog({ remove: team, member })}>
                              <UserMinus size={18} aria-hidden="true" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {owner && (team.invites?.length ?? 0) > 0 && (
                      <p className="row-meta pending">Invited: {team.invites?.map((invite) => invite.email).join(", ")}</p>
                    )}
                    {owner && (
                      <button type="button" className="invite-button" onClick={() => setDialog({ invite: team })}>
                        <UserPlus size={18} aria-hidden="true" />
                        <span>Invite teammate</span>
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
            {teams.length === 0 && roles.length === 0 && <p className="empty">You are not in a team yet. Create one above.</p>}
          </div>
        </>
      )}
      {dialog && "invite" in dialog && (
        <InviteDialog team={dialog.invite} onClose={() => setDialog(null)} onSent={(email) => { setMessage(`Invite sent to ${email}.`); void load(); }} />
      )}
      {dialog && "remove" in dialog && (
        <RemoveDialog team={dialog.remove} member={dialog.member} onClose={() => setDialog(null)} onRemoved={(removed) => { setMessage(`Removed ${removed}.`); void load(); }} />
      )}
    </Screen>
  );
}
