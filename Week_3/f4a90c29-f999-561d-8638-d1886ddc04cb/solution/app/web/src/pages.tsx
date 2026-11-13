import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, describe, get, send } from "./api";
import { Digits, ThreeClocks } from "./clocks";
import { defaultValues, openNewEvent } from "./form";
import { navigate, useLocation, withQuery } from "./router";
import { announce } from "./status";
import { bump, calendars$, dataVersion$, loadBase, loadMe, me$, people$, prints$ } from "./state";
import { useStore } from "./store";
import {
  CITY_OF, DAY, MINUTE, ZONES, addDays, dateOf, dayLabel, parseDate, serverNow, shortDayLabel, timeOf, wallInZone, weekday,
  type Wall,
} from "./time";
import type { CalendarInfo, ClockEntry, Hours, Me, Print, Zone } from "./types";
import { restoreFocus } from "./ui";

export function Landing() {
  const reveal = (event: Event) => {
    event.preventDefault();
    document.getElementById("clocks-example")?.scrollIntoView({ block: "end" });
  };
  const row = (title: string, date: string, clocks: [string, string, boolean][]) => (
    <div class="ex-row">
      <div class="ex-title">
        <strong>{title}</strong>
        <span class="muted">{date}</span>
      </div>
      <div class="ex-clocks">
        {clocks.map(([time, city, inside]) => (
          <span class="ex-clock" role="group" aria-label={`${time} ${city}`} key={city}>
            <Digits text={time} /> <span class="ex-city">{city}</span>
            <span class="tc-bar" data-inside={inside ? "yes" : "no"} aria-hidden="true" />
          </span>
        ))}
      </div>
    </div>
  );
  return (
    <main class="landing">
      <div class="landing-col">
        <h1>
          <span class="line">Every clock in the firm,</span> <span class="line">agreeing to the second.</span>
        </h1>
        <p class="lead">One shared calendar for New York, London and Auckland, where a weekly meeting never drifts and nothing goes through email.</p>
        <p class="cta">
          <a class="button primary" href="/signin" onClick={(e) => { e.preventDefault(); navigate("/signin"); }}>Sign in</a>
          <a class="textlink" href="#clocks-example" onClick={reveal}>See the three clocks</a>
        </p>
      </div>
      <section role="region" aria-label="Three clocks example" id="clocks-example" class="example">
        {row("Partners' weekly", "Tue 6 Oct 2026", [["09:00", "New York", true], ["14:00", "London", true], ["02:00", "Auckland", false]])}
        {row("Client readout", "Tue 6 Oct 2026", [["11:30", "New York", true], ["16:30", "London", true], ["04:30", "Auckland", false]])}
        <svg class="pointer" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path d="M4 2l16 9-7 2.2L9.5 21z" fill="var(--ink)" />
        </svg>
      </section>
    </main>
  );
}

export function SignIn() {
  const [email, setEmail] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    announce("Signing in...");
    try {
      await send("POST", "/api/session", { email: email.trim(), passcode });
      await loadMe();
      navigate("/calendar", true);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? e.message : describe(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main class="column bare">
      <h1>Sign in</h1>
      <form onSubmit={submit} noValidate>
        <div class="field">
          <label for="si-email">Email</label>
          <input id="si-email" type="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} autocomplete="username" />
        </div>
        <div class="field">
          <label for="si-pass">Passcode</label>
          <input id="si-pass" type="password" value={passcode} onInput={(e) => setPasscode(e.currentTarget.value)} autocomplete="current-password" />
        </div>
        {!!error && <p class="field-error">{error}</p>}
        <div class="actions">
          <button type="submit" class="primary" disabled={busy}>Sign in</button>
        </div>
      </form>
    </main>
  );
}

/** An empty state: one plain sentence in the column with a text link. */
function Empty({ text }: { text: string }) {
  return <p class="quiet"><span>{text}</span> <a class="textlink" href="/calendar" onClick={(e) => { e.preventDefault(); navigate("/calendar"); }}>Back to the calendar</a></p>;
}

export function NotFound() {
  return (
    <main class="column bare">
      <h1>Nothing is scheduled at this address.</h1>
      <p><a class="textlink" href="/calendar" onClick={(e) => { e.preventDefault(); navigate("/calendar"); }}>Back to the calendar</a></p>
    </main>
  );
}

// ---- find a time ----

function busySegments(blocks: { start_utc: string; end_utc: string }[], zone: Zone): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  for (const b of blocks) {
    const start = wallInZone(Date.parse(b.start_utc), zone);
    const end = wallInZone(Date.parse(b.end_utc), zone);
    for (let day = dateOf(start); day <= dateOf(end - 1); day = addDays(day, 1)) {
      const midnight = parseDate(day) as Wall;
      const from = Math.max(start, midnight);
      const to = Math.min(end, midnight + DAY);
      out.set(day, [...(out.get(day) ?? []), [(from - midnight) / MINUTE, (to - midnight) / MINUTE]]);
    }
  }
  return out;
}

const clock = (min: number) => (min >= 1440 ? "24:00" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);

interface FoundSlot {
  start_utc: string;
  end_utc: string;
  clocks: ClockEntry[];
}

export function FindPage() {
  const me = useStore(me$) as Me;
  const people = useStore(people$);
  const version = useStore(dataVersion$);
  const today = dateOf(wallInZone(serverNow(), me.zone));
  const [chosen, setChosen] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 6));
  const [result, setResult] = useState<{ slots: FoundSlot[]; busy: { person_id: string; name: string; blocks: { start_utc: string; end_utc: string }[] }[] } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    const e: Record<string, string> = {};
    const m = Number(minutes);
    if (!/^\d+$/.test(minutes) || m < 15 || m > 480 || m % 15 !== 0) e.minutes = "Use a multiple of 15 from 15 to 480.";
    if (parseDate(from) === null) e.from = "Use YYYY-MM-DD.";
    if (parseDate(to) === null) e.to = "Use YYYY-MM-DD.";
    else if (parseDate(from) !== null && (parseDate(to) as number) - (parseDate(from) as number) > 30 * DAY) e.to = "Use at most 31 days.";
    else if (parseDate(from) !== null && (parseDate(to) as number) < (parseDate(from) as number)) e.to = "Use a date on or after the start date.";
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    let current = true;
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ people: chosen.join(","), minutes, from, to });
      get<NonNullable<typeof result>>(`/api/find-a-time?${query}`).then((body) => current && setResult(body)).catch(() => undefined);
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [chosen.join(","), minutes, from, to, version]);
  const others = people.filter((p) => p.id !== me.id);
  const days: string[] = [];
  if (parseDate(from) !== null && parseDate(to) !== null) for (let d = from; d <= to && days.length < 31; d = addDays(d, 1)) days.push(d);
  const book = (slot: FoundSlot, opener: HTMLElement) => {
    const start = wallInZone(Date.parse(slot.start_utc), me.zone);
    const end = wallInZone(Date.parse(slot.end_utc), me.zone);
    const values = { ...defaultValues(me, start, end), guestIds: chosen };
    openNewEvent(values, () => restoreFocus(opener));
  };
  return (
    <main class="column">
      <h1>Find a time</h1>
      <div class="field">
        <label for="ft-people">People</label>
        <select id="ft-people" value={pick} onChange={(e) => {
          const id = e.currentTarget.value;
          setPick(id);
          if (id && !chosen.includes(id)) setChosen([...chosen, id]);
        }}>
          <option value="">Choose a colleague</option>
          {others.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}
        </select>
      </div>
      {chosen.length > 0 && (
        <ul class="chips">
          {chosen.map((id) => {
            const name = people.find((p) => p.id === id)?.name ?? id;
            return <li key={id}>{name}<button type="button" class="chip-x" aria-label={`Remove ${name}`} onClick={() => { setChosen(chosen.filter((c) => c !== id)); setPick(""); }}>×</button></li>;
          })}
        </ul>
      )}
      <div class="field">
        <label for="ft-minutes">Minutes</label>
        <input id="ft-minutes" type="number" min={15} max={480} step={15} value={minutes} onInput={(e) => setMinutes(e.currentTarget.value)} />
        {errors.minutes && <p class="field-error">{errors.minutes}</p>}
      </div>
      <div class="field">
        <label for="ft-from">From</label>
        <input id="ft-from" type="text" value={from} onInput={(e) => setFrom(e.currentTarget.value)} placeholder="YYYY-MM-DD" />
        {errors.from && <p class="field-error">{errors.from}</p>}
      </div>
      <div class="field">
        <label for="ft-to">To</label>
        <input id="ft-to" type="text" value={to} onInput={(e) => setTo(e.currentTarget.value)} placeholder="YYYY-MM-DD" />
        {errors.to && <p class="field-error">{errors.to}</p>}
      </div>
      {result && result.slots.length === 0 && <Empty text="No free time fits these people. Try a longer range." />}
      <ul aria-label="Slots" class="slots">
        {(result?.slots ?? []).map((slot) => {
          const start = wallInZone(Date.parse(slot.start_utc), me.zone);
          return (
            <li key={slot.start_utc}>
              <button type="button" class="book" onClick={(e) => book(slot, e.currentTarget)}>{`Book ${dayLabel(dateOf(start))} ${timeOf(start)}`}</button>
              <ThreeClocks clocks={slot.clocks} baseDate={dateOf(start)} />
            </li>
          );
        })}
      </ul>
      <section role="region" aria-label="Busy blocks" class="busy">
        <h2>Busy blocks</h2>
        {(result?.busy ?? []).map((person) => {
          const segs = busySegments(person.blocks, me.zone);
          return (
            <div role="group" aria-label={person.name} class="busy-person" key={person.person_id}>
              <h3 aria-hidden="true">{person.name}</h3>
              <div class="busy-days">
                {days.map((d) => (
                  <div class="busy-day" key={d}>
                    <span class="busy-label" aria-hidden="true">{shortDayLabel(d).slice(4)}</span>
                    <div class="busy-track">
                      {(segs.get(d) ?? []).map(([a, b]) => (
                        <div role="img" aria-label={`Busy ${dayLabel(d)} ${clock(a)} to ${clock(b)}`} class="busy-block" key={a}
                          style={{ top: `${(a / 1440) * 100}%`, height: `${((b - a) / 1440) * 100}%` }} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}

// ---- search ----

interface Found {
  event_id: string;
  occurrence_id: string;
  title: string;
  start_local: string;
  zone: Zone;
  calendar_id: string;
}

export function SearchPage() {
  const loc = useLocation();
  const [q, setQ] = useState(loc.query.get("q") ?? "");
  const [results, setResults] = useState<Found[] | null>(null);
  const [searched, setSearched] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const version = useStore(dataVersion$);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const text = q.trim();
    if ([...text].length < 2) {
      setResults(null);
      setSearched("");
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      get<{ results: Found[] }>(`/api/search?q=${encodeURIComponent(text)}`).then((body) => {
        if (!current) return;
        setResults(body.results);
        setSearched(text);
        announce(body.results.length === 0 ? `Nothing matches ${text}.` : body.results.length === 1 ? `1 result for ${text}.` : `${body.results.length} results for ${text}.`);
      }).catch(() => undefined);
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [q, version]);
  const change = (value: string) => {
    setQ(value);
    navigate(withQuery("/search", { q: value }), true);
  };
  const link = (r: Found) => {
    const date = r.start_local.slice(0, 10);
    return withQuery("/calendar", { date, focus: r.occurrence_id, calendars: r.calendar_id === "cal-holidays" ? "cal-holidays" : null });
  };
  return (
    <main class="column">
      <h1>Search</h1>
      <div class="field">
        <label for="search-q">Search events</label>
        <input id="search-q" type="search" ref={input} value={q} onInput={(e) => change(e.currentTarget.value)} autocomplete="off" />
      </div>
      {[...q.trim()].length < 2 && <p class="quiet">Type at least 2 characters to search.</p>}
      {results && results.length === 0 && <Empty text={`Nothing matches ${searched}.`} />}
      <ul aria-label="Results" class="results">
        {(results ?? []).map((r) => (
          <li key={r.occurrence_id}>
            <a href={link(r)} onClick={(e) => { e.preventDefault(); navigate(link(r)); }}>{`${r.title}, ${dayLabel(r.start_local.slice(0, 10))}`}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}

// ---- trash ----

interface TrashItem {
  id: string;
  kind: string;
  title: string;
  days_left: number;
}

export function TrashPage() {
  const version = useStore(dataVersion$);
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    void get<{ items: TrashItem[] }>("/api/trash").then((b) => setItems(b.items));
  }, [version]);
  const restore = async (item: TrashItem) => {
    setMessage("");
    announce(`Restoring ${item.title}...`);
    try {
      await send("POST", `/api/trash/${item.id}/restore`);
      announce(`Restored ${item.title}.`);
      bump();
    } catch (e) {
      const text = describe(e);
      setMessage(text);
      announce(text);
    }
  };
  const forget = async (item: TrashItem) => {
    announce(`Deleting ${item.title}...`);
    try {
      await send("DELETE", `/api/trash/${item.id}`);
      announce(`Deleted ${item.title} for good.`);
      bump();
    } catch (e) {
      announce(describe(e));
    }
  };
  return (
    <main class="column">
      <h1>Trash</h1>
      {items && items.length === 0 && <Empty text="Trash is empty. Deleted events stay here for 30 days." />}
      {message && <p class="field-error">{message}</p>}
      <ul aria-label="Trash" class="rows">
        {(items ?? []).map((item) => (
          <li key={item.id}>
            <span class="row-title">{item.title}</span>
            <span class="muted">{item.days_left === 1 ? "1 days left" : `${item.days_left} days left`}</span>
            <button type="button" aria-label={`Restore ${item.title}`} onClick={() => void restore(item)}>Restore</button>
            <button type="button" aria-label={`Delete ${item.title} for good`} onClick={() => void forget(item)}>Delete for good</button>
          </li>
        ))}
      </ul>
    </main>
  );
}

// ---- sharing ----

const LEVELS: [string, string][] = [["free_busy", "See only free/busy"], ["details", "See all details"], ["edit", "Make changes"], ["manage", "Manage sharing"]];

export function SharingPage() {
  const me = useStore(me$) as Me;
  const calendars = useStore(calendars$);
  const people = useStore(people$);
  const version = useStore(dataVersion$);
  const manageable: { id: string; name: string }[] = me.role === "office_manager"
    ? [
        ...calendars.filter((c) => c.id === "cal-firm").map((c) => ({ id: c.id, name: c.name })),
        ...people.map((p) => ({ id: `cal-${p.name.split(" ")[0].toLowerCase()}`, name: p.name })),
      ]
    : calendars.filter((c) => c.level === "owner" || c.level === "manage").map((c) => ({ id: c.id, name: c.name }));
  const [calendar, setCalendar] = useState("");
  const [shares, setShares] = useState<{ person_id: string; name: string; level: string }[]>([]);
  const [person, setPerson] = useState("");
  const [level, setLevel] = useState("details");
  const [message, setMessage] = useState("");
  const [sharesRead, setSharesRead] = useState(false);
  const choose = calendar || manageable[0]?.id || "";
  useEffect(() => {
    if (!choose) return;
    get<{ shares: typeof shares }>(`/api/shares?calendar_id=${choose}`)
      .then((b) => setShares(b.shares))
      .catch((e) => setMessage(describe(e)))
      .finally(() => setSharesRead(true));
  }, [choose, version]);
  const save = async (personId: string, next: string) => {
    announce("Saving access...");
    try {
      await send("PUT", `/api/calendars/${choose}/shares/${personId}`, { level: next });
      announce("Access saved.");
      setMessage("");
      bump();
    } catch (e) {
      setMessage(describe(e));
      announce(describe(e));
    }
  };
  const remove = async (row: { person_id: string; name: string }) => {
    announce("Saving access...");
    try {
      await send("DELETE", `/api/calendars/${choose}/shares/${row.person_id}`);
      announce("Access saved.");
      bump();
    } catch (e) {
      announce(describe(e));
    }
  };
  const owner = people.find((p) => `cal-${p.name.split(" ")[0].toLowerCase()}` === choose);
  const candidates = people.filter((p) => !shares.some((s) => s.person_id === p.id) && p.id !== owner?.id && p.id !== me.id || (p.id === me.id && owner?.id !== me.id && !shares.some((s) => s.person_id === p.id) && me.role === "office_manager"));
  if (calendars.length === 0 || (me.role === "office_manager" && people.length === 0) || (choose && !sharesRead)) {
    return <main class="column"><h1>Sharing</h1></main>;
  }
  return (
    <main class="column">
      <h1>Sharing</h1>
      {manageable.length === 0 && <p class="quiet">You do not manage sharing on any calendar.</p>}
      {manageable.length > 0 && (
        <>
          <div class="field">
            <label for="sh-calendar">Calendar</label>
            <select id="sh-calendar" value={choose} onChange={(e) => setCalendar(e.currentTarget.value)}>
              {manageable.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}
            </select>
          </div>
          {message && <p class="field-error">{message}</p>}
          <ul class="rows">
            {shares.map((row) => (
              <li key={row.person_id}>
                <span class="row-title">{row.name}</span>
                <select aria-label={`Level for ${row.name}`} value={row.level} onChange={(e) => {
                  const next = e.currentTarget.value;
                  setShares(shares.map((s) => (s.person_id === row.person_id ? { ...s, level: next } : s)));
                  void save(row.person_id, next);
                }}>
                  {LEVELS.map(([value, text]) => <option value={value} key={value}>{text}</option>)}
                </select>
                <button type="button" aria-label={`Remove ${row.name}`} onClick={() => void remove(row)}>Remove</button>
              </li>
            ))}
          </ul>
          <h2>Add a person</h2>
          <div class="field">
            <label for="sh-person">Person</label>
            <select id="sh-person" value={person} onChange={(e) => setPerson(e.currentTarget.value)}>
              <option value="">Choose a person</option>
              {candidates.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div class="field">
            <label for="sh-level">Level</label>
            <select id="sh-level" value={level} onChange={(e) => setLevel(e.currentTarget.value)}>
              {LEVELS.map(([value, text]) => <option value={value} key={value}>{text}</option>)}
            </select>
          </div>
          <div class="actions">
            <button type="button" disabled={!person} onClick={() => { void save(person, level); setPerson(""); }}>Add</button>
          </div>
        </>
      )}
    </main>
  );
}

// ---- zone rules ----

interface ZoneRule {
  id: string;
  zone: Zone;
  city: string;
  effective_date: string;
  new_offset: string;
  note: string;
}

export function ZoneRulesPage() {
  const me = useStore(me$) as Me;
  const version = useStore(dataVersion$);
  const [rules, setRules] = useState<ZoneRule[] | null>(null);
  const [zone, setZone] = useState<Zone>(me.zone);
  const [date, setDate] = useState("");
  const [offset, setOffset] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    void get<{ rules: ZoneRule[] }>("/api/zone-rules").then((b) => setRules(b.rules));
  }, [version]);
  const record = async (event: Event) => {
    event.preventDefault();
    const e: Record<string, string> = {};
    if (parseDate(date.trim()) === null) e.effective_date = "Use YYYY-MM-DD.";
    if (!/^[+-]\d{2}:\d{2}$/.test(offset.trim())) e.new_offset = "Use +HH:MM or -HH:MM.";
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    announce("Recording rule...");
    try {
      await send("POST", "/api/zone-rules", { zone, effective_date: date.trim(), new_offset: offset.trim(), note: note.trim() });
      announce(`Rule recorded for ${CITY_OF[zone]}.`);
      setDate("");
      setOffset("");
      setNote("");
      bump();
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fields).length > 0) setErrors(error.fields);
      else {
        setErrors({});
        announce(describe(error));
        setErrors({ form: describe(error) });
      }
    }
  };
  return (
    <main class="column">
      <h1>Zone rules</h1>
      {me.role === "office_manager" && (
        <form onSubmit={record} noValidate>
          <div class="field">
            <label for="zr-zone">Zone</label>
            <select id="zr-zone" value={zone} onChange={(e) => setZone(e.currentTarget.value as Zone)}>
              {ZONES.map((z) => <option value={z} key={z}>{CITY_OF[z]}</option>)}
            </select>
          </div>
          <div class="field">
            <label for="zr-date">Effective date</label>
            <input id="zr-date" type="text" value={date} onInput={(e) => setDate(e.currentTarget.value)} placeholder="YYYY-MM-DD" />
            {errors.effective_date && <p class="field-error">{errors.effective_date}</p>}
          </div>
          <div class="field">
            <label for="zr-offset">New offset</label>
            <input id="zr-offset" type="text" value={offset} onInput={(e) => setOffset(e.currentTarget.value)} placeholder="+HH:MM" />
            {errors.new_offset && <p class="field-error">{errors.new_offset}</p>}
          </div>
          <div class="field">
            <label for="zr-note">Note</label>
            <input id="zr-note" type="text" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
            {errors.note && <p class="field-error">{errors.note}</p>}
          </div>
          {errors.form && <p class="field-error">{errors.form}</p>}
          <div class="actions"><button type="submit" class="primary">Record rule</button></div>
        </form>
      )}
      {rules && rules.length === 0 && <Empty text="No zone rules have been recorded." />}
      <ul aria-label="Zone rules" class="rows">
        {(rules ?? []).map((r) => (
          <li key={r.id}>
            <span class="row-title">{r.city}</span>
            <span>{`From ${dayLabel(r.effective_date)} the offset is ${r.new_offset}.`}</span>
            <span class="muted">{r.note}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

// ---- prints ----

function printCopy(p: Print): string {
  if (p.status === "stored") return "The printed week is ready.";
  if (p.status === "failed") return "This print failed. Choose Retry.";
  if (p.status === "rendered") return p.waiting_on === "file_storage" ? "File storage is not answering. This print stays pending; choose Retry." : "Storing the printed week.";
  return p.waiting_on === "document_service" ? "The document service is not answering. This print stays pending; choose Retry." : "Preparing the printed week.";
}

export function PrintsPage() {
  const me = useStore(me$) as Me;
  const prints = useStore(prints$);
  const version = useStore(dataVersion$);
  const monday = (() => {
    const today = dateOf(wallInZone(serverNow(), me.zone));
    return addDays(today, -((weekday(today) + 6) % 7));
  })();
  const [week, setWeek] = useState(monday);
  const [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const said = useRef(new Map<string, string>());
  useEffect(() => {
    if (me.role !== "office_manager") return;
    void get<{ prints: Print[] }>("/api/prints").then((b) => prints$.set(b.prints));
  }, [version]);
  useEffect(() => {
    for (const print of prints) {
      const copy = printCopy(print);
      if (said.current.get(print.id) !== copy) {
        if (said.current.has(print.id) || print.status !== "stored") announce(copy);
        said.current.set(print.id, copy);
      }
    }
  }, [prints]);
  if (me.role !== "office_manager") {
    return (
      <main class="column"><h1>Prints</h1><p class="quiet">Only the office manager prints the week.</p></main>
    );
  }
  const submit = async (event: Event) => {
    event.preventDefault();
    if (parseDate(week.trim()) === null) return setError("Use YYYY-MM-DD.");
    setError("");
    try {
      const reply = await call(week.trim(), key.current);
      key.current = crypto.randomUUID();
      prints$.set((list) => [reply, ...list.filter((p) => p.id !== reply.id)]);
    } catch (e) {
      setError(e instanceof ApiError && e.fields.week_start ? e.fields.week_start : describe(e));
    }
  };
  const call = async (start: string, idempotency: string) => {
    const response = await fetch("/api/prints", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotency }, body: JSON.stringify({ week_start: start }) });
    const data = await response.json();
    if (!response.ok) throw new ApiError(response.status, data.error, data.message, data.fields ?? {});
    return data as Print;
  };
  const retry = async (print: Print) => {
    try {
      const reply = await send<Print>("POST", `/api/prints/${print.id}/retry`);
      prints$.set((list) => list.map((p) => (p.id === print.id ? reply.data : p)));
    } catch (e) {
      announce(describe(e));
    }
  };
  return (
    <main class="column">
      <h1>Prints</h1>
      <form onSubmit={submit} noValidate>
        <div class="field">
          <label for="pr-week">Week starting</label>
          <input id="pr-week" type="text" value={week} onInput={(e) => setWeek(e.currentTarget.value)} placeholder="YYYY-MM-DD" />
          {!!error && <p class="field-error">{error}</p>}
        </div>
        <div class="actions"><button type="submit" class="primary">Print the week</button></div>
      </form>
      {prints.length === 0 && <Empty text="No printed weeks yet." />}
      <ul aria-label="Printed weeks" class="rows">
        {prints.map((print) => (
          <li key={print.id}>
            <span class="row-title">{`Week of ${dayLabel(print.week_start)}`}</span>
            <span>{printCopy(print)}</span>
            {print.status !== "stored" && <button type="button" onClick={() => void retry(print)}>Retry</button>}
            {print.status === "stored" && <a class="textlink" href={`/api/prints/${print.id}/pdf`} download>Download PDF</a>}
          </li>
        ))}
      </ul>
    </main>
  );
}

// ---- settings ----

const WEEK_STARTS: [string, string][] = [["monday", "Monday"], ["sunday", "Sunday"], ["saturday", "Saturday"]];

export function SettingsPage() {
  const me = useStore(me$) as Me;
  const calendars = useStore(calendars$);
  const [zone, setZone] = useState<Zone>(me.zone);
  const [weekStart, setWeekStart] = useState(me.week_start);
  const [hide, setHide] = useState(me.hide_weekends);
  const [custom, setCustom] = useState(String(me.custom_days));
  const [second, setSecond] = useState<string>(me.second_zone ?? "");
  const mine = calendars.filter((c) => c.level === "owner" || c.level === "manage");
  const [reminders, setReminders] = useState<Record<string, string>>({});
  const [defaults, setDefaults] = useState({ modify_event: false, invite_others: false, see_guest_list: false });
  const [office, setOffice] = useState<Record<string, Hours> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const manager = me.role === "office_manager";
  useEffect(() => {
    setReminders(Object.fromEntries(mine.map((c) => [c.id, c.default_reminders.join(",")])));
  }, [calendars]);
  useEffect(() => {
    if (!manager) return;
    void get<{ guest_defaults: typeof defaults; office_hours: Record<string, Hours> }>("/api/settings").then((s) => {
      setDefaults(s.guest_defaults);
      setOffice(s.office_hours);
    });
  }, []);
  const save = async (event: Event) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    const n = Number(custom);
    if (!/^\d+$/.test(custom) || n < 2 || n > 7) found.custom_days = "Use a whole number from 2 to 7.";
    const parsed: Record<string, number[]> = {};
    for (const c of mine) {
      const text = (reminders[c.id] ?? "").trim();
      if (text !== "" && !/^\d+(\s*,\s*\d+)*$/.test(text)) found[`rem-${c.id}`] = "Use whole minutes separated by commas, like 10,60.";
      else parsed[c.id] = text === "" ? [] : text.split(",").map((s) => Number(s.trim()));
    }
    if (office) {
      for (const z of ZONES) for (const key of ["open", "close"] as const) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(office[z][key])) found[`${z}-${key}`] = "Use HH:MM.";
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    announce("Saving settings...");
    try {
      const updated = await send<Me>("PATCH", "/api/me", { zone, week_start: weekStart, hide_weekends: hide, custom_days: n, second_zone: second === "" ? null : second });
      me$.set(updated.data);
      for (const c of mine) {
        if (JSON.stringify(parsed[c.id]) !== JSON.stringify(c.default_reminders)) await send("PATCH", `/api/calendars/${c.id}`, { default_reminders: parsed[c.id] });
      }
      if (manager && office) await send("PATCH", "/api/settings", { guest_defaults: defaults, office_hours: office });
      announce("Settings saved.");
      await loadBase();
      bump();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length > 0) setErrors(e.fields);
      else announce(describe(e));
    }
  };
  const field = (id: string, text: string, control: preact.ComponentChildren, error?: string, hint?: string) => (
    <div class="field">
      <label for={id}>{text}</label>
      {control}
      {!!hint && <p class="field-hint" id={`${id}-hint`}>{hint}</p>}
      {!!error && <p class="field-error">{error}</p>}
    </div>
  );
  if (calendars.length === 0 || (manager && !office)) return <main class="column"><h1>Settings</h1></main>;
  return (
    <main class="column">
      <h1>Settings</h1>
      <form onSubmit={save} noValidate>
        {field("st-zone", "My time zone", (
          <select id="st-zone" value={zone} onChange={(e) => setZone(e.currentTarget.value as Zone)}>
            {ZONES.map((z) => <option value={z} key={z}>{CITY_OF[z]}</option>)}
          </select>
        ), errors.zone)}
        {field("st-week", "Week starts on", (
          <select id="st-week" value={weekStart} onChange={(e) => setWeekStart(e.currentTarget.value as Me["week_start"])}>
            {WEEK_STARTS.map(([v, t]) => <option value={v} key={v}>{t}</option>)}
          </select>
        ), errors.week_start)}
        <label class="check"><input type="checkbox" checked={hide} onChange={(e) => setHide(e.currentTarget.checked)} />Hide weekends</label>
        {field("st-custom", "Custom days", <input id="st-custom" type="number" min={2} max={7} value={custom} onInput={(e) => setCustom(e.currentTarget.value)} />, errors.custom_days)}
        {field("st-second", "Second zone", (
          <select id="st-second" value={second} onChange={(e) => setSecond(e.currentTarget.value)}>
            <option value="">None</option>
            {ZONES.map((z) => <option value={z} key={z}>{CITY_OF[z]}</option>)}
          </select>
        ), errors.second_zone)}
        {mine.map((c: CalendarInfo) => field(`st-rem-${c.id}`, `Default reminders for ${c.name}`, (
          <input id={`st-rem-${c.id}`} type="text" value={reminders[c.id] ?? ""} onInput={(e) => setReminders({ ...reminders, [c.id]: e.currentTarget.value })} autocomplete="off" aria-describedby={`st-rem-${c.id}-hint`} />
        ), errors[`rem-${c.id}`] ?? errors.default_reminders, "Whole minutes before the event, like 10,60."))}
        {manager && (
          <>
            <h2>Guest defaults</h2>
            <label class="check"><input type="checkbox" checked={defaults.modify_event} onChange={(e) => setDefaults({ ...defaults, modify_event: e.currentTarget.checked })} />Modify event by default</label>
            <label class="check"><input type="checkbox" checked={defaults.invite_others} onChange={(e) => setDefaults({ ...defaults, invite_others: e.currentTarget.checked })} />Invite others by default</label>
            <label class="check"><input type="checkbox" checked={defaults.see_guest_list} onChange={(e) => setDefaults({ ...defaults, see_guest_list: e.currentTarget.checked })} />See guest list by default</label>
            <h2>Office hours</h2>
            {office && ZONES.map((z) => (
              <div key={z}>
                {field(`st-${z}-open`, `${CITY_OF[z]} opens`, <input id={`st-${z}-open`} type="text" value={office[z].open} onInput={(e) => setOffice({ ...office, [z]: { ...office[z], open: e.currentTarget.value } })} />, errors[`${z}-open`])}
                {field(`st-${z}-close`, `${CITY_OF[z]} closes`, <input id={`st-${z}-close`} type="text" value={office[z].close} onInput={(e) => setOffice({ ...office, [z]: { ...office[z], close: e.currentTarget.value } })} />, errors[`${z}-close`])}
              </div>
            ))}
          </>
        )}
        <div class="actions"><button type="submit" class="primary">Save settings</button></div>
      </form>
    </main>
  );
}

// ---- shared link ----

export function SharePage({ token }: { token: string }) {
  const [shared, setShared] = useState<{ title: string; location: string; organiser_name: string; all_day: boolean; start_local: string; end_local: string; zone: Zone; clocks: ClockEntry[]; guests: { name: string; answer: string }[] } | null | false>(null);
  useEffect(() => {
    get<NonNullable<typeof shared>>(`/api/share/${token}`).then(setShared).catch(() => setShared(false));
  }, [token]);
  if (shared === null) return <main class="column"><p class="quiet">Loading the shared event.</p></main>;
  if (shared === false) return <main class="column bare"><h1>This link no longer works.</h1></main>;
  const replyText: Record<string, string> = { yes: "Yes", no: "No", maybe: "Maybe", invited: "Waiting" };
  return (
    <main class="column bare">
      <h1>{shared.title}</h1>
      {shared.clocks.length > 0 && <ThreeClocks clocks={shared.clocks} baseDate={shared.start_local.slice(0, 10)} />}
      <p class="when">{shared.all_day ? `${dayLabel(shared.start_local)} to ${dayLabel(shared.end_local)}` : `${dayLabel(shared.start_local.slice(0, 10))} ${shared.start_local.slice(11)} to ${shared.end_local.slice(11)} ${CITY_OF[shared.zone]}`}</p>
      {!!shared.location && <p class="muted">{shared.location}</p>}
      <p class="muted">{`Organised by ${shared.organiser_name}`}</p>
      <ul aria-label="Guests" class="rows">
        {shared.guests.map((g) => <li key={g.name}>{`${g.name}: ${replyText[g.answer]}`}</li>)}
      </ul>
    </main>
  );
}

