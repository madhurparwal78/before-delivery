import { useEffect, useState } from "preact/hooks";
import { type Ballot, type BlindEntry, type Scores, get, post, put } from "../api";
import { Dialog, useDialog } from "../dialog";
import { Link, RoleGate, useAction, useBand, useDesk } from "../desk";
import { type FieldErrors, SelectField, Submit, TextField } from "../form";

// The juror's screens: open rounds, declared conflicts and the blind ballot (brief: Screens and layout, Jury,
// Conflicts and Ballot).

interface JurorRound {
  id: string;
  name: string;
  categoryName: string;
  ballotDeadlineLabel: string;
  assigned: number;
  remaining: number;
  ballotSubmitted: boolean;
}

function RoundsList() {
  useBand({ name: "Jury", target: null });
  const [rounds, setRounds] = useState<JurorRound[] | null>(null);
  useEffect(() => {
    void get<{ rounds: JurorRound[] }>("/api/juror/rounds").then((r) => setRounds(r.ok ? r.data.rounds : []));
  }, []);
  return (
    <div class="page">
      <header class="page-head">
        <p class="eyebrow">Jury</p>
        <h1 class="page-title">Your open rounds</h1>
        <div class="page-head__tools"><Link href="/jury/conflicts" class="button button--secondary">Conflicts</Link></div>
      </header>
      {rounds === null ? <p class="loading">Loading…</p> : (
        <ul class="round-list">
          {rounds.map((round) => (
            <li key={round.id} class="round-list__item">
              <Link href={`/jury/rounds/${round.id}`} class="round-list__link">{round.categoryName} — {round.name}</Link>
              <span class="round-list__meta">Ballot closes {round.ballotDeadlineLabel}</span>
              <span class="round-list__count"><span class="num">{round.remaining}</span> left to score</span>
              {round.ballotSubmitted ? <span class="round-list__done">Ballot submitted</span> : null}
            </li>
          ))}
          {rounds.length === 0 ? <li class="empty">No open rounds. Your invitation email will say when one opens.</li> : null}
        </ul>
      )}
    </div>
  );
}

interface Conflict {
  studioId: string;
  studioName: string;
  note: string;
  declaredAt: string;
}

function ConflictsPage() {
  useBand({ name: "Jury", target: null });
  const run = useAction();
  const [studios, setStudios] = useState<{ id: string; name: string }[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [studio, setStudio] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const [s, c] = await Promise.all([get<{ studios: { id: string; name: string }[] }>("/api/studios"), get<{ conflicts: Conflict[] }>("/api/conflicts")]);
    if (s.ok) setStudios(s.data.studios);
    setConflicts(c.ok ? c.data.conflicts : []);
  };
  useEffect(() => {
    void load();
  }, []);
  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    const result = await run("Recording conflict…",
      () => post<{ conflict: Conflict; removedAssignments: number }>("/api/conflicts",
        { studioId: studios.find((s) => s.name === studio)?.id ?? null, note }),
      (data) => `Conflict with ${data.conflict.studioName} recorded. ${data.removedAssignments} assignments removed.`);
    setBusy(false);
    setErrors(result.ok ? {} : result.fields);
    if (result.ok) {
      setNote("");
      await load();
    }
  };
  return (
    <div class="page">
      <header class="page-head">
        <p class="eyebrow">Jury</p>
        <h1 class="page-title">Conflicts</h1>
      </header>
      <div class="split">
        <form class="form-block" onSubmit={submit} noValidate>
          <h2 class="section-title">Declare a conflict</h2>
          <SelectField id="conflict-studio" label="Studio" value={studio} error={errors.studioId}
            options={[{ value: "", label: "Choose a studio" }, ...studios.map((s) => ({ value: s.name, label: s.name }))]} onValue={setStudio} />
          <TextField id="conflict-note" label="Note" value={note} onValue={setNote} error={errors.note} />
          <div class="actions"><Submit busy={busy} label="Declare conflict" pending="Recording conflict…" /></div>
        </form>
        <section class="form-block" aria-labelledby="declared-title">
          <h2 id="declared-title" class="section-title">Declared conflicts</h2>
          <ul class="conflict-list" aria-label="Declared conflicts">
            {(conflicts ?? []).map((c) => (
              <li key={c.studioId}><strong>{c.studioName}</strong>{c.note ? <span> — {c.note}</span> : null}</li>
            ))}
            {conflicts && conflicts.length === 0 ? <li class="empty">No conflicts declared.</li> : null}
          </ul>
        </section>
      </div>
    </div>
  );
}

const CRITERIA: [keyof Scores, string][] = [["craft", "Craft"], ["clarity", "Clarity"], ["idea", "Idea"], ["story", "Story"]];

function Spin({ id, label, value, onValue, disabled, error }: {
  id: string; label: string; value: string; onValue: (v: string) => void; disabled: boolean; error: string | undefined;
}) {
  return (
    <div class={`score-field${error ? " field--invalid" : ""}`}>
      <label for={id} class="field__label">{label}</label>
      <input id={id} class="input input--score num" type="number" min={1} max={10} step={1} inputMode="numeric" value={value}
        disabled={disabled} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
        onInput={(e) => onValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Home" || e.key === "End") {
            e.preventDefault();
            onValue(e.key === "Home" ? "1" : "10");
          }
        }} />
      {error ? <p id={`${id}-error`} class="field__error">{error}</p> : null}
    </div>
  );
}

function BallotEntry({ roundId, entry, locked, onSaved, onRecuse }: {
  roundId: string; entry: BlindEntry; locked: boolean; onSaved: () => Promise<void>; onRecuse: (entry: BlindEntry) => void;
}) {
  const run = useAction();
  const initial = (key: keyof Scores) => (entry.scores ? String(entry.scores[key]) : "");
  const [values, setValues] = useState<Record<keyof Scores, string>>({
    craft: initial("craft"), clarity: initial("clarity"), idea: initial("idea"), story: initial("story"),
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const n = entry.entryNumber;
  const save = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    const body = Object.fromEntries(CRITERIA.map(([key]) => [key, /^\d+$/.test(values[key]) ? Number(values[key]) : values[key]]));
    const result = await run("Saving scores…", () => put<{ scores: Scores; remaining: number }>(`/api/rounds/${roundId}/scores/${entry.entryId}`, body),
      (data) => `Scores saved for Entry ${n}. ${data.remaining} left to score.`);
    setBusy(false);
    setErrors(result.ok ? {} : result.fields);
    if (!result.ok) {
      const first = CRITERIA.find(([key]) => result.fields[key]);
      if (first) document.getElementById(`score-${entry.entryId}-${first[0]}`)?.focus();
      return;
    }
    await onSaved();
  };
  return (
    <article class="ballot-entry" aria-labelledby={`entry-${entry.entryId}`}>
      <div class="ballot-entry__work">
        <h2 id={`entry-${entry.entryId}`} class="ballot-entry__number">Entry {n}</h2>
        <h3 class="ballot-entry__title">{entry.title}</h3>
        <p class="ballot-entry__summary">{entry.summary}</p>
        <div class="ballot-entry__images">
          {entry.images.map((image, i) => (
            <img key={image.url} src={image.url} alt={`Entry ${n} — image ${i + 1}`} width={image.width} height={image.height} loading="lazy" />
          ))}
        </div>
      </div>
      <form class="ballot-entry__scores" onSubmit={save} noValidate>
        <fieldset class="score-group" aria-label={`Scores for Entry ${n}`}>
          <legend class="sr-only">Scores for Entry {n}</legend>
          {CRITERIA.map(([key, label]) => (
            <Spin key={key} id={`score-${entry.entryId}-${key}`} label={label} value={values[key]} disabled={locked}
              error={errors[key]} onValue={(v) => setValues({ ...values, [key]: v })} />
          ))}
        </fieldset>
        {locked ? <p class="locked">Scores locked</p> : (
          <div class="actions">
            <button type="submit" class="button button--primary" disabled={busy} aria-busy={busy || undefined}
              aria-label={busy ? undefined : `Save scores for Entry ${n}`}>{busy ? "Saving scores…" : "Save scores"}</button>
            <button type="button" class="button button--quiet" aria-label={`Recuse from Entry ${n}`} onClick={() => onRecuse(entry)}>Recuse</button>
          </div>
        )}
      </form>
    </article>
  );
}

function BallotPage({ id }: { id: string }) {
  const desk = useDesk();
  const run = useAction();
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [missing, setMissing] = useState(false);
  const [recusing, setRecusing] = useState<BlindEntry | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState("");
  const recuseDialog = useDialog();
  const submitDialog = useDialog();
  const load = async () => {
    const r = await get<Ballot>(`/api/rounds/${id}/ballot`);
    if (r.ok) setBallot(r.data);
    else setMissing(true);
  };
  useEffect(() => {
    void load();
  }, [id]);
  useBand(ballot ? { name: `${ballot.round.categoryName} — ${ballot.round.name}`, target: ballot.round.ballotDeadlineAt } : null);
  if (missing) return <p class="notice">We couldn't find that.</p>;
  if (!ballot) return <p class="loading">Loading…</p>;

  const confirmRecuse = async () => {
    if (!recusing) return;
    setBusy("recuse");
    const result = await run("Recusing…", () => post<{ remaining: number }>(`/api/rounds/${id}/entries/${recusing.entryId}/recuse`, { note }));
    setBusy("");
    if (!result.ok && result.fields.note) return setNoteError(result.fields.note);
    await recuseDialog.hide();
    if (!result.ok) return desk.fail(result.message);
    await load();
    desk.done(`You've recused from Entry ${recusing.entryNumber}.`);
    setNote("");
  };
  const confirmSubmit = async () => {
    setBusy("submit");
    const result = await run("Submitting your ballot…", () => post<{ counted: number }>(`/api/rounds/${id}/ballot/submit`));
    setBusy("");
    await submitDialog.hide();
    if (!result.ok) return desk.fail(result.message);
    await load();
    desk.done(`Ballot submitted. ${result.data.counted} entries scored.`);
  };

  const locked = ballot.submitted || ballot.round.state !== "open";
  return (
    <div class="page page--ballot">
      <header class="page-head">
        <p class="eyebrow">{ballot.round.categoryName} — {ballot.round.name}</p>
        <h1 class="page-title">Ballot</h1>
        <p class="deadline">Ballot closes {ballot.round.ballotDeadlineLabel}</p>
        {ballot.submitted ? <p class="status-line"><strong>Ballot submitted</strong></p> : null}
      </header>
      {ballot.entries.map((entry) => (
        <BallotEntry key={`${entry.entryId}:${ballot.submitted}`} roundId={id} entry={entry} locked={locked} onSaved={load}
          onRecuse={(e) => {
            setRecusing(e);
            setNoteError(undefined);
            recuseDialog.show();
          }} />
      ))}
      {ballot.entries.length === 0 ? <p class="empty">No entries are assigned to you in this round.</p> : null}
      <div class="ballot-bar">
        <p class="ballot-bar__count">{ballot.scored} of {ballot.assigned} scored</p>
        {ballot.submitted ? <p class="ballot-bar__done">Ballot submitted</p> : (
          <button type="button" class="button button--primary" disabled={locked || ballot.remaining > 0 || busy === "submit"}
            onClick={submitDialog.show}>Submit final ballot</button>
        )}
      </div>

      <Dialog title={`Recuse from Entry ${recusing?.entryNumber ?? ""}?`} {...recuseDialog.props}>
        <p>Your scores for this entry will not count.</p>
        <TextField id="recuse-note" label="Note" value={note} onValue={setNote} error={noteError} />
        <div class="actions">
          <button type="button" class="button button--danger" disabled={busy === "recuse"} onClick={() => void confirmRecuse()}>
            {busy === "recuse" ? "Recusing…" : "Recuse"}
          </button>
          <button type="button" class="button button--secondary" data-safe onClick={recuseDialog.props.onClose}>Cancel</button>
        </div>
      </Dialog>
      <Dialog title="Submit final ballot?" {...submitDialog.props}>
        <p>You can't change scores after submitting.</p>
        <div class="actions">
          <button type="button" class="button button--primary" disabled={busy === "submit"} onClick={() => void confirmSubmit()}>
            {busy === "submit" ? "Submitting your ballot…" : "Submit ballot"}
          </button>
          <button type="button" class="button button--secondary" data-safe onClick={submitDialog.props.onClose}>Keep scoring</button>
        </div>
      </Dialog>
    </div>
  );
}

export function JuryHome() {
  return <RoleGate role="juror"><RoundsList /></RoleGate>;
}

export function JuryConflicts() {
  return <RoleGate role="juror"><ConflictsPage /></RoleGate>;
}

export function JuryBallot({ id }: { id: string }) {
  return <RoleGate role="juror"><BallotPage id={id} /></RoleGate>;
}
