import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api, ApiFailure, apiMessage } from "../api";
import { RoleChip } from "../components/Chip";
import { Dialog, ErrorSummary, FieldError, type FieldErrors } from "../components/Dialog";
import { managesPeople } from "../permissions";
import { notify } from "../store";
import { ROLE_LABEL, type Channel, type Me, type Role, type User } from "../types";


type Member = { user: User; joined_at: string };

// Channel members: everyone sees names, handles and roles; operations managers also see emails,
// remove people and add active workspace people who are not in the channel yet.
export function MembersDialog({ channel, me, onClose }: { channel: Channel; me: Me; onClose: () => void }) {
  const manager = managesPeople(me.user.role);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [people, setPeople] = useState<User[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const pickRef = useRef<HTMLSelectElement>(null);
  const ids = { pick: useId(), error: useId() };

  const load = useCallback(async () => {
    const [detail, everyone] = await Promise.all([
      api<{ members: Member[] }>("GET", `/api/channels/${channel.id}`),
      manager ? api<{ members: User[] }>("GET", "/api/workspace/members") : Promise.resolve({ members: [] as User[] }),
    ]);
    setMembers(detail.members);
    setPeople(everyone.members);
  }, [channel.id, manager]);
  useEffect(() => {
    load().catch((failure: unknown) => notify(apiMessage(failure)));
  }, [load]);

  const inChannel = new Set((members ?? []).map((m) => m.user.id));
  const candidates = people.filter((p) => p.status === "active" && !inChannel.has(p.id));
  const candidateKey = candidates.map((c) => c.id).join(",");
  useEffect(() => {
    if (pickRef.current) pickRef.current.selectedIndex = -1;
  }, [candidateKey]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const userId = pickRef.current?.value ?? "";
    setBusy("add");
    setError(undefined);
    try {
      const body = await api<{ member: Member }>("POST", `/api/channels/${channel.id}/members`, { user_id: userId });
      notify(`${body.member.user.name} added to #${channel.name}.`);
      await load();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.body?.errors) setError(Object.values(failure.body.errors)[0]);
      else notify(apiMessage(failure));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (member: Member) => {
    setBusy(member.user.id);
    try {
      await api("DELETE", `/api/channels/${channel.id}/members/${member.user.id}`);
      notify(`${member.user.name} removed from #${channel.name}.`);
      await load();
    } catch (failure) {
      notify(apiMessage(failure));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog title={`Members of ${channel.name}`} onClose={onClose} wide>
      {manager ? (
        <form className="add-member" onSubmit={add}>
          <div className="field">
            <label htmlFor={ids.pick}>Add a person</label>
            <select id={ids.pick} ref={pickRef} defaultValue="" aria-invalid={error ? true : undefined} aria-describedby={error ? ids.error : undefined}>
              {candidates.map((person) => (
                <option key={person.id} value={person.id}>
                  {`${person.name} (${person.email ?? ""})`}
                </option>
              ))}
            </select>
            <FieldError id={ids.error} text={error} />
          </div>
          <button className="button button-primary" type="submit" disabled={busy === "add"}>
            {busy === "add" ? "Saving…" : "Add to channel"}
          </button>
        </form>
      ) : null}
      {members === null ? <p className="panel-note">Loading members…</p> : null}
      {members ? (
        <ul className="people" aria-label="Current members">
          {members.map((member) => (
            <li key={member.user.id} className="person">
              <span className="person-name">{member.user.name}</span>
              <span className="person-handle">@{member.user.handle}</span>
              <RoleChip role={member.user.role} />
              {member.user.email ? <span className="person-email">{member.user.email}</span> : null}
              {manager ? (
                <button className="button button-quiet person-action" type="button" disabled={busy === member.user.id} onClick={() => void remove(member)} aria-label={`Remove ${member.user.name}`}>
                  {busy === member.user.id ? "Saving…" : "Remove"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="dialog-actions">
        <button className="button button-quiet" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

// Operations managers see every person in the workspace and may deactivate anyone but themself.
export function PeopleDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const [people, setPeople] = useState<User[] | null>(null);
  const [confirm, setConfirm] = useState<User | null>(null);
  const load = useCallback(() => {
    api<{ members: User[] }>("GET", "/api/workspace/members").then((body) => setPeople(body.members), () => setPeople([]));
  }, []);
  useEffect(load, [load]);

  return (
    <>
      <Dialog title="Workspace people" onClose={onClose} wide>
        {people === null ? <p className="panel-note">Loading people…</p> : null}
        {people ? (
          <ul className="people" aria-label="People">
            {people.map((person) => (
              <li key={person.id} className="person">
                <span className="person-name">{person.name}</span>
                <span className="person-handle">@{person.handle}</span>
                <RoleChip role={person.role} />
                {person.email ? <span className="person-email">{person.email}</span> : null}
                <span className={`status status-${person.status}`}>{person.status === "active" ? "Active" : person.status === "invited" ? "Invited" : "Deactivated"}</span>
                {person.id !== me.user.id && person.status !== "deactivated" ? (
                  <button className="button button-quiet person-action" type="button" aria-label={`Deactivate ${person.name}`} onClick={() => setConfirm(person)}>
                    Deactivate
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="dialog-actions">
          <button className="button button-quiet" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </Dialog>
      {confirm ? (
        <DeactivateDialog
          person={confirm}
          onClose={() => setConfirm(null)}
          onDone={() => {
            setConfirm(null);
            load();
          }}
        />
      ) : null}
    </>
  );
}

function DeactivateDialog({ person, onClose, onDone }: { person: User; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await api("DELETE", `/api/workspace/members/${person.id}`);
      notify(`${person.name} can no longer sign in.`);
      onDone();
    } catch (failure) {
      notify(apiMessage(failure));
      onClose();
    }
  };
  return (
    <Dialog title={`Deactivate ${person.name}?`} onClose={onClose}>
      <p className="dialog-copy">They are signed out everywhere at once, leave every channel and can no longer sign in.</p>
      <div className="dialog-actions">
        <button className="button button-danger" type="button" disabled={busy} onClick={() => void run()}>
          {busy ? "Deactivating…" : "Deactivate"}
        </button>
        <button className="button button-quiet" type="button" onClick={onClose}>
          Keep access
        </button>
      </div>
    </Dialog>
  );
}

const ROLES: Role[] = ["dispatcher", "field_technician", "crew_lead", "ops_manager"];

export function InviteDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const roleRef = useRef<HTMLSelectElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const ids = { name: useId(), email: useId(), role: useId(), nameError: useId(), emailError: useId(), roleError: useId() };
  useEffect(() => {
    if (roleRef.current) roleRef.current.selectedIndex = -1;
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const body = await api<{ member: User; invite_email: "sent" | "queued" }>("POST", "/api/workspace/members", { name, email, role: roleRef.current?.value ?? "" });
      const address = body.member.email ?? email;
      notify(body.invite_email === "sent" ? `Invite emailed to ${address}.` : `Invite saved. The email to ${address} is queued until mail is reachable.`);
      onClose();
    } catch (failure) {
      setBusy(false);
      if (failure instanceof ApiFailure && failure.body?.errors) setErrors(failure.body.errors);
      else if (failure instanceof ApiFailure && failure.body?.error === "email_taken") setErrors({ email: failure.body.message });
      else notify(apiMessage(failure));
    }
  };

  return (
    <Dialog title="Invite technician" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorSummary errors={errors} ids={{ name: ids.name, email: ids.email, role: ids.role }} />
        <div className="field">
          <label htmlFor={ids.name}>Name</label>
          <input
            id={ids.name}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? ids.nameError : undefined}
          />
          <FieldError id={ids.nameError} text={errors.name} />
        </div>
        <div className="field">
          <label htmlFor={ids.email}>Email</label>
          <input
            id={ids.email}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? ids.emailError : undefined}
          />
          <FieldError id={ids.emailError} text={errors.email} />
        </div>
        <div className="field">
          <label htmlFor={ids.role}>Role</label>
          <select id={ids.role} ref={roleRef} defaultValue="" aria-invalid={errors.role ? true : undefined} aria-describedby={errors.role ? ids.roleError : undefined}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
          <FieldError id={ids.roleError} text={errors.role} />
        </div>
        <div className="dialog-actions">
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send invite"}
          </button>
          <button className="button button-quiet" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
