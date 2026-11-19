import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, get, newKey, patch, post } from "../lib/api";
import { useTitle } from "../lib/hooks";
import { officeDate } from "../lib/office";
import { useEvent, useStore } from "../lib/store";
import type { Billing, Person, Role, Seat, Vault } from "../lib/types";
import { Dialog } from "../ui/Dialog";
import { Field, SubmitButton, useFieldErrors, useOnce } from "../ui/Field";
import { BillingBand } from "./Billing";
import { TravelDialog } from "./Travel";

const ROLES: { value: Role; label: string }[] = [
  { value: "office_manager", label: "Office manager" },
  { value: "managing_partner", label: "Managing partner" },
  { value: "staff_accountant", label: "Staff accountant" },
  { value: "outside_bookkeeper", label: "Outside bookkeeper" },
];
const SEAT_WORDS: Record<Seat, string> = {
  confirmed: "Seat confirmed", waiting_on_billing: "Waiting on billing", release_waiting: "Release waiting on billing", released: "Released",
};
const STATUS_WORDS: Record<Person["status"], string> = { invited: "Invited", active: "Active", travelling: "Travelling", on_term: "On term", left: "Left" };

type Dlg = { kind: "add" } | { kind: "change"; person: Person } | { kind: "leave"; person: Person } | { kind: "travel"; person: Person };

export function People() {
  useTitle("People");
  const { me, say, bumpAudit, peopleBusy } = useStore();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [dialog, setDialog] = useState<Dlg | null>(null);
  const isOffice = me?.role === "office_manager";

  const load = useCallback(async () => {
    const body = await get<{ people: Person[] }>("/api/people");
    setPeople(body.people);
  }, []);
  const loadBilling = useCallback(async () => { setBilling(await get<Billing>("/api/billing")); }, []);
  useEffect(() => {
    void load().catch(() => undefined);
    void loadBilling().catch(() => undefined);
    get<{ vaults: Vault[] }>("/api/vaults").then((b) => setVaults(b.vaults)).catch(() => undefined);
  }, [load, loadBilling]);

  useEvent("seat-confirmed", (data) => {
    void load().catch(() => undefined);
    void loadBilling().catch(() => undefined);
    if (peopleBusy.current === 0) {
      const name = typeof data.name === "string" ? data.name : "";
      say(data.change === "release" ? `Billing released ${name}'s seat.` : `Billing confirmed ${name}'s seat.`);
    }
  });
  useEvent("billing-changed", () => { void loadBilling().catch(() => undefined); void load().catch(() => undefined); });

  return (
    <div className="folder-page">
      {billing && !billing.reachable ? <BillingBand /> : null}
      <section className="folder band-0">
        <header className="folder-title">
          <h1>People</h1>
          {isOffice ? <button type="button" className="btn btn-solid btn-cut" onClick={() => setDialog({ kind: "add" })}>Add joiner</button> : null}
        </header>
        <div role="table" aria-label="People" className="grid-table people-table">
          <div role="rowgroup" className="gt-head">
            <div role="row"><span role="columnheader">Name</span><span role="columnheader">Role</span><span role="columnheader">Status</span><span role="columnheader">Seat</span></div>
          </div>
          <div role="rowgroup" className="gt-body">
            {(people ?? []).map((p) => (
              <div role="row" className="gt-row" key={p.id}>
                <span role="cell" className="gt-name">
                  <strong>{p.full_name}</strong>
                  {isOffice && p.status !== "left" ? (
                    <span className="row-actions">
                      {p.id !== me?.id ? <button type="button" className="btn btn-quiet" aria-label={`Change access for ${p.full_name}`} onClick={() => setDialog({ kind: "change", person: p })}>Change access</button> : null}
                      <button type="button" className="btn btn-quiet" aria-label={`Travel for ${p.full_name}`} onClick={() => setDialog({ kind: "travel", person: p })}>Travel</button>
                      {p.id !== me?.id ? <button type="button" className="btn btn-quiet" aria-label={`Leave for ${p.full_name}`} onClick={() => setDialog({ kind: "leave", person: p })}>Leave</button> : null}
                    </span>
                  ) : null}
                </span>
                <span role="cell">{ROLES.find((r) => r.value === p.role)?.label}</span>
                <span role="cell">{STATUS_WORDS[p.status]}</span>
                <span role="cell" className="seat-cell">{SEAT_WORDS[p.seat]}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      {dialog?.kind === "add" ? <AddJoiner vaults={vaults} onClose={() => setDialog(null)} onDone={() => { void load(); void loadBilling(); bumpAudit(); }} /> : null}
      {dialog?.kind === "change" ? <ChangeAccess person={dialog.person} vaults={vaults} onClose={() => setDialog(null)} onDone={() => { void load(); bumpAudit(); }} /> : null}
      {dialog?.kind === "leave" ? <LeaveDialog person={dialog.person} onClose={() => setDialog(null)} onDone={() => { void load(); void loadBilling(); bumpAudit(); }} /> : null}
      {dialog?.kind === "travel" ? <TravelDialog person={dialog.person} onClose={() => setDialog(null)} onSaved={() => void load()} /> : null}
    </div>
  );
}

function splitAliases(text: string): string[] {
  return text.split(",").map((a) => a.trim()).filter((a) => a.length > 0);
}

function VaultChecks({ vaults, chosen, onToggle, error }: { vaults: Vault[]; chosen: string[]; onToggle: (id: string) => void; error?: string }) {
  return (
    <fieldset className="checks">
      <legend>Vaults</legend>
      {vaults.map((v) => (
        <label className="check" key={v.id}>
          <input type="checkbox" checked={chosen.includes(v.id)} onChange={() => onToggle(v.id)} aria-invalid={error ? true : undefined} />
          <span>{v.formerly ? `${v.name} (formerly ${v.formerly})` : v.name}</span>
        </label>
      ))}
      {error ? <p className="field-error">{error}</p> : null}
    </fieldset>
  );
}

function AddJoiner({ vaults, onClose, onDone }: { vaults: Vault[]; onClose: () => void; onDone: () => void }) {
  const { say, warn, office, peopleBusy } = useStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState<Role>("staff_accountant");
  const [aliases, setAliases] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const { errors, setErrors, formRef } = useFieldErrors();
  const { pending, run } = useOnce();
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      peopleBusy.current += 1;
      try {
        const term = starts || ends ? { starts_on: starts || office?.date || "", ends_on: ends } : null;
        const made = await post<Person>("/api/people", {
          full_name: name, email, handle, role, aliases: splitAliases(aliases), vault_ids: chosen, initial_password: password, term,
        }, { key: newKey() });
        say(made.seat === "confirmed" ? `${made.full_name} joined. Seat confirmed by billing.` : `${made.full_name} joined. Their seat is waiting on billing.`);
        onDone();
        onClose();
      } catch (error) {
        if (!(error instanceof ApiError)) return;
        if (error.status === 422) {
          warn("Check the highlighted fields.");
          const map: Record<string, string> = { full_name: "name", initial_password: "password", term: "term" };
          const next: Record<string, string> = {};
          for (const [k, v] of Object.entries(error.fields)) next[map[k] ?? k] = v;
          setErrors(next);
        } else warn(error.message);
      } finally { peopleBusy.current -= 1; }
    });
  };

  return (
    <Dialog label="Add joiner" onClose={onClose} onSubmit={submit} formRef={formRef} className="dialog-wide">
      <Field label="Full name" error={errors.name}>{(p) => <input {...p} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Email" error={errors.email}>{(p) => <input {...p} type="text" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <Field label="Handle" error={errors.handle}>{(p) => <input {...p} autoComplete="off" autoCapitalize="none" value={handle} onChange={(e) => setHandle(e.target.value)} />}</Field>
      <Field label="Role" error={errors.role}>
        {(p) => <select {...p} value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>}
      </Field>
      <Field label="Aliases" error={errors.aliases} hint="Names separated by commas.">{(p) => <input {...p} value={aliases} onChange={(e) => setAliases(e.target.value)} />}</Field>
      <VaultChecks vaults={vaults} chosen={chosen} onToggle={toggle} error={errors.vault_ids} />
      <Field label="Initial password" error={errors.password}>{(p) => <input {...p} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
      <Field label="Term starts on" hint="Outside bookkeepers only.">{(p) => <input {...p} type="date" value={starts} onChange={(e) => setStarts(e.target.value)} />}</Field>
      <Field label="Term ends on" error={errors.term} hint="Outside bookkeepers only.">{(p) => <input {...p} type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />}</Field>
      <div className="dialog-actions">
        <SubmitButton pending={pending} pendingText="Adding">Add to the office</SubmitButton>
        <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

function ChangeAccess({ person, vaults, onClose, onDone }: { person: Person; vaults: Vault[]; onClose: () => void; onDone: () => void }) {
  const { say, warn } = useStore();
  const [role, setRole] = useState<Role>(person.role);
  const [chosen, setChosen] = useState<string[]>(person.vault_ids);
  const [aliases, setAliases] = useState(person.aliases.join(", "));
  const [ends, setEnds] = useState(person.term?.ends_on ?? "");
  const { errors, setErrors, formRef } = useFieldErrors();
  const { pending, run } = useOnce();
  const scoped = role === "staff_accountant" || role === "outside_bookkeeper";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      try {
        const body: Record<string, unknown> = { role, aliases: splitAliases(aliases) };
        if (scoped) body.vault_ids = chosen;
        if (role === "outside_bookkeeper" && ends) body.term_ends_on = ends;
        await patch(`/api/people/${person.id}`, body);
        say(`Access saved for ${person.full_name}.`);
        onDone();
        onClose();
      } catch (error) {
        if (!(error instanceof ApiError)) return;
        if (error.status === 422) {
          warn("Check the highlighted fields.");
          const map: Record<string, string> = { term: "term", term_ends_on: "term" };
          const next: Record<string, string> = {};
          for (const [k, v] of Object.entries(error.fields)) next[map[k] ?? k] = v;
          setErrors(next);
        } else warn(error.message);
      }
    });
  };

  return (
    <Dialog label="Change access" onClose={onClose} onSubmit={submit} formRef={formRef} className="dialog-wide">
      <p className="muted">{person.full_name}</p>
      <Field label="Role" error={errors.role}>
        {(p) => <select {...p} value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>}
      </Field>
      {scoped ? <VaultChecks vaults={vaults} chosen={chosen} onToggle={(id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))} error={errors.vault_ids} /> : <p className="muted">This role sees every vault.</p>}
      <Field label="Aliases" error={errors.aliases}>{(p) => <input {...p} value={aliases} onChange={(e) => setAliases(e.target.value)} />}</Field>
      <Field label="Term ends on" error={errors.term} hint="Outside bookkeepers only.">{(p) => <input {...p} type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />}</Field>
      <div className="dialog-actions">
        <SubmitButton pending={pending} pendingText="Saving">Save access</SubmitButton>
        <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

function LeaveDialog({ person, onClose, onDone }: { person: Person; onClose: () => void; onDone: () => void }) {
  const { say, warn, peopleBusy } = useStore();
  const { pending, run } = useOnce();
  const confirm = () => {
    void run(async () => {
      peopleBusy.current += 1;
      try {
        const body = await post<{ turns_due: { due_by: string }[]; due_by?: string }>(`/api/people/${person.id}/leave`, { confirm: true }, { key: newKey() });
        const date = body.due_by ?? body.turns_due[0]?.due_by;
        say(`${person.full_name} has left. ${body.turns_due.length} logins are due to turn by ${date ? officeDate(date) : "the next office business day"}.`);
        onDone();
        onClose();
      } catch (error) {
        if (error instanceof ApiError) { warn(error.message); onDone(); onClose(); }
      } finally { peopleBusy.current -= 1; }
    });
  };
  const opener = useRef<Element | null>(document.activeElement);
  return (
    <Dialog label="Confirm leaver" onClose={onClose} returnFocus={() => (opener.current instanceof HTMLElement && document.contains(opener.current) ? opener.current : null)}>
      <p>{person.full_name} loses sign-in at once and every vault scope. Each login in their vaults gets a turn due in two office business days.</p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-solid btn-cut" aria-disabled={pending || undefined} onClick={confirm}>{pending ? "Confirming" : "Confirm leave"}</button>
        <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}
