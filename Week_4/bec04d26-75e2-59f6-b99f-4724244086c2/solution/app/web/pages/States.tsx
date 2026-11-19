import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Carry, Edition, FieldErrors, StateInfo } from "../../shared/types";
import { announce, PRIORITY } from "../announce";
import { get, request } from "../api";
import { SERVER_ERROR } from "../copy";
import { Dialog, useDialogClose } from "../components/Dialog";
import { RadioGroup, TextField, useFirstMessage } from "../components/Fields";
import { useLive } from "../hooks";

const CARRY_LABELS: Record<Carry, string> = { next_business: "Next business day", fixed: "Fixed date" };

function Holidays({ state }: { state: StateInfo }) {
  const close = useDialogClose();
  const [text, setText] = useState(state.holidays.join("\n"));
  const [errors, setErrors] = useState<FieldErrors | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useFirstMessage(form, errors, true);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const dates = text.split("\n").map((line) => line.trim()).filter(Boolean);
    const answer = await request<StateInfo>("PUT", `/api/states/${state.code}/holidays`, { holidays: dates });
    if (answer.ok) {
      announce(`Holidays saved for ${state.code}.`);
      close();
    } else if (answer.failure.kind === "fields") setErrors({ ...answer.failure.errors });
    else announce(SERVER_ERROR, PRIORITY.fieldError);
    setBusy(false);
  };

  return (
    <form ref={form} onSubmit={submit} noValidate>
      <TextField label="Holiday dates" multiline value={text} onChange={setText} error={errors?.holidays} />
      <div className="actions">
        <button type="submit" className="button primary" aria-disabled={busy}>{busy ? "Saving" : "Save holidays"}</button>
        <button type="button" className="button" onClick={close}>Cancel</button>
      </div>
    </form>
  );
}

function Rule({ state }: { state: StateInfo }) {
  const close = useDialogClose();
  const [values, setValues] = useState({ effective: "", dueDay: "", carry: "", rate: "", extension: "" });
  const [errors, setErrors] = useState<FieldErrors | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useFirstMessage(form, errors, true);
  const set = (key: keyof typeof values) => (value: string): void => setValues((v) => ({ ...v, [key]: value }));
  const whole = (text: string): number | undefined => (text.trim() === "" || Number.isNaN(Number(text)) ? undefined : Number(text));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const answer = await request<{ edition: Edition }>("POST", `/api/states/${state.code}/editions`, {
      effective_date: values.effective, due_day: whole(values.dueDay), carry: values.carry || undefined,
      rate: values.rate, extension_days: whole(values.extension),
    });
    if (answer.ok) {
      announce(`Rule change published for ${state.code}.`);
      close();
    } else if (answer.failure.kind === "fields") setErrors({ ...answer.failure.errors });
    else announce(SERVER_ERROR, PRIORITY.fieldError);
    setBusy(false);
  };

  return (
    <form ref={form} onSubmit={submit} noValidate>
      <TextField label="Effective date" hint="YYYY-MM-DD" value={values.effective} onChange={set("effective")} error={errors?.effective_date} />
      <TextField label="Due day" type="number" inputMode="numeric" value={values.dueDay} onChange={set("dueDay")} error={errors?.due_day} />
      <RadioGroup label="Carry-forward" value={values.carry} onChange={set("carry")} error={errors?.carry}
        options={(Object.keys(CARRY_LABELS) as Carry[]).map((c) => ({ value: c, label: CARRY_LABELS[c] }))} />
      <TextField label="Reference rate" hint="Three decimals, for example 4.500" value={values.rate} onChange={set("rate")} error={errors?.rate} />
      <TextField label="Extension days" type="number" inputMode="numeric" value={values.extension} onChange={set("extension")}
        error={errors?.extension_days} />
      <div className="actions">
        <button type="submit" className="button primary" aria-disabled={busy}>{busy ? "Saving" : "Publish"}</button>
        <button type="button" className="button" onClick={close}>Cancel</button>
      </div>
    </form>
  );
}

export function States() {
  const [states, setStates] = useState<StateInfo[]>([]);
  const [dialog, setDialog] = useState<{ kind: "holidays" | "rule"; code: string } | null>(null);
  const load = useCallback(() => void get<StateInfo[]>("/api/states").then((a) => a.ok && setStates(a.data)), []);
  useEffect(load, [load]);
  useLive((event) => {
    if (event.type === "states") load();
  });
  const closeDialog = useCallback(() => {
    setDialog(null);
    load();
  }, [load]);
  const open = states.find((s) => s.code === dialog?.code);

  return (
    <main className="states">
      <h1>States</h1>
      {states.map((s) => (
        <section key={s.code} aria-label={s.name} className="panel state">
          <h2>{s.name}</h2>
          <p className="muted">{`${s.code} · ${s.zone_label} time · ${s.zone}`}</p>
          <h3>Editions</h3>
          <ul>
            {s.editions.map((e) => (
              <li key={e.effective_date}>
                {`Effective ${e.effective_date} · due day ${e.due_day} · ${CARRY_LABELS[e.carry]} · reference rate ${e.rate}% · ${e.extension_days} extension days`}
              </li>
            ))}
          </ul>
          <h3>Holidays</h3>
          <p className="holidays">{s.holidays.length ? s.holidays.join(", ") : "No holidays listed."}</p>
          <div className="actions">
            <button type="button" className="button" onClick={() => setDialog({ kind: "holidays", code: s.code })}>{`Edit holidays for ${s.code}`}</button>
            <button type="button" className="button" onClick={() => setDialog({ kind: "rule", code: s.code })}>{`Publish rule change for ${s.code}`}</button>
          </div>
        </section>
      ))}
      {open && dialog?.kind === "holidays" && (
        <Dialog title={`Holidays for ${open.code}`} onClose={closeDialog}><Holidays state={open} /></Dialog>
      )}
      {open && dialog?.kind === "rule" && <Dialog title="Publish rule change" onClose={closeDialog}><Rule state={open} /></Dialog>}
    </main>
  );
}
