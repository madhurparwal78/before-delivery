import { useEffect, useRef, useState } from "preact/hooks";
import { type Category, type Entry, type PanelRow, type Program, type Round, type Standings, get, patch, post } from "../api";
import { Dialog, useDialog } from "../dialog";
import { Link, RoleGate, useAction, useBand, useDesk } from "../desk";
import { cents, zonedIso } from "../format";
import { type FieldErrors, SelectField, Submit, TextField, focusFirstError } from "../form";
import { Icon } from "../icons";
import type { Ledger, LedgerRow } from "../shuffle";
import { StandingsTable } from "../standings";
import { entryActionLegal, roundActionLegal } from "../../shared/transitions";

// The program director's screens (brief: Screens and layout, Director home, program, category, round and audit).

const REFRESH_MS = 5000;
const ENTRY_STATES = ["draft", "submitted", "screened", "disqualified", "withdrawn", "round_1", "shortlisted", "eliminated",
  "final_round", "winner", "finalist", "honourable_mention", "published"];
const STATE_NAMES: Record<string, string> = {
  draft: "Draft", submitted: "Submitted", screened: "Screened", disqualified: "Disqualified", withdrawn: "Withdrawn",
  round_1: "Round 1", shortlisted: "Shortlisted", eliminated: "Eliminated", final_round: "Final round", winner: "Winner",
  finalist: "Finalist", honourable_mention: "Honourable mention", published: "Published",
};
const ROUND_STATE: Record<string, string> = {
  scheduled: "Scheduled", open: "Open", closed: "Closed", normalised: "Confirmed", published: "Published",
};

function zones(): string[] {
  return [...new Set(["Asia/Kolkata", "Europe/Lisbon", "UTC", ...Intl.supportedValuesOf("timeZone")])].sort();
}

async function programsList(): Promise<Program[]> {
  const r = await get<{ programs: Program[] }>("/api/programs");
  return r.ok ? r.data.programs : [];
}

function HomePage() {
  useBand({ name: "Director", target: null });
  const run = useAction();
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", year: "", timeZone: "Europe/Lisbon", earlyBirdDate: "", deadlineDate: "", early: "", standard: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void programsList().then(setPrograms);
  }, []);
  const set = (name: keyof typeof form) => (value: string) => setForm({ ...form, [name]: value });
  const create = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    const result = await run("Creating program…", () => post<{ program: Program }>("/api/programs", {
      name: form.name, year: /^\d+$/.test(form.year) ? Number(form.year) : null, timeZone: form.timeZone,
      earlyBirdDate: form.earlyBirdDate, deadlineDate: form.deadlineDate,
      earlyBirdFeeCents: cents(form.early), standardFeeCents: cents(form.standard),
    }), () => "Program created.");
    setBusy(false);
    setErrors(result.ok ? {} : result.fields);
    if (!result.ok) {
      return focusFirstError([["name", "program-name"], ["year", "program-year"], ["timeZone", "program-zone"],
        ["earlyBirdDate", "program-early-date"], ["deadlineDate", "program-deadline"], ["earlyBirdFeeCents", "program-early-fee"],
        ["standardFeeCents", "program-standard-fee"]], result.fields);
    }
    setPrograms(await programsList());
    setShowForm(false);
  };
  return (
    <div class="page">
      <header class="page-head">
        <p class="eyebrow">Mara's desk</p>
        <h1 class="page-title">Programs</h1>
        <div class="page-head__tools">
          <button type="button" class="button button--primary" aria-expanded={showForm} aria-controls="new-program"
            onClick={() => setShowForm(!showForm)}>New program</button>
          <Link href="/director/audit" class="button button--secondary">Director actions</Link>
        </div>
      </header>
      {showForm ? (
        <form id="new-program" class="form-block form-grid" onSubmit={create} noValidate>
          <h2 class="section-title">New program</h2>
          <TextField id="program-name" label="Program name" value={form.name} onValue={set("name")} error={errors.name} />
          <TextField id="program-year" label="Year" type="number" min={2000} max={2100} value={form.year} onValue={set("year")} error={errors.year} />
          <SelectField id="program-zone" label="Time zone" value={form.timeZone} options={zones().map((z) => ({ value: z, label: z }))}
            onValue={set("timeZone")} error={errors.timeZone} />
          <TextField id="program-early-date" label="Early-bird ends" type="date" value={form.earlyBirdDate} onValue={set("earlyBirdDate")}
            error={errors.earlyBirdDate} />
          <TextField id="program-deadline" label="Entries close" type="date" value={form.deadlineDate} onValue={set("deadlineDate")}
            error={errors.deadlineDate} />
          <TextField id="program-early-fee" label="Early-bird fee" value={form.early} onValue={set("early")} error={errors.earlyBirdFeeCents}
            hint="In dollars, for example 45.00." />
          <TextField id="program-standard-fee" label="Standard fee" value={form.standard} onValue={set("standard")}
            error={errors.standardFeeCents} hint="In dollars, for example 70.00." />
          <div class="actions"><Submit busy={busy} label="Create program" pending="Creating program…" /></div>
        </form>
      ) : null}
      {programs === null ? <p class="loading">Loading…</p> : (
        <table class="list-table list-table--stack">
          <caption class="sr-only">Programs</caption>
          <thead><tr><th scope="col">Program</th><th scope="col" class="num">Year</th><th scope="col">Time zone</th><th scope="col">Entries close</th><th scope="col">Entries</th></tr></thead>
          <tbody>
            {programs.map((p) => (
              <tr key={p.id}>
                <td data-label="Program"><Link href={`/director/programs/${p.id}`}>{p.name}</Link></td>
                <td data-label="Year" class="num">{p.year}</td>
                <td data-label="Time zone">{p.timeZone}</td>
                <td data-label="Entries close">{p.deadlineLabel}</td>
                <td data-label="Entries">{p.entriesOpen ? "Open" : "Closed"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface Summary {
  categories: { id: string; name: string; counts: Record<string, number>; rounds: { id: string; name: string; state: string; panel: PanelRow[] }[] }[];
}

function ProgramPage({ id }: { id: string }) {
  const desk = useDesk();
  const run = useAction();
  const [data, setData] = useState<{ program: Program; summary: Summary; studios: { id: string; name: string }[] } | null>(null);
  const [dates, setDates] = useState({ earlyBirdDate: "", deadlineDate: "" });
  const [category, setCategory] = useState({ name: "", shortlistSize: "5", finalistCount: "3" });
  const [juror, setJuror] = useState({ name: "", email: "", password: "", studio: "None" });
  const [errors, setErrors] = useState<Record<string, FieldErrors>>({});
  const [busy, setBusy] = useState("");
  const load = async () => {
    const [list, summary, studios] = await Promise.all([programsList(), get<Summary>(`/api/programs/${id}/summary`),
      get<{ studios: { id: string; name: string }[] }>("/api/studios")]);
    const program = list.find((p) => p.id === id);
    if (!program || !summary.ok) return desk.fail(summary.ok ? "We couldn't find that." : summary.message);
    setData({ program, summary: summary.data, studios: studios.ok ? studios.data.studios : [] });
    setDates({ earlyBirdDate: program.earlyBirdDate, deadlineDate: program.deadlineDate });
  };
  useEffect(() => {
    void load();
  }, [id]);
  useBand(data ? { name: data.program.name, target: data.program.entriesOpen ? data.program.deadlineAt : null } : null);
  if (!data) return <p class="loading">Loading…</p>;
  const { program, summary } = data;

  const submit = (name: string, pending: string, call: () => ReturnType<typeof post>, copy: string, order: [string, string][]) =>
    async (event: Event) => {
      event.preventDefault();
      setBusy(name);
      const result = await run(pending, call, () => copy);
      setBusy("");
      setErrors({ ...errors, [name]: result.ok ? {} : result.fields });
      if (!result.ok) return focusFirstError(order, result.fields);
      await load();
      if (name === "category") setCategory({ name: "", shortlistSize: "5", finalistCount: "3" });
      if (name === "juror") setJuror({ name: "", email: "", password: "", studio: "None" });
    };
  const whole = (v: string) => (/^\d+$/.test(v) ? Number(v) : null);

  return (
    <div class="page">
      <header class="page-head">
        <p class="eyebrow">Program · {program.year} · {program.timeZone}</p>
        <h1 class="page-title">{program.name}</h1>
        <p class="deadline">Entries close {program.deadlineLabel} · Early-bird ends {program.earlyBirdLabel}</p>
      </header>

      <section class="director-categories" aria-labelledby="categories-title">
        <h2 id="categories-title" class="section-title">Categories</h2>
        <ul class="category-links">
          {program.categories.map((c: Category) => (
            <li key={c.id}>
              <Link href={`/director/categories/${c.id}`} class="category-links__name">{c.name}</Link>
              <span class="category-links__meta">Shortlist {c.shortlistSize} · Finalists {c.finalistCount}</span>
              {(c.rounds ?? []).map((r) => (
                <Link key={r.id} href={`/director/rounds/${r.id}`} class="category-links__round">{r.name} · {ROUND_STATE[r.state] ?? r.state}</Link>
              ))}
            </li>
          ))}
          {program.categories.length === 0 ? <li class="empty">No categories yet. Add the first one below.</li> : null}
        </ul>
      </section>

      <table class="list-table counts-table">
        <caption class="table-caption">Entries by state</caption>
        <thead><tr><th scope="col">State</th>{summary.categories.map((c) => <th key={c.id} scope="col" class="num">{c.name}</th>)}</tr></thead>
        <tbody>
          {ENTRY_STATES.map((state) => (
            <tr key={state}>
              <th scope="row">{STATE_NAMES[state]}</th>
              {summary.categories.map((c) => <td key={c.id} class="num">{c.counts[state] ?? 0}</td>)}
            </tr>
          ))}
        </tbody>
      </table>

      <div class="form-columns">
        <form class="form-block" noValidate onSubmit={submit("dates", "Updating dates…",
          () => patch(`/api/programs/${id}`, dates), "Dates updated.", [["earlyBirdDate", "dates-early"], ["deadlineDate", "dates-deadline"]])}>
          <h2 class="section-title">Dates</h2>
          <TextField id="dates-early" label="Early-bird ends" type="date" value={dates.earlyBirdDate}
            onValue={(v) => setDates({ ...dates, earlyBirdDate: v })} error={errors.dates?.earlyBirdDate} />
          <TextField id="dates-deadline" label="Entries close" type="date" value={dates.deadlineDate}
            onValue={(v) => setDates({ ...dates, deadlineDate: v })} error={errors.dates?.deadlineDate} />
          <div class="actions"><Submit busy={busy === "dates"} label="Update dates" pending="Updating dates…" /></div>
        </form>

        <form class="form-block" noValidate onSubmit={submit("category", "Adding category…",
          () => post(`/api/programs/${id}/categories`, { name: category.name, shortlistSize: whole(category.shortlistSize),
            finalistCount: whole(category.finalistCount) }), "Category added.",
          [["name", "category-name"], ["shortlistSize", "category-shortlist"], ["finalistCount", "category-finalists"]])}>
          <h2 class="section-title">Add category</h2>
          <TextField id="category-name" label="Category name" value={category.name} onValue={(v) => setCategory({ ...category, name: v })}
            error={errors.category?.name} />
          <TextField id="category-shortlist" label="Shortlist size" type="number" min={1} max={50} value={category.shortlistSize}
            onValue={(v) => setCategory({ ...category, shortlistSize: v })} error={errors.category?.shortlistSize} />
          <TextField id="category-finalists" label="Finalists" type="number" min={1} max={50} value={category.finalistCount}
            onValue={(v) => setCategory({ ...category, finalistCount: v })} error={errors.category?.finalistCount} />
          <div class="actions"><Submit busy={busy === "category"} label="Add category" pending="Adding category…" /></div>
        </form>

        <form class="form-block" noValidate onSubmit={submit("juror", "Creating juror…",
          () => post("/api/jurors", { name: juror.name, email: juror.email, password: juror.password,
            studioId: data.studios.find((s) => s.name === juror.studio)?.id ?? null }), "Juror account created.",
          [["name", "juror-name"], ["email", "juror-email"], ["password", "juror-password"], ["studioId", "juror-studio"]])}>
          <h2 class="section-title">New juror</h2>
          <TextField id="juror-name" label="Juror name" value={juror.name} onValue={(v) => setJuror({ ...juror, name: v })} error={errors.juror?.name} />
          <TextField id="juror-email" label="Juror email" type="email" value={juror.email} onValue={(v) => setJuror({ ...juror, email: v })}
            error={errors.juror?.email} />
          <TextField id="juror-password" label="Juror password" type="password" autoComplete="new-password" value={juror.password}
            onValue={(v) => setJuror({ ...juror, password: v })} error={errors.juror?.password} hint="At least 10 characters." />
          <SelectField id="juror-studio" label="Home studio" value={juror.studio} error={errors.juror?.studioId}
            options={[{ value: "None", label: "None" }, ...data.studios.map((s) => ({ value: s.name, label: s.name }))]}
            onValue={(v) => setJuror({ ...juror, studio: v })} />
          <div class="actions"><Submit busy={busy === "juror"} label="Create juror" pending="Creating juror…" /></div>
        </form>
      </div>
    </div>
  );
}

function CategoryPage({ id }: { id: string }) {
  const desk = useDesk();
  const run = useAction();
  const [data, setData] = useState<{ program: Program; category: Category; entries: Entry[] } | null>(null);
  const [target, setTarget] = useState<Entry | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [embargo, setEmbargo] = useState("");
  const [embargoError, setEmbargoError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState("");
  const disqualifyDialog = useDialog();
  const publishDialog = useDialog();
  const load = async () => {
    const [list, entries] = await Promise.all([programsList(), get<{ entries: Entry[] }>(`/api/categories/${id}/entries`)]);
    const program = list.find((p) => p.categories.some((c) => c.id === id));
    const category = program?.categories.find((c) => c.id === id);
    if (!program || !category || !entries.ok) return desk.fail(entries.ok ? "We couldn't find that." : entries.message);
    setData({ program, category, entries: entries.data.entries });
  };
  useEffect(() => {
    void load();
  }, [id]);
  useBand(data ? { name: data.category.name, target: null } : null);
  if (!data) return <p class="loading">Loading…</p>;
  const { program, category, entries } = data;

  const screen = async (entry: Entry, decision: "pass" | "disqualify") => {
    setBusy(`${decision}-${entry.id}`);
    const result = await run(decision === "pass" ? "Passing…" : "Disqualifying…",
      () => post(`/api/entries/${entry.id}/screen`, decision === "pass" ? { decision } : { decision, reason }));
    setBusy("");
    if (!result.ok) {
      if (decision === "disqualify" && result.fields.reason) {
        setReasonError(result.fields.reason);
        document.getElementById("disqualify-reason")?.focus();
        return;
      }
      if (decision === "disqualify") await disqualifyDialog.hide();
      return;
    }
    if (decision === "disqualify") await disqualifyDialog.hide();
    await load();
    desk.done(decision === "pass" ? `Entry ${entry.entryNumber} passed screening.` : `Entry ${entry.entryNumber} disqualified.`);
  };
  const reinstate = async (entry: Entry) => {
    setBusy(`reinstate-${entry.id}`);
    const result = await run("Reinstating…", () => post(`/api/entries/${entry.id}/reinstate`));
    setBusy("");
    if (!result.ok) return;
    await load();
    desk.done(`Entry ${entry.entryNumber} reinstated.`);
  };
  const publish = async () => {
    setBusy("publish");
    const result = await run("Publishing…", () => post<{ category: { embargoLabel: string } }>(`/api/categories/${id}/publish`,
      { embargoAt: zonedIso(embargo, program.timeZone) }));
    setBusy("");
    await publishDialog.hide();
    setEmbargoError(result.ok ? undefined : result.fields.embargoAt);
    if (!result.ok) return;
    await load();
    desk.done(`Results scheduled for ${result.data.category.embargoLabel}.`);
  };

  return (
    <div class="page">
      <header class="page-head">
        <p class="eyebrow"><Link href={`/director/programs/${program.id}`}>{program.name}</Link> · Shortlist {category.shortlistSize} · Finalists {category.finalistCount}</p>
        <h1 class="category-header">{category.name}</h1>
        <div class="page-head__tools">
          {(category.rounds ?? []).map((r) => (
            <Link key={r.id} href={`/director/rounds/${r.id}`} class="button button--secondary">{r.name} · {ROUND_STATE[r.state] ?? r.state}</Link>
          ))}
        </div>
      </header>
      <table class="list-table list-table--stack screening-table">
        <caption class="sr-only">Entries</caption>
        <thead>
          <tr><th scope="col" class="num">Entry</th><th scope="col">Title</th><th scope="col">Studio</th><th scope="col">Credits</th>
            <th scope="col">Status</th><th scope="col">Screening</th></tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td class="num" data-label="Entry">{entry.entryNumber}</td>
              <td data-label="Title"><span class="cell-strong">{entry.title}</span><span class="cell-meta">{entry.siteUrl}</span></td>
              <td data-label="Studio">{entry.studioName}<span class="cell-meta">{entry.studioEmail}</span></td>
              <td data-label="Credits">{entry.credits || "—"}</td>
              <td data-label="Status">
                {entry.state === "disqualified"
                  ? <span class="status-text status-text--out"><Icon name="x" />{entry.statusLabel}</span>
                  : <span class="status-text">{entry.statusLabel}</span>}
                {entry.disqualifyReason ? <span class="cell-meta">Reason: {entry.disqualifyReason}</span> : null}
              </td>
              <td data-label="Screening">
                <div class="row-actions">
                  {entryActionLegal(entry.state, "pass") ? (
                    <button type="button" class="button button--primary button--small" disabled={busy !== ""} aria-label={`Pass Entry ${entry.entryNumber}`}
                      onClick={() => void screen(entry, "pass")}>{busy === `pass-${entry.id}` ? "Passing…" : "Pass"}</button>
                  ) : null}
                  {entryActionLegal(entry.state, "disqualify") ? (
                    <button type="button" class="button button--danger-quiet button--small" aria-label={`Disqualify Entry ${entry.entryNumber}`}
                      onClick={() => {
                        setTarget(entry);
                        setReason("");
                        setReasonError(undefined);
                        disqualifyDialog.show();
                      }}>Disqualify</button>
                  ) : null}
                  {entryActionLegal(entry.state, "reinstate") ? (
                    <button type="button" class="button button--secondary button--small" disabled={busy !== ""}
                      aria-label={`Reinstate Entry ${entry.entryNumber}`} onClick={() => void reinstate(entry)}>
                      {busy === `reinstate-${entry.id}` ? "Reinstating…" : "Reinstate"}
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
          {entries.length === 0 ? <tr><td colSpan={6} class="empty">No submitted entries in this category yet.</td></tr> : null}
        </tbody>
      </table>

      <form class="form-block publish-form" noValidate onSubmit={(event) => {
        event.preventDefault();
        publishDialog.show();
      }}>
        <h2 class="section-title">Publish results</h2>
        <TextField id="publish-embargo" label={`Embargo time (${program.timeZone})`} value={embargo} onValue={setEmbargo} error={embargoError}
          hint={`Wall time in ${program.timeZone}, as YYYY-MM-DD HH:MM.`} />
        <div class="actions"><button type="submit" class="button button--primary">Publish results</button></div>
      </form>

      <Dialog title={`Disqualify Entry ${target?.entryNumber ?? ""}`} {...disqualifyDialog.props}>
        <TextField id="disqualify-reason" label="Reason" value={reason} onValue={setReason} error={reasonError} />
        <div class="actions">
          <button type="button" class="button button--danger" disabled={busy !== ""} onClick={() => target && void screen(target, "disqualify")}>
            {busy.startsWith("disqualify") ? "Disqualifying…" : "Disqualify"}
          </button>
          <button type="button" class="button button--secondary" data-safe onClick={disqualifyDialog.props.onClose}>Cancel</button>
        </div>
      </Dialog>
      <Dialog title={`Publish ${category.name} results?`} {...publishDialog.props}>
        <p>Results go public at {embargo || "the embargo time"} ({program.timeZone}). Each studio gets its results email then.</p>
        <div class="actions">
          <button type="button" class="button button--primary" disabled={busy === "publish"} onClick={() => void publish()}>
            {busy === "publish" ? "Publishing…" : "Publish"}
          </button>
          <button type="button" class="button button--secondary" data-safe onClick={publishDialog.props.onClose}>Cancel</button>
        </div>
      </Dialog>
    </div>
  );
}

function standingRows(standings: Standings): LedgerRow[] {
  return standings.rows.map((r) => ({
    key: r.entryId, rank: r.rank, entryNumber: r.entryNumber, title: r.title, meta: `Entry ${r.entryNumber}`,
    category: r.categoryName, score: r.score, cut: r.cut, award: r.award,
  }));
}

function RoundPage({ id }: { id: string }) {
  const desk = useDesk();
  const run = useAction();
  const [data, setData] = useState<{ round: Round; panel: PanelRow[]; standings: Standings; jurors: { id: string; name: string }[];
    categoryName: string } | null>(null);
  const [pick, setPick] = useState("");
  const [deadline, setDeadline] = useState("");
  const [deadlineError, setDeadlineError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState("");
  const ledger = useRef<Ledger | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const closeDialog = useDialog();
  const announce = (line: string) => {
    if (status.current) status.current.textContent = line;
  };

  const refresh = async () => {
    const [round, standings] = await Promise.all([get<{ round: Round; panel: PanelRow[] }>(`/api/rounds/${id}`),
      get<Standings>(`/api/rounds/${id}/standings`)]);
    if (!round.ok || !standings.ok) return null;
    setData((current) => (current ? { ...current, round: round.data.round, panel: round.data.panel, standings: standings.data } : current));
    void ledger.current?.update(standingRows(standings.data));
    return { round: round.data, standings: standings.data };
  };

  useEffect(() => {
    void (async () => {
      const [round, standings, jurors, list] = await Promise.all([get<{ round: Round; panel: PanelRow[] }>(`/api/rounds/${id}`),
        get<Standings>(`/api/rounds/${id}/standings`), get<{ jurors: { id: string; name: string }[] }>("/api/jurors"), programsList()]);
      if (!round.ok || !standings.ok) return desk.fail(round.ok ? (standings.ok ? "" : standings.message) : round.message);
      const categoryName = list.flatMap((p) => p.categories).find((c) => c.id === round.data.round.categoryId)?.name ?? "";
      setData({ round: round.data.round, panel: round.data.panel, standings: standings.data, jurors: jurors.ok ? jurors.data.jurors : [],
        categoryName });
    })();
  }, [id]);

  const open = data?.round.state === "open";
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [open]);

  useBand(data ? { name: `${data.categoryName} — ${data.round.name}`, target: open ? data.round.ballotDeadlineAt : null } : null);
  if (!data) return <p class="loading">Loading…</p>;
  const { round, panel, standings } = data;

  const addJuror = async (event: Event) => {
    event.preventDefault();
    const juror = data.jurors.find((j) => j.name === pick);
    setBusy("add");
    const result = await run("Adding juror…", () => post<{ panel: PanelRow[] }>(`/api/rounds/${id}/jurors`, { jurorId: juror?.id ?? null }),
      (body) => `${juror?.name ?? ""} added to the panel with ${body.panel.find((p) => p.jurorId === juror?.id)?.assigned ?? 0} entries.`);
    setBusy("");
    if (result.ok) {
      setData({ ...data, panel: result.data.panel });
      setPick("");
    }
  };
  const openRound = async (event: Event) => {
    event.preventDefault();
    setBusy("open");
    const result = await run("Opening round…", () => post(`/api/rounds/${id}/open`, { ballotDeadline: deadline }),
      () => `Round opened for ${panel.length} jurors.`);
    setBusy("");
    setDeadlineError(result.ok ? undefined : result.fields.ballotDeadline);
    if (result.ok) await refresh();
  };
  const closeRound = async () => {
    setBusy("close");
    const result = await run("Closing round…", () => post<{ standings: Standings }>(`/api/rounds/${id}/close`));
    setBusy("");
    await closeDialog.hide();
    if (!result.ok) return;
    await refresh();
    desk.done(`Round closed. Scores stored for ${result.data.standings.rows.length} entries.`);
  };
  const confirmStandings = async () => {
    setBusy("confirm");
    const result = await run("Confirming…", () => post<{ outcomes: { state: string }[] }>(`/api/rounds/${id}/confirm`));
    setBusy("");
    if (!result.ok) return;
    const after = await refresh();
    const rows = after?.standings.rows ?? [];
    desk.done(`Standings confirmed: ${rows.filter((r) => r.cut === "above").length} above the cut, ${rows.filter((r) => r.cut === "below").length} below.`);
  };

  return (
    <div class="page">
      <header class="page-head">
        <p class="eyebrow"><Link href={`/director/categories/${round.categoryId}`}>{data.categoryName}</Link> · {ROUND_STATE[round.state] ?? round.state}</p>
        <h1 class="page-title">{round.name}</h1>
        {round.ballotDeadlineLabel ? <p class="deadline">Ballots close {round.ballotDeadlineLabel}</p> : null}
      </header>

      <section class="round-panel" aria-labelledby="panel-title">
        <h2 id="panel-title" class="section-title">Panel</h2>
        {roundActionLegal(round.state, "add_juror") ? (
          <form class="inline-form" onSubmit={addJuror} noValidate>
            <SelectField id="panel-juror" label="Add juror" value={pick} onValue={setPick}
              options={[{ value: "", label: "Choose a juror" }, ...data.jurors.map((j) => ({ value: j.name, label: j.name }))]} />
            <Submit busy={busy === "add"} label="Add to panel" pending="Adding juror…" />
          </form>
        ) : null}
        <table class="list-table list-table--stack panel-table">
          <caption class="sr-only">Panel</caption>
          <thead><tr><th scope="col">Juror</th><th scope="col" class="num">Assigned</th><th scope="col" class="num">Scored</th>
            <th scope="col" class="num">Remaining</th><th scope="col">Ballot</th></tr></thead>
          <tbody>
            {panel.map((p) => (
              <tr key={p.jurorId}>
                <td data-label="Juror">{p.name}</td><td class="num" data-label="Assigned">{p.assigned}</td>
                <td class="num" data-label="Scored">{p.scored}</td><td class="num" data-label="Remaining">{p.remaining}</td>
                <td data-label="Ballot">{p.ballotSubmitted ? "Submitted" : "In progress"}</td>
              </tr>
            ))}
            {panel.length === 0 ? <tr><td colSpan={5} class="empty">No jurors yet. Add the panel before opening the round.</td></tr> : null}
          </tbody>
        </table>
      </section>

      <section class="round-actions" aria-labelledby="actions-title">
        <h2 id="actions-title" class="section-title">Round actions</h2>
        {roundActionLegal(round.state, "open") ? (
          <form class="inline-form" onSubmit={openRound} noValidate>
            <TextField id="ballot-deadline" label="Ballot deadline" type="date" value={deadline} onValue={setDeadline} error={deadlineError} />
            <Submit busy={busy === "open"} label="Open round" pending="Opening round…" />
          </form>
        ) : null}
        {roundActionLegal(round.state, "close") ? (
          <button type="button" class="button button--danger" onClick={closeDialog.show}>Close round</button>
        ) : null}
        {roundActionLegal(round.state, "confirm") ? (
          <button type="button" class="button button--primary" disabled={busy === "confirm"} aria-busy={busy === "confirm" || undefined}
            onClick={() => void confirmStandings()}>{busy === "confirm" ? "Confirming…" : "Confirm standings"}</button>
        ) : null}
      </section>

      <section class="round-standings" aria-labelledby="standings-title">
        <h2 id="standings-title" class="section-title">Standings</h2>
        {open ? <p class="provisional">Provisional</p> : null}
        <p ref={status} role="status" aria-live="polite" aria-label="Standings updates" class="standings-status" />
        <StandingsTable label="Standings" cutLabel={standings.cutLabel} cutCount={standings.cut} rows={standingRows(standings)}
          ledger={ledger} announce={announce} />
        {standings.rows.length === 0 ? <p class="empty">Standings appear once the round opens.</p> : null}
      </section>

      <Dialog title={`Close ${round.name}?`} {...closeDialog.props}>
        <p>Closing stores each entry's normalised score from the ballots submitted so far. Later ballots are refused.</p>
        <div class="actions">
          <button type="button" class="button button--danger" disabled={busy === "close"} onClick={() => void closeRound()}>
            {busy === "close" ? "Closing round…" : "Close round"}
          </button>
          <button type="button" class="button button--secondary" data-safe onClick={closeDialog.props.onClose}>Cancel</button>
        </div>
      </Dialog>
    </div>
  );
}

interface AuditEvent {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  at: string;
}

function AuditPage() {
  useBand({ name: "Director actions", target: null });
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  useEffect(() => {
    void get<{ events: AuditEvent[] }>("/api/audit").then((r) => setEvents(r.ok ? r.data.events : []));
  }, []);
  return (
    <div class="page">
      <header class="page-head">
        <p class="eyebrow">Director</p>
        <h1 class="page-title">Director actions</h1>
      </header>
      {events === null ? <p class="loading">Loading…</p> : (
        <table class="list-table list-table--stack">
          <caption class="sr-only">Director actions</caption>
          <thead><tr><th scope="col">Time</th><th scope="col">Action</th><th scope="col">Target</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td data-label="Time" class="num">{e.at.replace("T", " ").replace(/\.\d+Z$/, " UTC")}</td>
                <td data-label="Action"><code class="code">{e.action}</code></td>
                <td data-label="Target">{e.targetType} <span class="cell-meta mono-wrap">{e.targetId}</span></td>
              </tr>
            ))}
            {events.length === 0 ? <tr><td colSpan={3} class="empty">No director actions yet.</td></tr> : null}
          </tbody>
        </table>
      )}
    </div>
  );
}

export const DirectorHome = () => <RoleGate role="director"><HomePage /></RoleGate>;
export const DirectorProgram = ({ id }: { id: string }) => <RoleGate role="director"><ProgramPage id={id} /></RoleGate>;
export const DirectorCategory = ({ id }: { id: string }) => <RoleGate role="director"><CategoryPage id={id} /></RoleGate>;
export const DirectorRound = ({ id }: { id: string }) => <RoleGate role="director"><RoundPage id={id} /></RoleGate>;
export const DirectorAudit = () => <RoleGate role="director"><AuditPage /></RoleGate>;
