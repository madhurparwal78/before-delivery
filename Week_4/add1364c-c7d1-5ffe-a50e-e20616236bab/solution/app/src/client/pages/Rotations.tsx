import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, get, post } from "../lib/api";
import { useTitle } from "../lib/hooks";
import { monthLabel, officeDate, officeStamp, shiftMonth, validMonth } from "../lib/office";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import type { CalendarDay, CalendarEntry, Credential, Rotation, Vault } from "../lib/types";
import { Dialog } from "../ui/Dialog";
import { Field, SubmitButton, useFieldErrors, useOnce } from "../ui/Field";
import { vendorText } from "./Slip";

const STATE_WORDS: Record<CalendarEntry["state"], string> = { scheduled: "Scheduled", due: "Due", overdue: "Overdue", turned: "Turned" };

export function Rotations() {
  useTitle("Rotation calendar");
  const { me, office, say, bumpAudit } = useStore();
  const { location, navigate } = useRouter();
  const requested = new URLSearchParams(location.search).get("month");
  const month = validMonth(requested) ? requested : null;
  const [days, setDays] = useState<CalendarDay[] | null>(null);
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState(false);
  const wanted = useRef<string | null>(null);
  const [options, setOptions] = useState<{ id: string; text: string }[] | null>(null);

  useEffect(() => {
    if (me?.role !== "office_manager") return;
    let live = true;
    (async () => {
      const list = await get<{ vaults: Vault[] }>("/api/vaults");
      const details = await Promise.all(list.vaults.map((vault) => get<{ credentials: Credential[] }>(`/api/vaults/${vault.id}`)));
      if (live) setOptions(details.flatMap((body) => body.credentials.map((c) => ({ id: c.id, text: `${c.label} (${c.vendor.name})` }))));
    })().catch(() => undefined);
    return () => { live = false; };
  }, [me?.role]);

  useEffect(() => {
    if (month || !office) return;
    navigate(`/rotations?month=${office.date.slice(0, 7)}`, true);
  }, [month, office, navigate]);

  const load = useCallback(async (m: string) => {
    wanted.current = m;
    try {
      const body = await get<{ month: string; days: CalendarDay[] }>(`/api/rotations/calendar?month=${m}`);
      if (wanted.current !== m) return;
      setDays(body.days);
      const ids = new Set<string>();
      for (const d of body.days) for (const e of d.entries) if (e.shifted && e.rotation_id) ids.add(e.rotation_id);
      const found: Record<string, string> = {};
      await Promise.all([...ids].map(async (id) => {
        try { found[id] = (await get<Rotation>(`/api/rotations/${id}`)).at_time; } catch { /* label falls back */ }
      }));
      if (wanted.current === m) setOriginal(found);
    } catch { /* leaves the previous month on screen */ }
  }, []);

  useEffect(() => { if (month) { setDays(null); void load(month); } }, [month, load]);

  const go = (target: string) => navigate(`/rotations?month=${target}`);
  const canSchedule = me?.role === "office_manager";

  return (
    <div className="folder-page">
      <section className="folder band-0">
        <header className="folder-title">
          <h1>Rotation calendar</h1>
          <div className="month-nav">
            <button type="button" className="btn btn-quiet" onClick={() => month && go(shiftMonth(month, -1))}>Previous month</button>
            <span className="month-label fig">{month ? monthLabel(month) : ""}</span>
            <button type="button" className="btn btn-quiet" onClick={() => month && go(shiftMonth(month, 1))}>Next month</button>
            {canSchedule ? <button type="button" className="btn btn-solid btn-cut" disabled={options === null} onClick={() => setDialog(true)}>Schedule rotation</button> : null}
          </div>
        </header>
        <ul className="days" aria-label="Office days">
          {(days ?? []).map((day) => (
            <li className="day" key={day.office_date}>
              <div className="day-label"><strong className="fig">{officeDate(day.office_date)}</strong> <span className="fig">{day.offset}</span></div>
              <div className="day-entries">
                {day.entries.map((e) => (
                  <div className="run" key={`${e.turn_id ?? e.rotation_id ?? e.credential_id}-${e.kind}`}>
                    <strong>{e.label}</strong>
                    <span>{vendorText(e.vendor)}</span>
                    <span className="fig">{e.kind === "scope_loss" ? `Turn due after access loss, by ${officeDate(e.due_by)}` : `${e.office_time ?? ""} ${e.offset}`}</span>
                    <span className="health"><span>{STATE_WORDS[e.state]}</span></span>
                    {e.shifted && e.rotation_id ? <span className="note">Moved from {original[e.rotation_id] ?? "the scheduled time"}: the clocks skip that hour.</span> : null}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
      {dialog && options ? <ScheduleDialog options={options} onClose={() => setDialog(false)} onSaved={(r) => {
        const first = r.next_runs[0];
        say(first ? `Rotation scheduled. Next turn ${officeStamp(first.office_date, first.office_time, first.offset)}.` : "Rotation scheduled.");
        bumpAudit();
        if (month) void load(month);
      }} /> : null}
    </div>
  );
}

function ScheduleDialog({ options, onClose, onSaved }: { options: { id: string; text: string }[]; onClose: () => void; onSaved: (r: Rotation) => void }) {
  const { warn, office } = useStore();
  const [login, setLogin] = useState(options[0]?.id ?? "");
  const [every, setEvery] = useState("90");
  const [time, setTime] = useState("09:00");
  const [first, setFirst] = useState(office?.date ?? "");
  const { errors, setErrors, formRef } = useFieldErrors();
  const { pending, run } = useOnce();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      try {
        const made = await post<Rotation>("/api/rotations", { credential_id: login, interval_days: every.trim() === "" ? every : Number(every), at_time: time, first_run_on: first });
        onSaved(made);
        onClose();
      } catch (error) {
        if (!(error instanceof ApiError)) return;
        if (error.code === "rotation_exists") { warn(error.message); return; }
        warn("Check the highlighted fields.");
        const map: Record<string, string> = { credential_id: "login", interval_days: "every", at_time: "time", first_run_on: "first" };
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(error.fields)) next[map[k] ?? k] = v;
        setErrors(next);
      }
    });
  };

  return (
    <Dialog label="Schedule rotation" onClose={onClose} onSubmit={submit} formRef={formRef}>
      <Field label="Login" error={errors.login}>
        {(p) => (
          <select {...p} value={login} onChange={(e) => setLogin(e.target.value)}>
            {options.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
          </select>
        )}
      </Field>
      <Field label="Every (days)" error={errors.every}>{(p) => <input {...p} type="number" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} />}</Field>
      <Field label="Office time" error={errors.time}>{(p) => <input {...p} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
      <Field label="First run on" error={errors.first}>{(p) => <input {...p} type="date" value={first} onChange={(e) => setFirst(e.target.value)} />}</Field>
      <div className="dialog-actions">
        <SubmitButton pending={pending} pendingText="Saving">Save schedule</SubmitButton>
        <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}
