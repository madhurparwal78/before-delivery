// Settings (owner): the working calendar, seats and billing, members, and invites.
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { api, ApiFailure, get, type Billing, type Holiday, type Invite, type Person, type Workspace } from "../api";
import { Panes } from "../components/Panes";
import { NotFound, SheetHeader, TitleBlock } from "../components/Sheet";
import { isRealDate, showDate } from "../format";
import { useServices } from "../services";
import { navigate, useLocation } from "../router";
import { useApp } from "../store";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SECTIONS = [
  { id: "calendar", label: "Working calendar" },
  { id: "seats", label: "Seats and billing" },
  { id: "people", label: "Members" },
  { id: "invites", label: "Invites" },
  { id: "password", label: "Password" },
];

export function SettingsModule(props: { rest: string[] }): JSX.Element {
  const location = useLocation();
  const app = useApp();
  const section = (location.state as { section?: string } | null)?.section;
  useEffect(() => {
    if (section) document.getElementById(section)?.scrollIntoView({ block: "start" });
  }, [section]);
  if (props.rest.length > 0) return <Panes list={null} detail={<NotFound back="/settings" />} detailFirst detailKey="settings-missing" />;
  const list = (
    <nav className="settings-index" aria-label="Settings sections">
      <h2 className="list-heading">Settings</h2>
      <ul>
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} className="channel-link" onClick={(e) => (e.preventDefault(), navigate("/settings", { state: { pane: "detail", section: s.id } }))}>
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
  const detail = (
    <div className="sheet settings-sheet">
      <SheetHeader back="/settings" />
      <TitleBlock name={app.workspace.name} state="Owner settings" changed={app.workspace.today} />
      <h1>Settings</h1>
      <CalendarSection />
      <SeatsSection />
      <PeopleSection />
      <PasswordSection />
    </div>
  );
  return <Panes list={list} detail={detail} detailFirst detailKey="settings" />;
}

export function AccountModule(props: { rest: string[] }): JSX.Element {
  const app = useApp();
  if (props.rest.length > 0) return <Panes list={null} detail={<NotFound back="/account" />} detailFirst detailKey="account-missing" />;
  const list = (
    <div className="settings-index">
      <h2 className="list-heading">Account</h2>
      <p className="list-empty">{app.person.email}</p>
    </div>
  );
  const detail = (
    <div className="sheet settings-sheet">
      <SheetHeader back="/account" />
      <TitleBlock name={app.person.name} state={app.person.role ?? ""} changed={app.workspace.today} />
      <h1>Account</h1>
      <PasswordSection />
    </div>
  );
  return <Panes list={list} detail={detail} detailFirst detailKey="account" />;
}

function PasswordSection(): JSX.Element {
  const app = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  const change = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    app.announce("Changing password");
    try {
      await api("POST", "/api/account/password", { current_password: current, new_password: next });
      setCurrent("");
      setNext("");
      app.announce("Password changed. Other devices were signed out.");
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "invalid_credentials") app.announce("That current password isn't right.");
      else if (error instanceof ApiFailure && error.code === "validation") app.announce("Use 8 to 128 characters.");
      else app.announce("");
    }
  };

  return (
    <section id="password" className="settings-section" aria-labelledby="password-heading">
      <h2 id="password-heading">Password</h2>
      <form aria-label="Password" className="form" noValidate onSubmit={(e) => void change(e)}>
        <div className="field">
          <label htmlFor="current-password">Current password</label>
          <input id="current-password" type="password" className="input" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input id="new-password" type="password" className="input" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <button type="submit" className="button primary">
          Change password
        </button>
      </form>
    </section>
  );
}

interface CalendarForm {
  time_zone: string;
  working_weekdays: number[];
  holidays: Holiday[];
  cycle_anchor: string;
  holidayDate: string;
  holidayName: string;
}

function formOf(w: Workspace): CalendarForm {
  return { time_zone: w.time_zone, working_weekdays: [...w.working_weekdays], holidays: [...w.holidays], cycle_anchor: w.cycle_anchor, holidayDate: "", holidayName: "" };
}

function sameForm(a: CalendarForm, b: CalendarForm): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const ZONES: string[] = Intl.supportedValuesOf("timeZone");

/** The summary's links, in form order, and the control each one leads to. */
const ERROR_ORDER = [
  { field: "time_zone", target: "time-zone" },
  { field: "working_weekdays", target: "weekday-1" },
  { field: "holidays", target: "holiday-date" },
  { field: "cycle_anchor", target: "cycle-anchor" },
];

function CalendarSection(): JSX.Element {
  const app = useApp();
  const [base, setBase] = useState(() => formOf(app.workspace));
  const [form, setForm] = useState(base);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = useRef(false);
  dirty.current = !sameForm(form, base);

  /** A workspace refresh updates the form only while it holds no edits. */
  useEffect(() => {
    const fresh = formOf(app.workspace);
    setBase((prev) => (sameForm(prev, fresh) ? prev : fresh));
    if (!dirty.current) setForm((prev) => (sameForm(prev, fresh) ? prev : fresh));
  }, [app.workspace]);

  /** Changing a field clears that field's error and its summary link. */
  const update = (change: Partial<CalendarForm>, field?: string): void => {
    setForm((f) => ({ ...f, ...change }));
    if (field) setErrors(({ [field]: _, ...rest }) => rest);
  };

  const addHoliday = (): void => update({ holidays: [...form.holidays, { date: form.holidayDate, name: form.holidayName }], holidayDate: "", holidayName: "" }, "holidays");

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    app.announce("Saving calendar");
    try {
      const saved = await api<Workspace>("PUT", "/api/workspace/calendar", {
        time_zone: form.time_zone,
        working_weekdays: form.working_weekdays,
        holidays: form.holidays,
        cycle_anchor: form.cycle_anchor,
      });
      const fresh = formOf(saved);
      setBase(fresh);
      setForm(fresh);
      setErrors({});
      app.announce("Calendar saved.");
      app.reloadWorkspace();
    } catch (error) {
      if (!(error instanceof ApiFailure)) return;
      if (error.code !== "validation") return app.announce("");
      setErrors(error.fields);
      const problems = Object.keys(error.fields).length;
      app.announce(problems === 1 ? "Calendar not saved: 1 problem." : `Calendar not saved: ${problems} problems.`);
    }
  };

  const failing = ERROR_ORDER.filter((e) => errors[e.field]);
  const invalid = (field: string): { "aria-invalid"?: true; "aria-describedby"?: string } => (errors[field] ? { "aria-invalid": true, "aria-describedby": `${field}-error` } : {});
  const fieldError = (field: string): JSX.Element | null =>
    errors[field] ? (
      <p id={`${field}-error`} className="field-error">
        {errors[field]}
      </p>
    ) : null;

  return (
    <section id="calendar" className="settings-section" aria-labelledby="calendar-heading">
      <h2 id="calendar-heading">Working calendar</h2>
      <p className="mono muted">{`Next digest: ${showDate(app.workspace.next_digest_at)} 08:00`}</p>
      {failing.length > 0 && (
        <section role="region" aria-label="Calendar errors" className="error-summary">
          <ul>
            {failing.map((e) => (
              <li key={e.field}>
                <a
                  href={`#${e.target}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(e.target)?.focus();
                  }}
                >
                  {errors[e.field]}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form aria-label="Working calendar" className="form calendar-form" noValidate onSubmit={(e) => void save(e)}>
        <div className="field">
          <label htmlFor="time-zone">Time zone</label>
          <input id="time-zone" role="combobox" aria-expanded="false" aria-autocomplete="list" list="time-zones" className="input" autoComplete="off" value={form.time_zone} {...invalid("time_zone")} onChange={(e) => update({ time_zone: e.target.value }, "time_zone")} />
          <datalist id="time-zones">
            {ZONES.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          {fieldError("time_zone")}
        </div>
        <fieldset className="weekdays">
          <legend>Working days</legend>
          {WEEKDAYS.map((day, i) => (
            <label key={day} className="check">
              <input
                id={`weekday-${i + 1}`}
                type="checkbox"
                checked={form.working_weekdays.includes(i + 1)}
                {...invalid("working_weekdays")}
                onChange={(e) =>
                  update({ working_weekdays: e.target.checked ? [...form.working_weekdays, i + 1].sort((a, b) => a - b) : form.working_weekdays.filter((d) => d !== i + 1) }, "working_weekdays")
                }
              />
              {day}
            </label>
          ))}
          {fieldError("working_weekdays")}
        </fieldset>
        <div className="holidays">
          <h3>Holidays</h3>
          <ul className="ruled-list">
            {form.holidays.map((h, i) => (
              <li key={`${h.date}-${i}`}>
                <span className="mono">{isRealDate(h.date) ? showDate(h.date) : h.date}</span>
                <span>{h.name}</span>
                <button type="button" className="button ghost" aria-label={`Remove holiday ${isRealDate(h.date) ? showDate(h.date) : h.date}`} onClick={() => update({ holidays: form.holidays.filter((_, at) => at !== i) }, "holidays")}>
                  <Trash2 aria-hidden="true" size={18} strokeWidth={1.5} />
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="holiday-add">
            <div className="field">
              <label htmlFor="holiday-date">Holiday date</label>
              <input id="holiday-date" className="input mono" placeholder="YYYY-MM-DD" value={form.holidayDate} {...invalid("holidays")} onChange={(e) => update({ holidayDate: e.target.value }, "holidays")} />
              {fieldError("holidays")}
            </div>
            <div className="field">
              <label htmlFor="holiday-name">Holiday name</label>
              <input id="holiday-name" className="input" value={form.holidayName} onChange={(e) => update({ holidayName: e.target.value }, "holidays")} />
            </div>
            <button type="button" className="button" onClick={addHoliday}>
              <Plus aria-hidden="true" size={18} strokeWidth={1.5} />
              Add holiday
            </button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="cycle-anchor">First cycle starts</label>
          <input id="cycle-anchor" className="input mono" placeholder="YYYY-MM-DD" value={form.cycle_anchor} {...invalid("cycle_anchor")} onChange={(e) => update({ cycle_anchor: e.target.value }, "cycle_anchor")} />
          {fieldError("cycle_anchor")}
        </div>
        <button type="submit" className="button primary">
          Save calendar
        </button>
      </form>
    </section>
  );
}

function scheduledCopy(billing: Billing): string {
  return `Seat limit stays at ${billing.limit} until ${showDate(billing.scheduled_on ?? "")}, then ${billing.scheduled_limit ?? ""}.`;
}

function SeatsSection(): JSX.Element {
  const app = useApp();
  const services = useServices();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [seats, setSeats] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const load = useCallback(() => {
    if (busy.current) return;
    get<Billing>("/api/billing")
      .then((b) => {
        if (busy.current) return;
        setBilling(b);
        setSeats((s) => (s === "" ? String(b.limit) : s));
      })
      .catch(() => undefined);
  }, []);
  const seatsKey = JSON.stringify(app.workspace.seats);
  /** Billing is re-read when the refreshed workspace record shows different seat figures. */
  useEffect(load, [load, seatsKey]);

  const say = (text: string): void => {
    flushSync(() => setStatus(""));
    setStatus(text);
  };

  const update = async (): Promise<void> => {
    if (busy.current) return;
    const value = Number(seats);
    if (!/^\d+$/.test(seats.trim()) || value < 1 || value > 40) return say("Choose between 1 and 40 seats.");
    busy.current = true;
    setPending(true);
    say("Confirming with billing");
    try {
      const next = await api<Billing>("PUT", "/api/billing/seats", { seats: value }, { "Idempotency-Key": crypto.randomUUID() });
      setBilling(next);
      say(next.scheduled_limit !== null && next.scheduled_on !== null ? scheduledCopy(next) : `Seat limit is now ${next.limit}.`);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "seats_below_active") say(`You have ${billing?.active ?? 0} people in this workspace. Remove someone before lowering seats below that.`);
      else if (error instanceof ApiFailure && error.code === "validation") say("Choose between 1 and 40 seats.");
      else {
        say(`Seat limit not changed. It stays at ${billing?.limit ?? ""}.`);
        services.refresh();
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const shown = status || (billing?.scheduled_limit != null ? scheduledCopy(billing) : "");

  return (
    <section id="seats" className="settings-section" aria-labelledby="seats-heading">
      <h2 id="seats-heading">Seats and billing</h2>
      {billing && (
        <dl className="figures">
          <div>
            <dt>Seats</dt>
            <dd className="mono">{`${billing.active} of ${billing.limit} seats used, ${billing.pending} pending`}</dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd className="mono">{`Monthly total: $${billing.monthly_total}`}</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd className="mono">{`$${billing.price_per_seat} per seat each month`}</dd>
          </div>
        </dl>
      )}
      <form className="inline-form seats-form" noValidate onSubmit={(e) => (e.preventDefault(), void update())}>
        <div className="field">
          <label htmlFor="seat-count">Seats</label>
          <input id="seat-count" type="number" min={1} max={40} step={1} className="input mono" value={seats} onChange={(e) => setSeats(e.target.value)} />
        </div>
        <button type="submit" className="button primary" aria-disabled={pending ? "true" : undefined}>
          Update seats
        </button>
      </form>
      <p role="status" aria-label="Billing status" aria-live="polite" className="billing-status">
        {shown}
      </p>
    </section>
  );
}

function PeopleSection(): JSX.Element {
  const app = useApp();
  const services = useServices();
  const [members, setMembers] = useState<Person[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "guest">("member");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [emailError, setEmailError] = useState("");

  const load = useCallback(() => {
    get<{ members: Person[] }>("/api/members")
      .then((r) => setMembers(r.members))
      .catch(() => undefined);
    get<{ invites: Invite[] }>("/api/invites")
      .then((r) => setInvites(r.invites))
      .catch(() => undefined);
  }, []);
  const seatsKey = JSON.stringify(app.workspace.seats);
  /** People and invites are re-read when the refreshed workspace record shows different seat use. */
  useEffect(load, [load, seatsKey]);

  const remove = async (person: Person): Promise<void> => {
    try {
      await api("DELETE", `/api/members/${person.id}`);
      app.announce(`Removed ${person.name}.`);
      load();
      services.refresh();
    } catch {
      load();
    }
  };

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setEmailError("");
    const target = email;
    try {
      await api<Invite>("POST", "/api/invites", { email: target, role, project_ids: role === "guest" ? projectIds : [], channel_ids: role === "guest" ? channelIds : [] }, { "Idempotency-Key": crypto.randomUUID() });
      app.announce(`Invite created for ${target}.`);
      setEmail("");
      setProjectIds([]);
      setChannelIds([]);
      load();
      services.refresh();
    } catch (error) {
      if (!(error instanceof ApiFailure)) return;
      const copy: Record<string, string> = {
        workspace_full: "No free seats. Add a seat before inviting.",
        invite_pending: `${target} already has a pending invite.`,
        already_member: `${target} is already in this workspace.`,
        billing_unavailable: "Can't check seats right now. Try again when billing is back.",
      };
      if (copy[error.code]) app.announce(copy[error.code] as string);
      else if (error.code === "validation") setEmailError(error.fields.email ? "Enter an email address." : "Share at least one project or channel with a guest.");
    }
  };

  const revoke = async (invite: Invite): Promise<void> => {
    try {
      await api("DELETE", `/api/invites/${invite.id}`);
      app.announce(`Invite for ${invite.email} revoked.`);
    } finally {
      load();
      services.refresh();
    }
  };

  const toggle = (list: string[], id: string, on: boolean): string[] => (on ? [...list, id] : list.filter((x) => x !== id));

  return (
    <>
      <section id="people" className="settings-section" aria-labelledby="people-heading">
        <h2 id="people-heading">Members</h2>
        <table aria-label="Members" className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td className="mono">{m.email}</td>
                <td>{m.role}</td>
                <td>
                  {m.role !== "owner" && (
                    <button type="button" className="button ghost" onClick={() => void remove(m)}>
                      {`Remove ${m.name}`}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section id="invites" className="settings-section" aria-labelledby="invites-heading">
        <h2 id="invites-heading">Invites</h2>
        <form aria-label="Invite" className="form invite-form" noValidate onSubmit={(e) => void send(e)}>
          <div className="field">
            <label htmlFor="invite-email">Invite email</label>
            <input id="invite-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            {emailError && <p className="field-error">{emailError}</p>}
          </div>
          <fieldset className="radios">
            <legend>Role</legend>
            <label className="check">
              <input type="radio" name="invite-role" checked={role === "member"} onChange={() => setRole("member")} />
              Member
            </label>
            <label className="check">
              <input type="radio" name="invite-role" checked={role === "guest"} onChange={() => setRole("guest")} />
              Guest
            </label>
          </fieldset>
          {role === "guest" && (
            <fieldset className="shares">
              <legend>Shared with the guest</legend>
              {app.projects.map((p) => (
                <label key={p.id} className="check">
                  <input type="checkbox" checked={projectIds.includes(p.id)} onChange={(e) => setProjectIds(toggle(projectIds, p.id, e.target.checked))} />
                  {p.name}
                </label>
              ))}
              {app.channels.map((c) => (
                <label key={c.id} className="check">
                  <input type="checkbox" checked={channelIds.includes(c.id)} onChange={(e) => setChannelIds(toggle(channelIds, c.id, e.target.checked))} />
                  {`#${c.name}`}
                </label>
              ))}
            </fieldset>
          )}
          <button type="submit" className="button primary">
            Send invite
          </button>
        </form>
        <table aria-label="Invites" className="table">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col">Expires</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invites.map((i) => (
              <tr key={i.id}>
                <td className="mono">{i.email}</td>
                <td>{i.role}</td>
                <td>{i.status}</td>
                <td className="mono">{showDate(i.expires_at)}</td>
                <td>
                  {i.status === "pending" && (
                    <button type="button" className="button ghost" onClick={() => void revoke(i)}>
                      {`Revoke invite for ${i.email}`}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
