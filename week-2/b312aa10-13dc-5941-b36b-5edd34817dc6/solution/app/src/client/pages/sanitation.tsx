import { useEffect, useRef, useState } from "preact/hooks";
import { ApiFailure, del, get, post } from "../api.js";
import { context, useStore } from "../store.js";
import { Button, Empty, Field, NoteRow, focusFirstInvalid, useAction } from "../ui.js";
import type { InspectorLink, SanitationEntry, SanitationReport } from "../types.js";
import { SANITATION_AREAS } from "../../shared/format.js";
import { isoWithOffset, localStamp, monthName, zonedInstant } from "../../shared/time.js";

/** Form validation errors stay under their fields; everything else goes to the alert. */
function fieldsOf(form: HTMLFormElement | null, set: (e: Record<string, string>) => void) {
  return (error: unknown): boolean => {
    if (error instanceof ApiFailure && error.code === "validation_failed") {
      set(error.fieldErrors);
      focusFirstInvalid(form);
      return true;
    }
    set({});
    return false;
  };
}

export function SanitationScreen() {
  const ctx = useStore(context)!;
  const operator = ctx.session.user.role === "operator";
  const [entries, setEntries] = useState<SanitationEntry[] | null>(null);
  const loadEntries = (): void => {
    get<{ entries: SanitationEntry[] }>(`/api/sanitation-entries?month=${ctx.kitchen.currentMonth}`).then(({ data }) => setEntries(data.entries), () => setEntries([]));
  };
  useEffect(loadEntries, []);
  return (
    <div class="screen">
      <h1>Sanitation</h1>
      <div class="grid">
        <LogForm onLogged={loadEntries} />
        <section class="panel span-8">
          <h2>Sanitation log</h2>
          <p class="panel-note">{monthName(ctx.kitchen.currentMonth)}, newest first, in kitchen time ({ctx.kitchen.timeZone})</p>
          <LogTable entries={entries} empty="No sanitation entries this month." />
        </section>
        {operator && <MonthlyPdfs />}
        {operator && <InspectorLinks />}
      </div>
    </div>
  );
}

/** A date and time that may fall on two lines but never break inside either. */
function When({ text }: { text: string }) {
  return <>{text.split(" ").map((part, i) => <>{i > 0 && " "}<span class="when">{part}</span></>)}</>;
}

/** The sanitation log; `entries` is null while it loads. */
export function LogTable({ entries, empty }: { entries: SanitationEntry[] | null; empty: string }) {
  return (
    <table class="table" aria-label="Sanitation log">
      <thead><tr><th scope="col">Logged</th><th scope="col">Area</th><th scope="col">Task</th><th scope="col" class="num">Sanitizer ppm</th><th scope="col">Initials</th><th scope="col">Notes</th><th scope="col">Logged by</th></tr></thead>
      <tbody>
        {entries === null && <NoteRow columns={7}><p class="loading">Loading…</p></NoteRow>}
        {entries?.length === 0 && <NoteRow columns={7}><Empty>{empty}</Empty></NoteRow>}
        {entries?.map((e) => (
          <tr>
            <td data-label="Logged"><When text={`${e.localDate} ${e.localTime.slice(0, 5)}`} /></td>
            <td data-label="Area">{e.area}</td>
            <td data-label="Task" class="wrap">{e.task}</td>
            <td data-label="Sanitizer ppm" class="num">{e.sanitizerPpm ?? "—"}</td>
            <td data-label="Initials">{e.initials}</td>
            <td data-label="Notes" class="wrap">{e.notes}</td>
            <td data-label="Logged by">{e.loggedBy}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LogForm({ onLogged }: { onLogged: () => void }) {
  const [area, setArea] = useState("");
  const [task, setTask] = useState("");
  const [ppm, setPpm] = useState("");
  const [initials, setInitials] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  const { busy, run } = useAction();
  const submit = (e: Event): void => {
    e.preventDefault();
    const sanitizerPpm = ppm.trim() === "" ? null : /^\d+$/.test(ppm.trim()) ? Number(ppm) : ppm;
    void run("log", "Logging…", async () => {
      await post("/api/sanitation-entries", { area, task, sanitizerPpm, initials, notes });
      setErrors({});
      setTask("");
      setPpm("");
      setNotes("");
      onLogged();
      return "Logged.";
    }, fieldsOf(form.current, setErrors));
  };
  return (
    <section class="panel span-4">
      <h2>Log an entry</h2>
      <form ref={form} class="form" onSubmit={submit} noValidate>
        <Field label="Area" error={errors.area}>
          {(p) => (
            <select {...p} class="input" value={area} onChange={(e) => setArea(e.currentTarget.value)}>
              <option value="">Choose an area</option>
              {SANITATION_AREAS.map((a) => <option value={a}>{a}</option>)}
            </select>
          )}
        </Field>
        <Field label="Task" error={errors.task}>{(p) => <input {...p} class="input" type="text" value={task} onInput={(e) => setTask(e.currentTarget.value)} />}</Field>
        <div class="form-row">
          <Field label="Sanitizer ppm" error={errors.sanitizerPpm}>{(p) => <input {...p} class="input" type="number" min="0" max="400" value={ppm} onInput={(e) => setPpm(e.currentTarget.value)} />}</Field>
          <Field label="Initials" error={errors.initials}>{(p) => <input {...p} class="input" type="text" maxLength={4} value={initials} onInput={(e) => setInitials(e.currentTarget.value)} />}</Field>
        </div>
        <Field label="Notes" error={errors.notes}>{(p) => <textarea {...p} class="input" rows={2} value={notes} onInput={(e) => setNotes(e.currentTarget.value)} />}</Field>
        <div class="actions"><Button type="submit" variant="primary" busy={busy === "log"}>Log entry</Button></div>
      </form>
    </section>
  );
}

function MonthlyPdfs() {
  const ctx = useStore(context)!;
  const [month, setMonth] = useState(ctx.kitchen.currentMonth);
  const [reports, setReports] = useState<SanitationReport[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  const { busy, run } = useAction();
  const load = (): void => {
    get<{ reports: SanitationReport[] }>("/api/sanitation-reports").then(({ data }) => setReports(data.reports), () => setReports([]));
  };
  useEffect(load, []);
  const submit = (e: Event): void => {
    e.preventDefault();
    void run("pdf", "Saving PDF…", async () => {
      const { data } = await post<{ report: SanitationReport }>("/api/sanitation-reports", { month });
      setErrors({});
      load();
      const name = monthName(data.report.month);
      return data.report.status === "stored"
        ? `Sanitation PDF for ${name} saved.`
        : `Storage is unavailable. The sanitation PDF for ${name} is queued and will be saved when storage returns.`;
    }, fieldsOf(form.current, setErrors));
  };
  return (
    <section class="panel span-4">
      <h2>Monthly PDFs</h2>
      <form ref={form} class="form form-inline" onSubmit={submit} noValidate>
        <Field label="Report month" error={errors.month} hint="YYYY-MM">{(p) => <input {...p} class="input input-month" type="text" value={month} onInput={(e) => setMonth(e.currentTarget.value)} />}</Field>
        <div class="actions"><Button type="submit" variant="primary" busy={busy === "pdf"}>Generate monthly PDF</Button></div>
      </form>
      <table class="table" aria-label="Monthly PDFs">
        <thead><tr><th scope="col">Month</th><th scope="col">Status</th><th scope="col">File</th></tr></thead>
        <tbody>
          {reports === null && <NoteRow columns={3}><p class="loading">Loading…</p></NoteRow>}
          {reports?.length === 0 && <NoteRow columns={3}><Empty>No monthly PDFs saved yet.</Empty></NoteRow>}
          {reports?.map((r) => (
            <tr>
              <td data-label="Month">{monthName(r.month)}</td>
              <td data-label="Status">{r.status === "stored" ? "Saved" : "Queued"}</td>
              <td data-label="File">{r.storedAt ? <a href={`/api/sanitation-reports/${r.month}/file`}>Download PDF</a> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const LINKS_REFRESH_MS = 5000;
const STATUS: Record<InspectorLink["status"], string> = { active: "Active", expired: "Expired", revoked: "Revoked" };

function InspectorLinks() {
  const ctx = useStore(context)!;
  const zone = ctx.kitchen.timeZone;
  const [email, setEmail] = useState("");
  const [expires, setExpires] = useState("");
  const [links, setLinks] = useState<InspectorLink[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  const { busy, run } = useAction();
  // Reads are numbered: only the latest answer draws, and a read sent before one of the operator's
  // own link results arrived is discarded (so a revoked link never shows Active again).
  const issued = useRef(0);
  const drawn = useRef(0);
  const actionGen = useRef(0);
  const load = (): void => {
    const seq = ++issued.current;
    const gen = actionGen.current;
    get<{ links: InspectorLink[] }>("/api/inspector-links").then(({ data }) => {
      if (gen !== actionGen.current || seq < drawn.current) return;
      drawn.current = seq;
      setLinks(data.links);
    }, () => setLinks((current) => current ?? []));
  };
  /** An own link action's result arrived: earlier reads are stale, and the table reads again. */
  const afterAction = (): void => {
    actionGen.current += 1;
    load();
  };
  // While Sanitation is open the table re-reads the links every 5 seconds and redraws in place.
  useEffect(() => {
    load();
    const timer = setInterval(load, LINKS_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  const stamp = (iso: string): string => localStamp(Date.parse(iso), zone);
  const submit = (e: Event): void => {
    e.preventDefault();
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(expires.trim());
    const at = m ? zonedInstant(m[1]!, m[2]!, zone) : null;
    void run("send", "Sending…", async () => {
      const { data } = await post<{ link: InspectorLink }>("/api/inspector-links", { email, expiresAt: at === null ? expires : isoWithOffset(at, zone) });
      setErrors({});
      setEmail("");
      setExpires("");
      afterAction();
      return `Link sent to ${data.link.email}, active until ${stamp(data.link.expiresAt)}.`;
    }, fieldsOf(form.current, setErrors));
  };
  const revoke = (l: InspectorLink): void => {
    void run(`revoke-${l.id}`, "Revoking…", async () => {
      await del(`/api/inspector-links/${l.id}`);
      afterAction();
      return "Link revoked.";
    });
  };
  const regenerate = (l: InspectorLink): void => {
    void run(`regen-${l.id}`, "Sending…", async () => {
      await post(`/api/inspector-links/${l.id}/regenerate`);
      afterAction();
      return `New link sent to ${l.email}. The old link no longer works.`;
    });
  };
  return (
    <section class="panel span-8">
      <h2>Inspector links</h2>
      <form ref={form} class="form" onSubmit={submit} noValidate>
        <div class="form-row">
          <Field label="Inspector email" error={errors.email}>{(p) => <input {...p} class="input" type="text" inputMode="email" autoComplete="off" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />}</Field>
          <Field label="Link expires" error={errors.expiresAt} hint="YYYY-MM-DD HH:MM, kitchen time">{(p) => <input {...p} class="input" type="text" autoComplete="off" value={expires} onInput={(e) => setExpires(e.currentTarget.value)} />}</Field>
        </div>
        <div class="actions"><Button type="submit" variant="primary" busy={busy === "send"}>Send link</Button></div>
      </form>
      {/* The table and its headers stand from the first draw; rows arrive with the server's figures. */}
      <table class="table" aria-label="Inspector links" aria-busy={links === null ? "true" : undefined}>
        <thead><tr><th scope="col">Email</th><th scope="col">Expires</th><th scope="col">Status</th><th scope="col">Last opened</th><th scope="col">Views</th><th scope="col">Downloads</th><th scope="col">Actions</th></tr></thead>
        <tbody>
          {links === null && <NoteRow columns={7}><p class="loading">Loading…</p></NoteRow>}
          {links?.length === 0 && <NoteRow columns={7}><Empty>No inspector links sent yet.</Empty></NoteRow>}
          {links?.map((l) => (
            <tr key={l.id}>
              <td data-label="Email" class="email">{l.email.split("@").map((part, i) => <>{i > 0 && <>@<wbr /></>}{part}</>)}</td>
              <td data-label="Expires"><When text={stamp(l.expiresAt)} /></td>
              <td data-label="Status">{STATUS[l.status]}</td>
              <td data-label="Last opened"><When text={l.lastAccessAt ? stamp(l.lastAccessAt) : "Never"} /></td>
              <td data-label="Views" class="num">{l.views}</td>
              <td data-label="Downloads" class="num">{l.downloads}</td>
              <td data-label="Actions">
                {l.status !== "revoked" && (
                  <div class="row-actions">
                    <Button busy={busy === `revoke-${l.id}`} aria-label={`Revoke link for ${l.email}`} onClick={() => revoke(l)}>Revoke</Button>
                    <Button busy={busy === `regen-${l.id}`} aria-label={`Regenerate link for ${l.email}`} onClick={() => regenerate(l)}>Regenerate</Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
