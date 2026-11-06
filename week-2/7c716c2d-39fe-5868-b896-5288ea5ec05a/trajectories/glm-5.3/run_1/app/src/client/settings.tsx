import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.ts";
import { store } from "./store.ts";
import type { Billing, Invite } from "./types.ts";

const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function SettingsView(): React.ReactNode {
  return (
    <div>
      <h1>Settings</h1>
      <CalendarForm />
      <div style={{ marginTop: 24 }}>
        <SeatsForm />
      </div>
      <div style={{ marginTop: 24 }}>
        <PeopleForms />
      </div>
      <div style={{ marginTop: 24 }}>
        <PasswordForm />
      </div>
    </div>
  );
}

interface CalendarDraft {
  time_zone: string;
  weekdays: boolean[];
  holidays: { date: string; name: string }[];
  holidayDate: string;
  holidayName: string;
  anchor: string;
}

function CalendarForm(): React.ReactNode {
  const [draft, setDraft] = useState<CalendarDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const zoneRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const ws = store.workspace;
    if (!ws) return;
    setDraft((prev) => {
      // Unsaved edits survive refreshes.
      if (prev) return prev;
      return {
        time_zone: ws.time_zone,
        weekdays: [1, 2, 3, 4, 5, 6, 7].map((d) => ws.working_weekdays.includes(d)),
        holidays: [...ws.holidays],
        holidayDate: "",
        holidayName: "",
        anchor: ws.cycle_anchor,
      };
    });
  }, [store.workspace]);

  if (!draft) return null;
  const ws = store.workspace;
  if (!ws) return null;

  const fieldOrder = ["time_zone", "working_weekdays", "holidays", "cycle_anchor"];
  const anchorTargets: Record<string, string> = {
    time_zone: "Time zone",
    working_weekdays: "working days",
    holidays: "holidays",
    cycle_anchor: "First cycle starts",
  };

  const save = async (): Promise<void> => {
    setErrors(null);
    try {
      const { data } = await api.saveCalendar({
        time_zone: draft.time_zone,
        working_weekdays: draft.weekdays.flatMap((on, i) => (on ? [i + 1] : [])),
        holidays: draft.holidays.map((h) => ({ date: h.date, name: h.name })),
        cycle_anchor: draft.anchor,
      });
      store.workspace = data;
      store.calendarChanged = false;
      store.emitChange();
      store.announce("Calendar saved.");
    } catch (e) {
      if (e instanceof ApiError && e.fields) {
        setErrors(e.fields);
        const n = Object.keys(e.fields).length;
        store.announce(`Calendar not saved: ${n} problems.`);
        return;
      }
      if (e instanceof ApiError && e.code === "database_unavailable") {
        store.announce("Tallyroom can't reach its database. Changes are not being saved.");
        return;
      }
      store.announce("Calendar not saved: 1 problem.");
    }
  };

  const zoneError = errors?.time_zone;
  const weekdaysError = errors?.working_weekdays;
  const holidaysError = errors?.holidays;
  const anchorError = errors?.cycle_anchor;

  return (
    <div>
      {errors && (
        <div className="error-summary" role="region" aria-label="Calendar errors">
          {fieldOrder
            .filter((f) => errors[f])
            .map((f) => (
              <a
                key={f}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (f === "time_zone") zoneRef.current?.focus();
                  if (f === "working_weekdays") {
                    const cb = document.querySelector<HTMLInputElement>('input[name="weekday-1"]');
                    cb?.focus();
                  }
                  if (f === "holidays") {
                    const input = document.querySelector<HTMLInputElement>('input[aria-label="Holiday date"]');
                    input?.focus();
                  }
                  if (f === "cycle_anchor") {
                    const input = document.querySelector<HTMLInputElement>('input[aria-label="First cycle starts"]');
                    input?.focus();
                  }
                }}
              >
                {errors[f]}
              </a>
            ))}
        </div>
      )}
      <form
        aria-label="Working calendar"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="form-grid">
          <label htmlFor="tz">Time zone</label>
          <div>
            <input
              id="tz"
              ref={zoneRef}
              list="zone-list"
              aria-label="Time zone"
              aria-invalid={zoneError ? "true" : undefined}
              aria-describedby={zoneError ? "tz-error" : undefined}
              value={draft.time_zone}
              onChange={(e) => {
                setDraft({ ...draft, time_zone: e.currentTarget.value });
                setErrors((prev) => (prev ? { ...prev, time_zone: prev.time_zone } : prev));
              }}
            />
            <datalist id="zone-list">
              {COMMON_ZONES.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            {zoneError && (
              <span id="tz-error" className="field-error">
                {zoneError}
              </span>
            )}
          </div>
          <label>Working days</label>
          <div aria-invalid={weekdaysError ? "true" : undefined} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {WEEKDAY_LABELS.map((label, i) => (
              <label key={label} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input
                  type="checkbox"
                  name={`weekday-${i + 1}`}
                  checked={draft.weekdays[i]}
                  aria-label={label}
                  onChange={(e) => {
                    const weekdays = [...draft.weekdays];
                    weekdays[i] = e.currentTarget.checked;
                    setDraft({ ...draft, weekdays });
                    setErrors((prev) => (prev ? { ...prev, working_weekdays: prev.working_weekdays } : prev));
                  }}
                />
                {label}
              </label>
            ))}
            {weekdaysError && <span className="field-error">{weekdaysError}</span>}
          </div>
          <label>Holidays</label>
          <div>
            {draft.holidays.map((h) => (
              <div key={h.date} className="row">
                <span className="meta num">{h.date}</span>
                <span className="title">{h.name}</span>
                <button
                  type="button"
                  className="row-btn"
                  aria-label={`Remove holiday ${h.date}`}
                  onClick={() => setDraft({ ...draft, holidays: draft.holidays.filter((x) => x.date !== h.date) })}
                >
                  Remove
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <input
                aria-label="Holiday date"
                className="num"
                placeholder="YYYY-MM-DD"
                value={draft.holidayDate}
                onChange={(e) => setDraft({ ...draft, holidayDate: e.currentTarget.value })}
              />
              <input
                aria-label="Holiday name"
                placeholder="Name"
                value={draft.holidayName}
                onChange={(e) => setDraft({ ...draft, holidayName: e.currentTarget.value })}
              />
              <button
                type="button"
                className="btn"
                aria-label="Add holiday"
                onClick={() => {
                  if (draft.holidayDate.trim().length === 0) return;
                  setDraft({
                    ...draft,
                    holidays: [...draft.holidays, { date: draft.holidayDate, name: draft.holidayName }],
                    holidayDate: "",
                    holidayName: "",
                  });
                }}
              >
                Add holiday
              </button>
            </div>
            {holidaysError && <span className="field-error">{holidaysError}</span>}
          </div>
          <label htmlFor="anchor">First cycle starts</label>
          <div>
            <input
              id="anchor"
              aria-label="First cycle starts"
              className="num"
              aria-invalid={anchorError ? "true" : undefined}
              value={draft.anchor}
              onChange={(e) => {
                setDraft({ ...draft, anchor: e.currentTarget.value });
                setErrors((prev) => (prev ? { ...prev, cycle_anchor: prev.cycle_anchor } : prev));
              }}
            />
            {anchorError && <span className="field-error">{anchorError}</span>}
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="btn primary" type="submit" aria-label="Save calendar">
            Save calendar
          </button>
        </div>
      </form>
      <p className="meta num">
        {`Next digest: ${ws.next_digest_at ? ws.next_digest_at.replace("T", " ").slice(0, 16) : "—"}`}
      </p>
    </div>
  );
}

const COMMON_ZONES = [
  "Pacific/Auckland",
  "Pacific/Honolulu",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "America/Sao_Paulo",
  "Atlantic/Azores",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Warsaw",
  "Europe/Athens",
  "Europe/Helsinki",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

function PeopleForms(): React.ReactNode {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "guest">("member");
  const [inviteProjects, setInviteProjects] = useState<Record<string, boolean>>({});
  const [inviteChannels, setInviteChannels] = useState<Record<string, boolean>>({});
  const [invites, setInvites] = useState<Invite[]>([]);
  const inviteKeyRef = useRef(`i-${Date.now().toString(36)}-0`);

  useEffect(() => {
    void api.invites().then(({ data }) => setInvites(data.invites)).catch(() => undefined);
    const off = store.onStreamEvent((name) => {
      if (name === "notice" || name === "reset") {
        void api.invites().then(({ data }) => setInvites(data.invites)).catch(() => undefined);
      }
    });
    return off;
  }, []);

  const send = async (): Promise<void> => {
    inviteKeyRef.current = `i-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const { data } = await api.sendInvite(
        {
          email: inviteEmail,
          role: inviteRole,
          project_ids: Object.entries(inviteProjects).filter(([, on]) => on).map(([id]) => id),
          channel_ids: Object.entries(inviteChannels).filter(([, on]) => on).map(([id]) => id),
        },
        inviteKeyRef.current
      );
      setInvites((list) => [...list, data]);
      setInviteEmail("");
      store.announce(`Invite created for ${data.email}.`);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "workspace_full") {
          store.announce("No free seats. Add a seat before inviting.");
          return;
        }
        if (e.code === "invite_pending") {
          store.announce(`${inviteEmail} already has a pending invite.`);
          return;
        }
        if (e.code === "already_member") {
          store.announce(`${inviteEmail} is already in this workspace.`);
          return;
        }
        if (e.code === "billing_unavailable") {
          store.announce("Can't check seats right now. Try again when billing is back.");
          return;
        }
        if (e.code === "database_unavailable") {
          store.announce("Tallyroom can't reach its database. Changes are not being saved.");
          return;
        }
        if (e.fields) {
          store.announce(Object.values(e.fields)[0]);
          return;
        }
      }
      store.announce("The invite wasn't created.");
    }
  };

  const revoke = async (invite: Invite): Promise<void> => {
    try {
      await api.revokeInvite(invite.id);
      setInvites((list) => list.map((i) => (i.id === invite.id ? { ...i, status: "revoked" as const } : i)));
      store.announce(`Invite for ${invite.email} revoked.`);
    } catch (e) {
      void e;
    }
  };

  const removePerson = async (personId: string, name: string): Promise<void> => {
    try {
      await api.removeMember(personId);
      await store.refreshMembers();
      store.announce(`Removed ${name}.`);
    } catch {
      store.announce("The person wasn't removed.");
    }
  };

  return (
    <div>
      <h2>Members</h2>
      <table className="data" aria-label="Members">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {store.members.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td>{m.role}</td>
              <td>
                {m.role !== "owner" && (
                  <button className="row-btn" aria-label={`Remove ${m.name}`} onClick={() => void removePerson(m.id, m.name)}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 style={{ marginTop: 20 }}>Invite</h2>
      <form
        aria-label="Invite"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="form-grid">
          <label htmlFor="invite-email">Email</label>
          <input id="invite-email" aria-label="Invite email" value={inviteEmail} onChange={(e) => setInviteEmail(e.currentTarget.value)} />
          <label>Role</label>
          <div style={{ display: "flex", gap: 12 }}>
            <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="radio" name="invite-role" aria-label="Member" checked={inviteRole === "member"} onChange={() => setInviteRole("member")} />
              Member
            </label>
            <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="radio" name="invite-role" aria-label="Guest" checked={inviteRole === "guest"} onChange={() => setInviteRole("guest")} />
              Guest
            </label>
          </div>
          {inviteRole === "guest" && (
            <>
              <label>Projects</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {store.projects.map((p) => (
                  <label key={p.id} style={{ display: "flex", gap: 4 }}>
                    <input
                      type="checkbox"
                      aria-label={p.name}
                      checked={inviteProjects[p.id] ?? false}
                      onChange={(e) => setInviteProjects({ ...inviteProjects, [p.id]: e.currentTarget.checked })}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
              <label>Channels</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {store.channels.map((c) => (
                  <label key={c.id} style={{ display: "flex", gap: 4 }}>
                    <input
                      type="checkbox"
                      aria-label={`#${c.name}`}
                      checked={inviteChannels[c.id] ?? false}
                      onChange={(e) => setInviteChannels({ ...inviteChannels, [c.id]: e.currentTarget.checked })}
                    />
                    {`#${c.name}`}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="btn primary" type="submit" aria-label="Send invite">
            Send invite
          </button>
        </div>
      </form>
      <h2 style={{ marginTop: 20 }}>Invites</h2>
      <table className="data" aria-label="Invites">
        <thead>
          <tr>
            <th>Email</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {invites.map((i) => (
            <tr key={i.id}>
              <td>{i.email}</td>
              <td>{i.status}</td>
              <td>
                {i.status === "pending" && (
                  <button className="row-btn" aria-label={`Revoke invite for ${i.email}`} onClick={() => void revoke(i)}>
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SeatsForm(): React.ReactNode {
  const [seats, setSeats] = useState<string>("");
  const [pendingChange, setPendingChange] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [scheduled, setScheduled] = useState<{ limit: number; on: string } | null>(null);
  const keyRef = useRef(`s-${Date.now().toString(36)}`);

  useEffect(() => {
    void api.billing().then(({ data }) => {
      setBilling(data);
      setScheduled(
        data.scheduled_limit !== null && data.scheduled_on !== null
          ? { limit: data.scheduled_limit, on: data.scheduled_on }
          : null
      );
      if (seats === "") setSeats(String(data.limit));
    }).catch(() => undefined);
    const off = store.onStreamEvent((name) => {
      if (name === "notice" || name === "reset") {
        void api.billing().then(({ data }) => setBilling(data)).catch(() => undefined);
      }
    });
    return off;
  }, []);

  const update = async (): Promise<void> => {
    const value = Number(seats);
    setPendingChange(true);
    keyRef.current = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const { data } = await api.updateSeats(value, keyRef.current);
      setBilling(data);
      setScheduled(
        data.scheduled_limit !== null && data.scheduled_on !== null
          ? { limit: data.scheduled_limit, on: data.scheduled_on }
          : null
      );
      if (data.scheduled_limit !== null && data.scheduled_on) {
        setLastResult(`Seat limit stays at ${data.limit} until ${data.scheduled_on}, then ${data.scheduled_limit}.`);
        store.announce(`Seat limit stays at ${data.limit} until ${data.scheduled_on}, then ${data.scheduled_limit}.`);
      } else {
        setLastResult(`Seat limit is now ${data.limit}.`);
        store.announce(`Seat limit is now ${data.limit}.`);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "seats_below_active") {
          const active = billing?.active ?? 0;
          setLastResult(`You have ${active} people in this workspace. Remove someone before lowering seats below that.`);
          store.announce(`You have ${active} people in this workspace. Remove someone before lowering seats below that.`);
        } else if (e.code === "billing_unavailable") {
          setLastResult(`Seat limit not changed. It stays at ${billing?.limit ?? "the current limit"}.`);
          store.announce(`Seat limit not changed. It stays at ${billing?.limit ?? "the current limit"}.`);
        } else if (e.fields?.seats) {
          setLastResult(e.fields.seats);
          store.announce(e.fields.seats);
        }
      }
    } finally {
      setPendingChange(false);
    }
  };

  return (
    <div>
      <h2>Seats and billing</h2>
      {billing && (
        <p className="meta num">
          {`${billing.active} of ${billing.limit} seats used, ${billing.pending} pending`}
        </p>
      )}
      {billing && <p className="meta num">{`Monthly total: $${billing.monthly_total}`}</p>}
      <div className="form-grid">
        <label htmlFor="seats">Seats</label>
        <input
          id="seats"
          type="number"
          min={1}
          max={40}
          className="num"
          aria-label="Seats"
          value={seats}
          onChange={(e) => setSeats(e.currentTarget.value)}
        />
      </div>
      <div style={{ marginTop: 10 }}>
        <button
          className="btn primary"
          aria-label="Update seats"
          aria-disabled={pendingChange}
          disabled={pendingChange}
          onClick={() => void update()}
        >
          Update seats
        </button>
      </div>
      <div role="status" aria-live="polite" aria-label="Billing status">
        {lastResult ??
          (scheduled && billing
            ? `Seat limit stays at ${billing.limit} until ${scheduled.on}, then ${scheduled.limit}.`
            : "")}
      </div>
    </div>
  );
}

export function PasswordForm(): React.ReactNode {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState("");
  return (
    <div>
      <h2>Password</h2>
      <form
        aria-label="Password"
        onSubmit={async (e) => {
          e.preventDefault();
          store.announce("Changing password");
          try {
            await api.changePassword(current, next);
            setCurrent("");
            setNext("");
            setMessage("Password changed. Other devices were signed out.");
            store.announce("Password changed. Other devices were signed out.");
          } catch (err) {
            if (err instanceof ApiError) {
              if (err.code === "invalid_credentials") {
                setMessage("That current password isn't right.");
                store.announce("That current password isn't right.");
                return;
              }
              if (err.fields?.new_password) {
                setMessage("Use 8 to 128 characters.");
                store.announce("Use 8 to 128 characters.");
                return;
              }
            }
            setMessage("The password wasn't changed.");
          }
        }}
      >
        <div className="form-grid">
          <label htmlFor="current-password">Current password</label>
          <input
            id="current-password"
            type="password"
            aria-label="Current password"
            value={current}
            onChange={(e) => setCurrent(e.currentTarget.value)}
          />
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            aria-label="New password"
            value={next}
            onChange={(e) => setNext(e.currentTarget.value)}
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="btn primary" type="submit" aria-label="Change password">
            Change password
          </button>
        </div>
      </form>
      <div role="status">{message}</div>
    </div>
  );
}
