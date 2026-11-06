// Admin: staff roles, venues, edition dates, the price policy and the audit trail.
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { deadlineText } from "../../shared/brussels.ts";
import { decimalEuros, parseEuros } from "../../shared/money.ts";
import { api } from "../api.ts";
import { Field } from "../components/Field.tsx";
import { Gate, ScreenHeader } from "../components/Screen.tsx";
import { copy } from "../copy.ts";
import { useSession } from "../session.tsx";
import { refreshProgramme } from "../state/programme.ts";
import type { AuditEntry, Named, Role, User } from "../types.ts";

const ROLE_NAMES: [Role, string][] = [
  ["visitor", "Visitor"], ["group_booker", "Group booker"], ["artist", "Artist"], ["curator", "Curator"],
  ["box_office", "Box office"], ["finance", "Finance"], ["admin", "Admin"],
];
const PRICE_FIELDS = [
  ["full_festival_full_cents", "Full-festival pass, full rate"], ["full_festival_reduced_cents", "Full-festival pass, reduced rate"],
  ["day_full_cents", "Day pass, full rate"], ["day_reduced_cents", "Day pass, reduced rate"],
] as const;
type Policy = Record<(typeof PRICE_FIELDS)[number][0] | "group_discount_percent" | "version", number>;
type Say = (text: string) => void;

/** The role picker; a refused change stays visible, marked invalid, with the reason beside it. */
function RoleSelect({ user, onChange }: { user: User; onChange: (role: Role) => Promise<boolean> }) {
  const [refused, setRefused] = useState(false);
  const id = useId();
  return (
    <>
      <select aria-label={`Role for ${user.name}`} defaultValue={user.role} key={user.role} aria-invalid={refused || undefined}
        aria-describedby={refused ? id : undefined}
        onChange={(e) => void onChange(e.target.value as Role).then((saved) => setRefused(!saved))}>
        {ROLE_NAMES.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select>
      {refused && <span id={id} className="field__error">Not saved — the role is still {ROLE_NAMES.find(([v]) => v === user.role)?.[1]}.</span>}
    </>
  );
}

function StaffTable({ say }: { say: Say }) {
  const [users, setUsers] = useState<User[]>([]);
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    const r = await api.get<{ users: User[] }>("/api/admin/staff");
    if (r.ok) setUsers(r.data.users);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const change = async (u: User, role: Role) => {
    const organisation = role === "group_booker" ? u.organisation_id ?? "vierwinden" : null;
    const r = await api.patch(`/api/admin/staff/${u.id}`, { role, organisation_id: organisation });
    say(r.ok ? copy.saved : r.error === "last_admin" ? copy.lastAdmin : "That role change didn't save.");
    if (r.ok) void load();
    return r.ok;
  };
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const role = String(f.get("role"));
    const r = await api.post("/api/admin/staff", {
      email: f.get("email"), name: f.get("name"), password: f.get("password"), role,
      organisation_id: role === "group_booker" ? f.get("organisation") : null,
    });
    if (r.ok) { say(copy.saved); setAdding(false); void load(); }
    else say(r.error === "email_taken" ? copy.emailTaken : "Check the new staff member's details: a password needs 10 to 200 characters.");
  };
  return (
    <section aria-labelledby="staff-head" className="panel">
      <div className="panel__bar"><h2 id="staff-head" className="panel__title">Staff</h2>
        <button type="button" className="button" onClick={() => setAdding(!adding)} aria-expanded={adding}>Add staff member</button></div>
      {adding && (
        <form className="toolbar" onSubmit={(e) => void add(e)}>
          <Field label="Name"><input name="name" type="text" /></Field>
          <Field label="Email"><input name="email" type="email" /></Field>
          <Field label="Password"><input name="password" type="password" autoComplete="new-password" /></Field>
          <Field label="Role"><select name="role" defaultValue="curator">{ROLE_NAMES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
          <Field label="Organisation"><select name="organisation"><option value="vierwinden">Atheneum Vierwinden</option><option value="quai-lumiere">École Quai-Lumière</option></select></Field>
          <button type="submit" className="button button--primary">Save staff member</button>
        </form>
      )}
      <table aria-label="Staff" className="ruled cards">
        <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id}>
            <td data-label="Name">{u.name}</td><td data-label="Email">{u.email}</td>
            <td data-label="Role">
              <RoleSelect user={u} onChange={(role) => change(u, role)} />
            </td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

function Venues({ say }: { say: Say }) {
  const [venues, setVenues] = useState<Named[]>([]);
  const load = useCallback(async () => {
    const r = await api.get<{ venues: Named[] }>("/api/admin/venues");
    if (r.ok) setVenues(r.data.venues);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await api.post("/api/admin/venues", { id: f.get("id"), name: f.get("name") });
    say(r.ok ? copy.saved : r.error === "venue_exists" ? "A venue with this id already exists." : "Use a lowercase id such as river-hall, and a name.");
    if (r.ok) { e.currentTarget.reset(); void load(); void refreshProgramme(); }
  };
  const rename = async (v: Named, name: string) => {
    if (!name.trim() || name === v.name) return;
    const r = await api.patch(`/api/admin/venues/${v.id}`, { name });
    say(r.ok ? copy.saved : "Give the venue a name.");
    void load();
  };
  return (
    <section aria-labelledby="venues-head" className="panel">
      <h2 id="venues-head" className="panel__title">Venues</h2>
      <table aria-label="Venues" className="ruled cards">
        <thead><tr><th scope="col">Id</th><th scope="col">Name</th></tr></thead>
        <tbody>{venues.map((v) => (
          <tr key={v.id}><td data-label="Id" className="mono">{v.id}</td>
            <td data-label="Name"><input aria-label={`Name of ${v.id}`} type="text" defaultValue={v.name} onBlur={(e) => void rename(v, e.target.value)} /></td></tr>
        ))}</tbody>
      </table>
      <form className="toolbar" onSubmit={(e) => void add(e)}>
        <Field label="Venue id" hint="Lowercase letters, digits and hyphens; it never changes."><input name="id" type="text" /></Field>
        <Field label="Venue name"><input name="name" type="text" /></Field>
        <button type="submit" className="button">Add venue</button>
      </form>
    </section>
  );
}

function Edition({ say }: { say: Say }) {
  const [edition, setEdition] = useState<{ name: string; first_day: string; last_day: string } | null>(null);
  useEffect(() => { void api.get<{ name: string; first_day: string; last_day: string }>("/api/admin/edition").then((r) => { if (r.ok) setEdition(r.data); }); }, []);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api.put("/api/admin/edition", edition);
    say(r.ok ? copy.saved : r.error === "sessions_outside_edition" ? "Some sessions fall outside those dates, so the edition can't shrink." : "The last festival day can't come before the first.");
    if (r.ok) void refreshProgramme();
  };
  if (!edition) return null;
  return (
    <section aria-labelledby="edition-head" className="panel">
      <h2 id="edition-head" className="panel__title">Edition</h2>
      <form className="toolbar" onSubmit={(e) => void save(e)}>
        <Field label="First festival day"><input type="date" value={edition.first_day} onChange={(e) => setEdition({ ...edition, first_day: e.target.value })} /></Field>
        <Field label="Last festival day"><input type="date" value={edition.last_day} onChange={(e) => setEdition({ ...edition, last_day: e.target.value })} /></Field>
        <button type="submit" className="button button--primary">Save edition</button>
      </form>
    </section>
  );
}

function Prices({ say }: { say: Say }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const r = await api.get<Policy>("/api/admin/price-policy");
    if (!r.ok) return;
    setPolicy(r.data);
    setValues({ ...Object.fromEntries(PRICE_FIELDS.map(([k]) => [k, decimalEuros(r.data[k])])), group_discount_percent: String(r.data.group_discount_percent) });
  }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...Object.fromEntries(PRICE_FIELDS.map(([k]) => [k, parseEuros(values[k] ?? "")])), group_discount_percent: Number(values.group_discount_percent) };
    const r = await api.put<Policy>("/api/admin/price-policy", body, { "If-Match": String(policy!.version) });
    if (r.ok) { setPolicy(r.data); say(copy.saved); void refreshProgramme(); }
    else if (r.error === "stale_version") say(copy.stalePrices);
    else say("Prices run from €0.00 to €1000.00 and the group discount from 0 to 50 percent.");
  };
  if (!policy) return null;
  return (
    <section aria-labelledby="prices-head" className="panel">
      <h2 id="prices-head" className="panel__title">Prices</h2>
      <form className="toolbar" onSubmit={(e) => void save(e)}>
        {PRICE_FIELDS.map(([k, label]) => (
          <Field key={k} label={label}><input type="text" inputMode="decimal" className="figures" value={values[k] ?? ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })} /></Field>
        ))}
        <Field label="Group discount percent"><input type="text" inputMode="numeric" className="figures" value={values.group_discount_percent ?? ""} onChange={(e) => setValues({ ...values, group_discount_percent: e.target.value })} /></Field>
        <button type="submit" className="button button--primary">Save prices</button>
      </form>
      <p className="hint figures">Policy version {policy.version}. New prices apply to orders placed after you save.</p>
    </section>
  );
}

function Audit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  useEffect(() => { void api.get<{ entries: AuditEntry[] }>("/api/admin/audit?limit=60").then((r) => { if (r.ok) setEntries(r.data.entries); }); }, []);
  return (
    <section aria-labelledby="audit-head" className="panel">
      <h2 id="audit-head" className="panel__title">Audit trail</h2>
      <table aria-label="Audit trail" className="ruled figures cards">
        <thead><tr><th scope="col">When</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Target</th></tr></thead>
        <tbody>{entries.map((a) => (
          <tr key={a.id}><td data-label="When">{deadlineText(Date.parse(a.at))}</td><td data-label="Actor">{a.actor} ({a.actor_role})</td>
            <td data-label="Action">{a.action}</td><td data-label="Target" className="mono">{a.target_type} {a.target_id}</td></tr>
        ))}</tbody>
      </table>
    </section>
  );
}

export function Admin() {
  const { user } = useSession();
  const [status, setStatus] = useState("");
  return (
    <div className="screen" data-ground="screen">
      <ScreenHeader title="Admin" lede="Staff, venues, edition dates, prices and the audit trail." />
      <Gate user={user} roles={["admin"]}>
        <div className="grid screen__body">
          <p role="status" aria-label="Admin status" className="status-line">{status}</p>
          <StaffTable say={setStatus} />
          <Venues say={setStatus} />
          <Edition say={setStatus} />
          <Prices say={setStatus} />
          <Audit />
        </div>
      </Gate>
    </div>
  );
}
