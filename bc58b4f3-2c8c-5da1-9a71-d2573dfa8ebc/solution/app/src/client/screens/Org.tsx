import { useCallback, useEffect, useState } from "react";
import { NetworkError, api } from "../api";
import { EmptyNote, LoadingRows } from "../components/EmptyNote";
import { Field } from "../components/Field";
import { Status, type StatusMessage, quiet } from "../components/Status";
import type { Scheduler } from "../types";

const UNREACHABLE: StatusMessage = { tone: "error", text: "Couldn't reach Teamseat. Try again." };

function Schedulers() {
  const [schedulers, setSchedulers] = useState<Scheduler[] | null>(null);
  const [draft, setDraft] = useState({ name: "", email: "", phone: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<StatusMessage>(quiet);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await api<{ schedulers: Scheduler[] }>("GET", "/api/org/schedulers");
    if (result.ok) setSchedulers(result.data.schedulers);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const set = (name: keyof typeof draft) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((current) => ({ ...current, [name]: event.target.value }));

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy("add");
    setErrors({});
    setMessage({ tone: "neutral", text: "Saving…" });
    try {
      const result = await api<Scheduler>("POST", "/api/org/schedulers", { json: draft });
      if (result.ok) {
        setMessage({ tone: "success", text: `${result.data.name} can now request interpreters.` });
        setDraft({ name: "", email: "", phone: "", password: "" });
        await load();
      } else if (result.error.code === "email_taken") {
        setErrors({ email: "That email is already in use." });
        setMessage({ tone: "error", text: "That email is already in use." });
      } else if (result.error.code === "validation") {
        setErrors(result.error.fields);
        setMessage({ tone: "error", text: `Check the highlighted fields. ${Object.values(result.error.fields).join(" ")}` });
      } else {
        setMessage({ tone: "error", text: result.error.message });
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      setMessage(UNREACHABLE);
    }
    setBusy(null);
  };

  const remove = async (scheduler: Scheduler) => {
    setBusy(scheduler.id);
    setMessage({ tone: "neutral", text: "Saving…" });
    try {
      const result = await api("DELETE", `/api/org/schedulers/${scheduler.id}`);
      setMessage(
        result.ok
          ? { tone: "success", text: `${scheduler.name} no longer has access.` }
          : { tone: "error", text: result.error.message },
      );
      await load();
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      setMessage(UNREACHABLE);
    }
    setBusy(null);
  };

  return (
    <section className="panel" aria-labelledby="schedulers-heading">
      <div className="list-head">
        <h2 id="schedulers-heading">Schedulers</h2>
        <p className="muted">People at your organisation who can request interpreters and see assignments.</p>
      </div>
      <Status name="Scheduler status" message={message} />
      <div className="org-layout">
        <div>
          <table className="table scheduler-table" aria-label="Schedulers" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Name</th>
                <th role="columnheader" scope="col">Email</th>
                <th role="columnheader" scope="col">Phone</th>
                <th role="columnheader" scope="col"><span className="visually-hidden">Action</span></th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {(schedulers ?? []).map((scheduler) => (
                <tr role="row" key={scheduler.id}>
                  <td role="cell" data-label="Name">{scheduler.name}</td>
                  <td role="cell" data-label="Email" className="cell-email">{scheduler.email}</td>
                  <td role="cell" data-label="Phone" className="num">{scheduler.phone}</td>
                  <td role="cell" data-label="Action">
                    <button
                      type="button"
                      className="button button-danger"
                      aria-label={`Remove ${scheduler.name}`}
                      disabled={busy === scheduler.id}
                      onClick={() => void remove(scheduler)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {schedulers === null ? <LoadingRows rows={2} /> : null}
          {schedulers?.length === 0 ? <EmptyNote>No schedulers yet. Add the first one with the form.</EmptyNote> : null}
        </div>
        <form className="form" aria-label="Add scheduler" noValidate onSubmit={(event) => void add(event)}>
          <h3>Add a scheduler</h3>
          <Field label="Name" error={errors.name}>
            {(props) => <input {...props} type="text" autoComplete="off" value={draft.name} onChange={set("name")} />}
          </Field>
          <Field label="Email" error={errors.email}>
            {(props) => <input {...props} type="email" autoComplete="off" value={draft.email} onChange={set("email")} />}
          </Field>
          <Field label="Phone" error={errors.phone}>
            {(props) => <input {...props} type="tel" autoComplete="off" value={draft.phone} onChange={set("phone")} />}
          </Field>
          <Field label="Initial password" hint="At least 12 characters" error={errors.password}>
            {(props) => <input {...props} type="text" autoComplete="new-password" value={draft.password} onChange={set("password")} />}
          </Field>
          <button type="submit" className="button button-primary" disabled={busy === "add"}>
            Add scheduler
          </button>
        </form>
      </div>
    </section>
  );
}

function Statement() {
  const [month, setMonth] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<StatusMessage>(quiet);
  const [busy, setBusy] = useState(false);

  const download = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setMessage({ tone: "neutral", text: "Preparing statement…" });
    try {
      const response = await fetch(`/api/org/statement?month=${encodeURIComponent(month.trim())}`, { credentials: "same-origin" });
      if (response.ok) {
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = `teamseat-statement-${month.trim()}.csv`;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setMessage({ tone: "success", text: `Statement for ${month.trim()} downloaded.` });
      } else {
        const body = (await response.json()) as { error?: { fields?: Record<string, string>; message?: string } };
        const text = body.error?.fields?.month ?? body.error?.message ?? "The statement could not be prepared.";
        setError(body.error?.fields?.month);
        setMessage({ tone: "error", text });
      }
    } catch {
      setMessage(UNREACHABLE);
    }
    setBusy(false);
  };

  return (
    <section className="panel" aria-labelledby="statement-heading">
      <h2 id="statement-heading">Monthly statement</h2>
      <p className="muted">A CSV of your organisation's posted charges for one month, matching the Kill Bill invoice items.</p>
      <form className="form form-inline" aria-label="Monthly statement" noValidate onSubmit={(event) => void download(event)}>
        <Field label="Month" hint="YYYY-MM" error={error}>
          {(props) => <input {...props} type="text" inputMode="numeric" placeholder="YYYY-MM" value={month} onChange={(e) => setMonth(e.target.value)} />}
        </Field>
        <button type="submit" className="button button-primary" disabled={busy}>
          Download statement
        </button>
      </form>
      <Status name="Statement status" message={message} />
    </section>
  );
}

export function Org() {
  return (
    <div className="stack">
      <Schedulers />
      <Statement />
    </div>
  );
}
