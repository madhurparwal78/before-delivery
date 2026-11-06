import { CalendarPlus, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ROLE_LABELS, TRADES, TRADE_LABELS, type Member, type Recurrence, type Visit, type VisitOccurrence, type Weekday } from "../../shared/domain";
import { useAnnounce } from "../activity";
import { ApiFailure, api } from "../api";
import { Dialog } from "../components/Dialog";
import { ErrorSummary, FieldError, type FieldProblem } from "../components/ErrorSummary";
import { COPY } from "../copy";
import { localStamp } from "../time";
import { useJob } from "./context";

type Errors = Record<string, string>;

function problemsOf(errors: Errors, ids: Record<string, string>): FieldProblem[] {
  return Object.entries(errors).map(([field, message]) => ({ target: ids[field] ?? Object.values(ids)[0]!, message }));
}

const PERSON_IDS = { name: "person-name", email: "person-email", phone: "person-phone", role: "person-role", trade: "person-trade", initial_password: "person-password" };

function AddPerson({ disabled, onAdded }: { disabled: boolean; onAdded: () => void }) {
  const { job } = useJob();
  const announce = useAnnounce();
  const blank = { name: "", email: "", phone: "", role: "lead", trade: "", initial_password: "" };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof blank) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    announce(COPY.saving);
    try {
      await api<Member>("POST", `/api/jobs/${job.id}/members`, {
        name: form.name,
        email: form.email,
        phone: form.phone || null,
        role: form.role,
        trade: form.role === "trade" ? form.trade || null : null,
        initial_password: form.initial_password || undefined,
      });
      setForm(blank);
      setErrors({});
      setOpen(false);
      announce("Person added.");
      onAdded();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setErrors(error.body.fields ?? {});
        announce(error.message);
      } else announce("Adding a person needs a connection.");
    } finally {
      setPending(false);
    }
  };

  const field = (key: keyof typeof blank, label: string, type = "text", hint?: string) => (
    <div className="field">
      <label htmlFor={PERSON_IDS[key]}>{label}</label>
      <input
        id={PERSON_IDS[key]}
        className="input"
        type={type}
        value={form[key]}
        onChange={set(key)}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={hint ? `${PERSON_IDS[key]}-hint` : undefined}
      />
      {hint && (
        <p className="hint" id={`${PERSON_IDS[key]}-hint`}>
          {hint}
        </p>
      )}
      <FieldError id={`${PERSON_IDS[key]}-error`} message={errors[key]} />
    </div>
  );

  return (
    <>
      <button type="button" className="btn btn--primary" disabled={disabled} onClick={() => setOpen(true)}>
        <UserPlus size={16} aria-hidden="true" />
        Add person
      </button>
      <Dialog open={open} title="Add person" onClose={() => setOpen(false)}>
        <form className="stack" onSubmit={submit} noValidate>
          <ErrorSummary problems={problemsOf(errors, PERSON_IDS)} />
          {field("name", "Name")}
          {field("email", "Email", "email")}
          {field("phone", "Phone", "tel")}
          <div className="field">
            <label htmlFor={PERSON_IDS.role}>Role</label>
            <select id={PERSON_IDS.role} className="input" value={form.role} onChange={set("role")}>
              <option value="lead">Lead carpenter</option>
              <option value="trade">Trade</option>
              <option value="homeowner">Homeowner</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={PERSON_IDS.trade}>Trade</label>
            <select id={PERSON_IDS.trade} className="input" value={form.trade} onChange={set("trade")} disabled={form.role !== "trade"} aria-invalid={errors.trade ? true : undefined}>
              <option value="">Choose a trade</option>
              {TRADES.map((trade) => (
                <option key={trade} value={trade}>
                  {TRADE_LABELS[trade]}
                </option>
              ))}
            </select>
            <FieldError id="person-trade-error" message={errors.trade} />
          </div>
          {field("initial_password", "Initial password", "text", "Needed only for someone new to Snaglight: 10 to 200 characters. Share it with them yourself.")}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={pending} aria-busy={pending}>
              Add
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function EndRole({ member, onEnded }: { member: Member; onEnded: () => void }) {
  const { job, online } = useJob();
  const announce = useAnnounce();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const end = async () => {
    announce(COPY.saving);
    try {
      await api("DELETE", `/api/jobs/${job.id}/members/${member.id}`);
      setOpen(false);
      announce(`Role ended for ${member.name}.`);
      onEnded();
    } catch (failure) {
      const message = failure instanceof ApiFailure ? failure.message : "Ending a role needs a connection.";
      setError(message);
      announce(message);
    }
  };
  return (
    <>
      <button type="button" className="btn btn--small" disabled={!online} onClick={() => setOpen(true)} aria-label={`End role for ${member.name}`}>
        End role
      </button>
      <Dialog open={open} title="End role" onClose={() => setOpen(false)}>
        <p>
          {member.name} loses access to {job.name} at their next request: open tabs clear the house codes, their site visits are deleted
          and they get no more email for this job.
        </p>
        {error && <p className="form-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void end()}>
            End role
          </button>
        </div>
      </Dialog>
    </>
  );
}

const VISIT_IDS = { member_id: "visit-person", starts_at: "visit-starts", ends_at: "visit-ends", recurrence: "visit-repeats" };
const WEEKDAYS: Array<[Weekday, string]> = [
  ["MO", "Mon"],
  ["TU", "Tue"],
  ["WE", "Wed"],
  ["TH", "Thu"],
  ["FR", "Fri"],
  ["SA", "Sat"],
  ["SU", "Sun"],
];

interface ScheduleForm {
  member_id: string;
  starts_at: string;
  ends_at: string;
  repeats: "none" | Recurrence["freq"];
  weekdays: Weekday[];
  interval: string;
  ends: "until" | "count";
  until: string;
  count: string;
}

const BLANK_SCHEDULE: ScheduleForm = {
  member_id: "",
  starts_at: "",
  ends_at: "",
  repeats: "none",
  weekdays: [],
  interval: "2",
  ends: "count",
  until: "",
  count: "",
};

/** A job-local datetime field's value as the API reads it (`YYYY-MM-DDTHH:MM`). */
function localValue(text: string): string {
  return text.trim().replace(" ", "T");
}

/** The recurrence rule as the form describes it; the server judges it. */
function recurrenceOf(form: ScheduleForm): Record<string, unknown> | null {
  if (form.repeats === "none") return null;
  const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);
  return {
    freq: form.repeats,
    ...(form.repeats === "weekly" ? { weekdays: form.weekdays } : {}),
    ...(form.repeats === "every_n_days" ? { interval: whole(form.interval) } : {}),
    until: form.ends === "until" ? form.until || null : null,
    count: form.ends === "count" ? whole(form.count) : null,
  };
}

function ScheduleVisit({ trades, onSaved }: { trades: Member[]; onSaved: () => void }) {
  const { job, online, readOnly } = useJob();
  const announce = useAnnounce();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ScheduleForm>(BLANK_SCHEDULE);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const set = <K extends keyof ScheduleForm>(key: K, value: ScheduleForm[K]) => setForm({ ...form, [key]: value });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    announce(COPY.saving);
    try {
      await api<Visit>("POST", `/api/jobs/${job.id}/visits`, {
        member_id: form.member_id || trades[0]?.id || null,
        starts_at: localValue(form.starts_at),
        ends_at: localValue(form.ends_at),
        recurrence: recurrenceOf(form),
      });
      setErrors({});
      setOpen(false);
      setForm(BLANK_SCHEDULE);
      announce("Visit scheduled.");
      onSaved();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setErrors(error.body.fields ?? {});
        announce(error.message);
      } else announce("Scheduling a visit needs a connection.");
    } finally {
      setPending(false);
    }
  };
  const repeating = form.repeats !== "none";
  return (
    <>
      <button type="button" className="btn btn--primary" disabled={!online || readOnly} onClick={() => setOpen(true)}>
        <CalendarPlus size={16} aria-hidden="true" />
        Schedule visit
      </button>
      <Dialog open={open} title="Schedule visit" onClose={() => setOpen(false)}>
        <form className="stack" onSubmit={submit} noValidate>
          <ErrorSummary problems={problemsOf(errors, VISIT_IDS)} />
          <div className="field">
            <label htmlFor={VISIT_IDS.member_id}>Person</label>
            <select id={VISIT_IDS.member_id} className="input" value={form.member_id || trades[0]?.id || ""} onChange={(e) => set("member_id", e.target.value)}>
              {trades.map((member) => (
                <option key={member.id} value={member.id} label={member.name}>
                  {member.name}
                </option>
              ))}
            </select>
            <FieldError id="visit-person-error" message={errors.member_id} />
          </div>
          <p className="hint">Times are in the job's time zone, {job.time_zone}, between 07:00 and 19:00 on one day.</p>
          <div className="field-pair">
            {(["starts_at", "ends_at"] as const).map((key) => (
              <div className="field" key={key}>
                <label htmlFor={VISIT_IDS[key]}>{key === "starts_at" ? "Starts" : "Ends"}</label>
                <input
                  id={VISIT_IDS[key]}
                  className="input mono"
                  type="datetime-local"
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                  aria-invalid={errors[key] ? true : undefined}
                />
                <FieldError id={`${VISIT_IDS[key]}-error`} message={errors[key]} />
              </div>
            ))}
          </div>
          <div className="field">
            <label htmlFor={VISIT_IDS.recurrence}>Repeats</label>
            <select id={VISIT_IDS.recurrence} className="input" value={form.repeats} onChange={(e) => set("repeats", e.target.value as ScheduleForm["repeats"])}>
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="every_n_days">Every N days</option>
            </select>
            <FieldError id="visit-repeats-error" message={errors.recurrence} />
          </div>
          {form.repeats === "weekly" && (
            <fieldset className="fieldset">
              <legend>On these days</legend>
              <div className="checks checks--row">
                {WEEKDAYS.map(([day, label]) => (
                  <label key={day} className="check">
                    <input
                      type="checkbox"
                      checked={form.weekdays.includes(day)}
                      onChange={(e) => set("weekdays", e.target.checked ? [...form.weekdays, day] : form.weekdays.filter((d) => d !== day))}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {form.repeats === "every_n_days" && (
            <div className="field">
              <label htmlFor="visit-interval">Every how many days</label>
              <input id="visit-interval" className="input mono" inputMode="numeric" value={form.interval} onChange={(e) => set("interval", e.target.value)} />
            </div>
          )}
          {repeating && (
            <div className="field-pair">
              <div className="field">
                <label htmlFor="visit-ends-rule">Ends</label>
                <select id="visit-ends-rule" className="input" value={form.ends} onChange={(e) => set("ends", e.target.value as ScheduleForm["ends"])}>
                  <option value="until">On date</option>
                  <option value="count">After count</option>
                </select>
              </div>
              {form.ends === "until" ? (
                <div className="field">
                  <label htmlFor="visit-until">End date</label>
                  <input id="visit-until" className="input mono" type="date" value={form.until} onChange={(e) => set("until", e.target.value)} />
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="visit-count">Occurrences</label>
                  <input id="visit-count" className="input mono" inputMode="numeric" value={form.count} onChange={(e) => set("count", e.target.value)} />
                </div>
              )}
            </div>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={pending} aria-busy={pending}>
              Save visit
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

const MOVE_IDS = { starts_at: "move-starts", ends_at: "move-ends" };

function MoveVisit({ visit, occurrence, onSaved }: { visit: Visit; occurrence: VisitOccurrence; onSaved: () => void }) {
  const { job, online } = useJob();
  const announce = useAnnounce();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ starts_at: "", ends_at: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const starts = localStamp(occurrence.starts_at);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    announce(COPY.saving);
    try {
      await api<Visit>("PUT", `/api/jobs/${job.id}/visits/${visit.id}/occurrences/${occurrence.date}`, {
        starts_at: localValue(form.starts_at),
        ends_at: localValue(form.ends_at),
      });
      setErrors({});
      setOpen(false);
      announce("Visit moved.");
      onSaved();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setErrors(error.body.fields ?? {});
        announce(error.message);
      } else announce("Moving a visit needs a connection.");
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="btn btn--small"
        disabled={!online}
        onClick={() => {
          setForm({ starts_at: occurrence.starts_at.slice(0, 16), ends_at: occurrence.ends_at.slice(0, 16) });
          setErrors({});
          setOpen(true);
        }}
      >
        Move visit on {starts}
      </button>
      <Dialog open={open} title="Move visit" onClose={() => setOpen(false)}>
        <form className="stack" onSubmit={submit} noValidate>
          <ErrorSummary problems={problemsOf(errors, MOVE_IDS)} />
          <p className="hint">
            {visit.member_name}'s visit on <span className="mono">{starts}</span>, in {job.time_zone} time.
          </p>
          <div className="field-pair">
            {(["starts_at", "ends_at"] as const).map((key) => (
              <div className="field" key={key}>
                <label htmlFor={MOVE_IDS[key]}>{key === "starts_at" ? "Starts" : "Ends"}</label>
                <input
                  id={MOVE_IDS[key]}
                  className="input mono"
                  type="datetime-local"
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  aria-invalid={errors[key] ? true : undefined}
                />
                <FieldError id={`${MOVE_IDS[key]}-error`} message={errors[key]} />
              </div>
            ))}
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={pending} aria-busy={pending}>
              Move visit
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

const STATUS_TEXT: Record<VisitOccurrence["status"], string> = { scheduled: "Scheduled", moved: "Moved", cancelled: "Cancelled" };

export function PeopleTab() {
  const { session, job, role, online, readOnly } = useJob();
  const announce = useAnnounce();
  const [members, setMembers] = useState<Member[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const owner = role === "owner";

  const load = useCallback(async () => {
    try {
      const [{ members: people }, { visits: scheduled }] = await Promise.all([
        api<{ members: Member[] }>("GET", `/api/jobs/${job.id}/members`),
        api<{ visits: Visit[] }>("GET", `/api/jobs/${job.id}/visits`),
      ]);
      setMembers(people);
      setVisits(scheduled);
    } catch (error) {
      if (!(error instanceof ApiFailure)) announce("People and visits need a connection to load.");
    }
  }, [job.id, announce]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => session.watch("visits", () => void load()), [session, load]);

  const change = async (work: () => Promise<unknown>, success: string, offline: string) => {
    announce(COPY.saving);
    try {
      await work();
      announce(success);
      void load();
    } catch (error) {
      announce(error instanceof ApiFailure ? error.message : offline);
    }
  };

  const occurrences = visits
    .flatMap((visit) => visit.occurrences.map((occurrence, index) => ({ visit, occurrence, first: index === 0 })))
    .sort((a, b) => a.occurrence.starts_at_utc.localeCompare(b.occurrence.starts_at_utc) || a.occurrence.starts_at.localeCompare(b.occurrence.starts_at));

  return (
    <div className="panel">
      <section className="panel-section" aria-labelledby="people-heading">
        <div className="panel-head">
          <h2 id="people-heading">People</h2>
          {owner && <AddPerson disabled={!online || readOnly} onAdded={() => void load()} />}
        </div>
        <div className="table-wrap">
          <table aria-label="People">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Trade</th>
                <th scope="col">Email</th>
                <th scope="col">Phone</th>
                {owner && <th scope="col"><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td className="wrap">{member.name}</td>
                  <td>{ROLE_LABELS[member.role]}</td>
                  <td>{member.trade ? TRADE_LABELS[member.trade] : "—"}</td>
                  <td className="wrap">{member.email}</td>
                  <td className="mono">{member.phone ?? "—"}</td>
                  {owner && <td>{member.role !== "owner" && !readOnly && <EndRole member={member} onEnded={() => void load()} />}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel-section" aria-labelledby="visits-heading">
        <div className="panel-head">
          <h2 id="visits-heading">Site visits</h2>
          <ScheduleVisit trades={members.filter((member) => member.role === "trade")} onSaved={() => void load()} />
        </div>
        {visits.length === 0 && <p className="muted">No site visits scheduled.</p>}
        <div className="table-wrap">
          <table aria-label="Site visits">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Starts</th>
                <th scope="col">Ends</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {occurrences.map(({ visit, occurrence, first }) => {
                const starts = localStamp(occurrence.starts_at);
                const original = `${occurrence.date} ${visit.starts_at.slice(11, 16)}`;
                return (
                  <tr key={`${visit.id}-${occurrence.date}`} className={occurrence.status === "cancelled" ? "is-cancelled" : undefined}>
                    <td className="wrap">{visit.member_name}</td>
                    <td className="mono">{starts}</td>
                    <td className="mono">{localStamp(occurrence.ends_at)}</td>
                    <td>{STATUS_TEXT[occurrence.status]}</td>
                    <td>
                      {!readOnly && (
                        <div className="cell-actions">
                          {occurrence.status !== "cancelled" && (
                            <>
                              <MoveVisit visit={visit} occurrence={occurrence} onSaved={() => void load()} />
                              <button
                                type="button"
                                className="btn btn--small"
                                disabled={!online}
                                onClick={() =>
                                  void change(
                                    () => api("DELETE", `/api/jobs/${job.id}/visits/${visit.id}/occurrences/${occurrence.date}`),
                                    "Visit cancelled.",
                                    "Cancelling a visit needs a connection.",
                                  )
                                }
                              >
                                Cancel visit on {starts}
                              </button>
                            </>
                          )}
                          {first && (
                            <button
                              type="button"
                              className="btn btn--small"
                              disabled={!online}
                              onClick={() =>
                                void change(() => api("DELETE", `/api/jobs/${job.id}/visits/${visit.id}`), "Visit deleted.", "Deleting a visit needs a connection.")
                              }
                            >
                              Delete visit on {occurrence.status === "moved" ? original : starts}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
