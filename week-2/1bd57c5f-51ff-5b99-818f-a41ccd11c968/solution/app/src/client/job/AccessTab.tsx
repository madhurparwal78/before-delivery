import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ROLE_LABELS, type AccessCard, type Reveal } from "../../shared/domain";
import { useAnnounce } from "../activity";
import { ApiFailure, api } from "../api";
import { ErrorSummary, FieldError } from "../components/ErrorSummary";
import { COPY } from "../copy";
import { localDateTime } from "../time";
import { useJob } from "./context";
import { HouseAccess } from "./HouseAccess";

const CARD_FIELDS = [
  ["lockbox_code", "Lockbox code"],
  ["alarm_code", "Alarm code"],
  ["garage_code", "Garage code"],
] as const;

type CardForm = Omit<AccessCard, "visible_until">;

function EditCard({ card, onSaved }: { card: CardForm | null; onSaved: () => void }) {
  const { job, online, readOnly } = useJob();
  const announce = useAnnounce();
  const [form, setForm] = useState<CardForm>({ lockbox_code: "", alarm_code: "", garage_code: "", house_note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (card) setForm(card);
  }, [card]);
  const locked = !card || !online || readOnly;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    announce(COPY.saving);
    try {
      const saved = await api<AccessCard>("PUT", `/api/jobs/${job.id}/access`, form);
      setForm({ lockbox_code: saved.lockbox_code, alarm_code: saved.alarm_code, garage_code: saved.garage_code, house_note: saved.house_note });
      setErrors({});
      announce("Access card saved.");
      onSaved();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setErrors(error.body.fields ?? {});
        announce(error.message);
      } else announce("Saving the access card needs a connection.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit} noValidate aria-labelledby="edit-card-heading">
      <h2 id="edit-card-heading">Edit access card</h2>
      <p className="muted">{card ? "Changes apply to every visit from now on." : "Show the codes first: the form fills with the current card."}</p>
      <ErrorSummary problems={Object.entries(errors).map(([field, message]) => ({ target: `card-${field}`, message }))} />
      <div className="access-form">
        {CARD_FIELDS.map(([key, label]) => (
          <div className="field" key={key}>
            <label htmlFor={`card-${key}`}>{label}</label>
            <input
              id={`card-${key}`}
              className="input mono"
              value={form[key]}
              disabled={locked}
              maxLength={40}
              autoComplete="off"
              onChange={(event) => setForm({ ...form, [key]: event.target.value })}
              aria-invalid={errors[key] ? true : undefined}
            />
            <FieldError id={`card-${key}-error`} message={errors[key]} />
          </div>
        ))}
        <div className="field field--wide">
          <label htmlFor="card-house_note">House note</label>
          <textarea
            id="card-house_note"
            className="input"
            value={form.house_note}
            disabled={locked}
            maxLength={500}
            onChange={(event) => setForm({ ...form, house_note: event.target.value })}
            aria-invalid={errors.house_note ? true : undefined}
          />
          <FieldError id="card-house_note-error" message={errors.house_note} />
        </div>
      </div>
      <div>
        <button type="submit" className="btn btn--primary" disabled={locked || pending} aria-busy={pending}>
          Save access card
        </button>
      </div>
    </form>
  );
}

export function AccessTab() {
  const { job, role } = useJob();
  const owner = role === "owner";
  const [card, setCard] = useState<CardForm | null>(null);
  const [reveals, setReveals] = useState<Reveal[]>([]);

  const loadReveals = useCallback(async () => {
    if (!owner) return;
    try {
      setReveals((await api<{ reveals: Reveal[] }>("GET", `/api/jobs/${job.id}/access/reveals`)).reveals);
    } catch {
      // The table keeps its last rows until the next successful read.
    }
  }, [job.id, owner]);

  useEffect(() => {
    void loadReveals();
  }, [loadReveals]);

  return (
    <div className="panel">
      <HouseAccess
        onCard={(next) => {
          setCard({ lockbox_code: next.lockbox_code, alarm_code: next.alarm_code, garage_code: next.garage_code, house_note: next.house_note });
          void loadReveals();
        }}
      />
      {owner && <EditCard card={card} onSaved={() => void loadReveals()} />}
      {owner && (
        <section className="panel-section" aria-labelledby="reveals-heading">
          <h2 id="reveals-heading">Code reveals</h2>
          {reveals.length === 0 && <p className="muted">Nobody has viewed the codes yet.</p>}
          <div className="table-wrap">
            <table aria-label="Code reveals">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Role</th>
                  <th scope="col">Revealed at</th>
                </tr>
              </thead>
              <tbody>
                {reveals.map((reveal, index) => (
                  <tr key={`${reveal.revealed_at}-${index}`}>
                    <td className="wrap">{reveal.name}</td>
                    <td>{ROLE_LABELS[reveal.role]}</td>
                    <td className="mono">{localDateTime(reveal.revealed_at, job.time_zone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
