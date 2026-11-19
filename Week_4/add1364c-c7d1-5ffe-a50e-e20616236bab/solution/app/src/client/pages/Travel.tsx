import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, del, get, post } from "../lib/api";
import { useTitle } from "../lib/hooks";
import { officeDate } from "../lib/office";
import { useStore } from "../lib/store";
import type { Person, TravelWindow } from "../lib/types";
import { Dialog } from "../ui/Dialog";
import { Field, SubmitButton, useFieldErrors, useOnce } from "../ui/Field";

export function TravelDialog({ person, onClose, onSaved }: { person: Person; onClose: () => void; onSaved: () => void }) {
  const { say, warn, bumpAudit } = useStore();
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const { errors, setErrors, formRef } = useFieldErrors();
  const { pending, run } = useOnce();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      try {
        await post(`/api/people/${person.id}/travel`, { starts_at: starts, ends_at: ends });
        say("Travel window saved.");
        bumpAudit();
        onSaved();
        onClose();
      } catch (error) {
        if (!(error instanceof ApiError)) return;
        if (error.status === 422) {
          warn("Check the highlighted fields.");
          setErrors({ starts: error.fields.starts_at ?? "", ends: error.fields.ends_at ?? "" });
        } else warn(error.message);
      }
    });
  };
  return (
    <Dialog label="Travel window" onClose={onClose} onSubmit={submit} formRef={formRef}>
      <Field label="Starts" error={errors.starts || undefined}>{(p) => <input {...p} type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />}</Field>
      <Field label="Ends" error={errors.ends || undefined}>{(p) => <input {...p} type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />}</Field>
      <div className="dialog-actions">
        <SubmitButton pending={pending} pendingText="Saving">Save travel window</SubmitButton>
        <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

function windowText(w: TravelWindow): string {
  const part = (t: string) => `${officeDate(t.slice(0, 10))}, ${t.slice(11, 16)}`;
  return `${part(w.starts_at)} to ${part(w.ends_at)}`;
}

export function Travel() {
  useTitle("My travel");
  const { me, say, warn, bumpAudit } = useStore();
  const [person, setPerson] = useState<Person | null>(me);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    const body = await get<{ person: Person }>("/api/me");
    setPerson(body.person);
  }, []);
  useEffect(() => { void load().catch(() => undefined); }, [load]);

  const cancel = async (w: TravelWindow) => {
    if (!person) return;
    try {
      await del(`/api/people/${person.id}/travel/${w.id}`);
      say("Travel window cancelled.");
      bumpAudit();
      await load();
    } catch (error) {
      if (error instanceof ApiError) warn(error.message);
    }
  };

  const windows = [...(person?.travel ?? [])].sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return (
    <div className="folder-page">
      <section className="folder band-0">
        <header className="folder-title">
          <h1>My travel</h1>
          <button type="button" className="btn btn-solid btn-cut" onClick={() => setOpen(true)}>Add travel window</button>
        </header>
        {windows.length === 0 ? <p className="muted pad">No travel windows filed. Vaults marked off when travelling are withheld while a window is open.</p> : (
          <ul className="slips plain-slips" aria-label="Travel windows">
            {windows.map((w) => (
              <li className="slip travel-slip" key={w.id}>
                <span className="fig">{windowText(w)}</span>
                <button type="button" className="btn btn-quiet" aria-label={`Cancel travel window ${windowText(w)}`} onClick={() => void cancel(w)}>Cancel window</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {open && person ? <TravelDialog person={person} onClose={() => setOpen(false)} onSaved={() => void load()} /> : null}
    </div>
  );
}
