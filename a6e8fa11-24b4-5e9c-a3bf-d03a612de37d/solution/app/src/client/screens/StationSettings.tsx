import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ROLES } from "../../shared/roles.js";
import { timeZoneList } from "../../shared/time.js";
import { ApiFailure, api } from "../api.js";
import { COPY, ROLE_LABEL } from "../copy.js";
import { useSession } from "../session.js";
import { type MemberRow, type Role } from "../types.js";
import { Dialog } from "../ui/Dialog.js";
import { FieldError, Icon } from "../ui/Icon.js";
import { notify } from "../ui/notices.js";


function AddMemberDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }): JSX.Element {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    try {
      await api.post("/api/station/members", { name, email, role });
      notify(`Member added. The invite email will be sent to ${email.trim()}.`);
      onAdded();
      onClose();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiFailure && err.code === "member_exists") setErrors({ email: `${email.trim()} is already a member of this station.` });
      else if (err instanceof ApiFailure) setErrors(err.fields);
      else setErrors({ form: "The invite wasn't sent. Check your connection and try again." });
    }
  };
  return (
    <Dialog title="Add member" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </label>
        <FieldError>{errors.name}</FieldError>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </label>
        <FieldError>{errors.email}</FieldError>
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="" disabled>
              Choose a role
            </option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <FieldError>{errors.role ?? errors.form}</FieldError>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Sending…" : "Send invite"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function StationSettings(): JSX.Element {
  const { user, setUser } = useSession();
  const zones = useMemo(() => timeZoneList(), []);
  const [zone, setZone] = useState(user.timeZone);
  const [zoneBusy, setZoneBusy] = useState(false);
  const [zoneError, setZoneError] = useState("");
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ members: MemberRow[] }>("/api/station/members")
      .then((r) => setMembers(r.members))
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const saveZone = async (): Promise<void> => {
    setZoneBusy(true);
    setZoneError("");
    try {
      const r = await api.patch<{ station: { timeZone: string } }>("/api/station", { timeZone: zone });
      setUser({ ...user, timeZone: r.station.timeZone });
      notify(`Time zone saved. TODAY() and cutoffs now use ${r.station.timeZone}.`);
    } catch {
      setZoneError(COPY.pickZone);
    } finally {
      setZoneBusy(false);
    }
  };

  const changeRole = async (m: MemberRow, role: Role): Promise<void> => {
    setMembers((list) => (list ?? []).map((x) => (x.id === m.id ? { ...x, role } : x)));
    try {
      await api.patch(`/api/station/members/${m.id}`, { role });
      notify(`Role updated. It applies from ${m.name}'s next sync.`);
    } catch (err) {
      notify(err instanceof ApiFailure && err.code === "last_data_manager" ? "The station needs at least one data manager." : "The role wasn't changed. Try again.");
    }
    load();
  };

  const remove = async (m: MemberRow): Promise<void> => {
    try {
      await api.del(`/api/station/members/${m.id}`);
      notify(`${m.name} was removed from the station.`);
    } catch (err) {
      notify(err instanceof ApiFailure && err.code === "last_data_manager" ? "The station needs at least one data manager." : `${m.name} wasn't removed. Try again.`);
    }
    load();
  };

  return (
    <main className="page station-page graph-faint">
      <h1>Station settings</h1>
      <section className="card station-zone" aria-labelledby="zone-heading">
        <h2 id="zone-heading">Station time</h2>
        <p className="muted">TODAY(), NOW(), cutoffs and every time shown use this zone.</p>
        <div className="zone-row">
          <label className="field">
            <span>Station time zone</span>
            <select value={zone} onChange={(e) => setZone(e.target.value)}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-primary" disabled={zoneBusy} onClick={() => void saveZone()}>
            {zoneBusy ? "Saving…" : "Save time zone"}
          </button>
        </div>
        <FieldError>{zoneError}</FieldError>
      </section>
      <section className="card" aria-labelledby="members-heading">
        <div className="section-head">
          <h2 id="members-heading">Members</h2>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            Add member
          </button>
        </div>
        <div className="table-wrap">
          <table className="members" aria-label="Members">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(members ?? []).map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.name}
                    {m.status === "invited" && <span className="chip chip-invited">Invited</span>}
                  </td>
                  <td className="email">{m.email}</td>
                  <td>
                    <select aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => void changeRole(m, e.target.value as Role)}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button type="button" className="btn btn-quiet" aria-label={`Remove ${m.name}`} onClick={() => void remove(m)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {adding && <AddMemberDialog onClose={() => setAdding(false)} onAdded={load} />}
    </main>
  );
}
