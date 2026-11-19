import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Client, FieldErrors, Frequency, StateInfo } from "../../shared/types";
import { announce, PRIORITY } from "../announce";
import { get, request } from "../api";
import { SERVER_ERROR } from "../copy";
import { Dialog, useDialogClose } from "../components/Dialog";
import { RadioGroup, SelectField, TextField, useFirstMessage } from "../components/Fields";
import { useLive } from "../hooks";

const FREQUENCY_LABELS: Record<Frequency, string> = { monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };

function AddClient() {
  const close = useDialogClose();
  const [values, setValues] = useState({ name: "", owner: "", email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useFirstMessage(form, errors, true);
  const set = (key: keyof typeof values) => (value: string): void => setValues((v) => ({ ...v, [key]: value }));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const answer = await request<Client>("POST", "/api/clients", {
      name: values.name, owner: { display_name: values.owner, email: values.email, password: values.password },
    });
    if (answer.ok) {
      announce(`Client added: ${answer.data.name}.`);
      close();
    } else if (answer.failure.kind === "fields") setErrors({ ...answer.failure.errors });
    else announce(SERVER_ERROR, PRIORITY.fieldError);
    setBusy(false);
  };

  return (
    <form ref={form} onSubmit={submit} noValidate>
      <TextField label="Business name" value={values.name} onChange={set("name")} error={errors?.name} />
      <TextField label="Owner name" value={values.owner} onChange={set("owner")} error={errors?.display_name} />
      <TextField label="Owner email" type="email" value={values.email} onChange={set("email")} error={errors?.["owner.email"]} />
      <TextField label="Owner password" type="password" autoComplete="new-password" value={values.password}
        onChange={set("password")} error={errors?.["owner.password"]} />
      <div className="actions">
        <button type="submit" className="button primary" aria-disabled={busy}>{busy ? "Saving" : "Save client"}</button>
        <button type="button" className="button" onClick={close}>Cancel</button>
      </div>
    </form>
  );
}

function Register({ client, states }: { client: Client; states: StateInfo[] }) {
  const close = useDialogClose();
  const [values, setValues] = useState({ state: "", frequency: "", first: "" });
  const [errors, setErrors] = useState<FieldErrors | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useFirstMessage(form, errors, true);
  const set = (key: keyof typeof values) => (value: string): void => setValues((v) => ({ ...v, [key]: value }));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const answer = await request<unknown>("POST", `/api/clients/${client.id}/registrations`,
      { state: values.state, frequency: values.frequency, first_period: values.first });
    if (answer.ok) {
      announce(`${client.name} registered in ${values.state}.`);
      close();
    } else if (answer.failure.kind === "fields") setErrors({ ...answer.failure.errors });
    else announce(SERVER_ERROR, PRIORITY.fieldError);
    setBusy(false);
  };

  return (
    <form ref={form} onSubmit={submit} noValidate>
      <SelectField label="State" value={values.state} onChange={set("state")} error={errors?.state} placeholder="Choose a state"
        options={states.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }))} />
      <RadioGroup label="Filing frequency" value={values.frequency} onChange={set("frequency")} error={errors?.frequency}
        options={(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => ({ value: f, label: FREQUENCY_LABELS[f] }))} />
      <TextField label="First period" hint="2026-05, 2026-Q2 or 2026" value={values.first} onChange={set("first")}
        error={errors?.first_period} />
      <div className="actions">
        <button type="submit" className="button primary" aria-disabled={busy}>{busy ? "Saving" : "Register"}</button>
        <button type="button" className="button" onClick={close}>Cancel</button>
      </div>
    </form>
  );
}

export function Clients() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [states, setStates] = useState<StateInfo[]>([]);
  const [dialog, setDialog] = useState<"add" | Client | null>(null);
  const load = useCallback(() => {
    void get<Client[]>("/api/clients").then((a) => a.ok && setClients(a.data));
    void get<StateInfo[]>("/api/states").then((a) => a.ok && setStates(a.data));
  }, []);
  useEffect(load, [load]);
  useLive((event) => {
    if (event.type === "clients" || event.type === "states") load();
  });
  const closeDialog = useCallback(() => {
    setDialog(null);
    load();
  }, [load]);

  return (
    <main className="clients">
      <div className="page-head">
        <h1>Clients</h1>
        <button type="button" className="button primary" onClick={() => setDialog("add")}>Add client</button>
      </div>
      {clients?.map((c) => (
        <section key={c.id} aria-label={c.name} className="panel client">
          <h2>{c.name}</h2>
          <p className="muted">{`Owner: ${c.owner.display_name} · ${c.owner.email}`}</p>
          {c.registrations.length
            ? <ul className="registrations">{c.registrations.map((r) => (
              <li key={r.id}>{`${r.state} · ${FREQUENCY_LABELS[r.frequency]} · from ${r.first_period}`}</li>))}</ul>
            : <p className="muted">Not registered in any state yet.</p>}
          <button type="button" className="button" onClick={() => setDialog(c)}>{`Register ${c.name} in a state`}</button>
        </section>
      ))}
      {dialog === "add" && <Dialog title="Add client" onClose={closeDialog}><AddClient /></Dialog>}
      {dialog && dialog !== "add" && (
        <Dialog title="Register in a state" onClose={closeDialog}><Register client={dialog} states={states} /></Dialog>
      )}
    </main>
  );
}
