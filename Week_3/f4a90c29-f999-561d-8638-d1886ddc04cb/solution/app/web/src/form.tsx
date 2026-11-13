import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, describe, send } from "./api";
import { ZONES, CITY_OF, apiWall, dateOf, parseDate, parseWall, serverNow, typedWall, wallInZone, WEEKDAY_NAMES, type Wall } from "./time";
import { announce } from "./status";
import { askScope, saveEvent } from "./eventsvc";
import { bump, calendars$, draft$ } from "./state";
import { Store, useStore } from "./store";
import { Modal } from "./ui";
import type { CalendarInfo, Item, Me, Zone } from "./types";

export interface FormValues {
  title: string;
  calendar_id: string;
  kind: "event" | "focus" | "out_of_office";
  colour: string;
  all_day: boolean;
  starts: string;
  ends: string;
  zone: Zone;
  location: string;
  notes: string;
  isPrivate: boolean;
  reminders: string;
  repeat: "none" | "daily" | "weekly" | "monthly" | "yearly";
  byDays: string[];
  monthlyBy: "day" | "nth" | "last";
  endMode: "never" | "date" | "count";
  endDate: string;
  occurrences: string;
  decline: "new_only" | "new_and_existing";
  declineMessage: string;
  guestIds: string[];
}

const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NTH = ["first", "second", "third", "fourth"];
const CODE_OF_WEEKDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const KIND_LABELS: Record<string, string> = { event: "Event", focus: "Focus time", out_of_office: "Out of office" };
const COLOURS: [string, string][] = [["calendar", "Calendar colour"], ["rose", "Rose"], ["amber", "Amber"], ["teal", "Teal"], ["indigo", "Indigo"]];

export function editableCalendars(calendars: CalendarInfo[]): CalendarInfo[] {
  return calendars.filter((c) => ["owner", "manage", "edit"].includes(c.level));
}

export function defaultValues(me: Me, start: Wall, end: Wall, allDay = false): FormValues {
  const calendars = editableCalendars(calendars$.get());
  return {
    title: "",
    calendar_id: (calendars.find((c) => c.owner_id === me.id) ?? calendars[0])?.id ?? "",
    kind: "event",
    colour: "calendar",
    all_day: allDay,
    starts: allDay ? dateOf(start) : typedWall(start),
    ends: allDay ? dateOf(end) : typedWall(end),
    zone: me.zone,
    location: "",
    notes: "",
    isPrivate: false,
    reminders: "",
    repeat: "none",
    byDays: [],
    monthlyBy: "day",
    endMode: "never",
    endDate: "",
    occurrences: "",
    decline: "new_and_existing",
    declineMessage: "",
    guestIds: [],
  };
}

function parseRule(rule: string | null | undefined, v: FormValues): FormValues {
  if (!rule) return v;
  const parts = Object.fromEntries(rule.split(";").map((p) => p.split("=") as [string, string]));
  const next: FormValues = { ...v, repeat: parts.FREQ.toLowerCase() as FormValues["repeat"] };
  if (parts.FREQ === "WEEKLY" && parts.BYDAY) next.byDays = parts.BYDAY.split(",");
  if (parts.FREQ === "MONTHLY" && parts.BYDAY) next.monthlyBy = parts.BYDAY.startsWith("-1") ? "last" : "nth";
  if (parts.UNTIL) {
    next.endMode = "date";
    next.endDate = `${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}`;
  }
  if (parts.COUNT) {
    next.endMode = "count";
    next.occurrences = parts.COUNT;
  }
  return next;
}

export function valuesFromItem(item: Item): FormValues {
  const allDay = item.all_day;
  const base: FormValues = {
    title: item.title,
    calendar_id: item.calendar_id,
    kind: (item.kind as FormValues["kind"]) ?? "event",
    colour: item.colour ?? "calendar",
    all_day: allDay,
    starts: allDay ? item.start_local : item.start_local.replace("T", " "),
    ends: allDay ? item.end_local : item.end_local.replace("T", " "),
    zone: item.zone,
    location: item.location ?? "",
    notes: item.notes ?? "",
    isPrivate: item.visibility === "private",
    reminders: (item.reminders ?? []).join(","),
    repeat: "none",
    byDays: [],
    monthlyBy: "day",
    endMode: "never",
    endDate: "",
    occurrences: "",
    decline: (item.decline_mode as FormValues["decline"]) ?? "new_and_existing",
    declineMessage: item.decline_message ?? "",
    guestIds: [],
  };
  return parseRule(item.rrule, base);
}

type Draft = Record<string, unknown>;

/** Key-sorted JSON, so a draft compares equal to its own echo from the server. */
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** What the server keeps for an unsaved new event: the form fields under their API names. */
function draftOf(v: FormValues): Draft {
  return {
    title: v.title, calendar_id: v.calendar_id, kind: v.kind, colour: v.colour, all_day: v.all_day, start_local: v.starts, end_local: v.ends,
    zone: v.zone, location: v.location, notes: v.notes, visibility: v.isPrivate ? "private" : "default", rrule: ruleText(v) ?? "",
    decline_mode: v.decline, decline_message: v.declineMessage, guest_ids: v.guestIds,
    reminders: v.reminders.split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).map(Number),
  };
}

export function valuesFromDraft(d: Draft, me: Me): FormValues {
  const today = wallInZone(serverNow(), me.zone);
  const base = defaultValues(me, today, today);
  const str = (k: string, fallback: string) => (typeof d[k] === "string" ? (d[k] as string) : fallback);
  const v: FormValues = {
    ...base,
    title: str("title", ""),
    calendar_id: str("calendar_id", base.calendar_id),
    kind: str("kind", "event") as FormValues["kind"],
    colour: str("colour", "calendar"),
    all_day: d.all_day === true,
    starts: str("start_local", base.starts),
    ends: str("end_local", base.ends),
    zone: str("zone", me.zone) as Zone,
    location: str("location", ""),
    notes: str("notes", ""),
    isPrivate: d.visibility === "private",
    reminders: Array.isArray(d.reminders) ? (d.reminders as number[]).join(",") : "",
    decline: str("decline_mode", "new_and_existing") as FormValues["decline"],
    declineMessage: str("decline_message", ""),
    guestIds: Array.isArray(d.guest_ids) ? (d.guest_ids as string[]) : [],
  };
  return parseRule(str("rrule", "") || null, v);
}

function startWall(v: FormValues): Wall | null {
  return parseWall(v.starts);
}

function monthlyChoices(start: Wall | null): { value: FormValues["monthlyBy"]; label: string }[] {
  if (start === null) return [{ value: "day", label: "On day 1" }];
  const date = new Date(start);
  const day = date.getUTCDate();
  const name = WEEKDAY_NAMES[date.getUTCDay()];
  const out: { value: FormValues["monthlyBy"]; label: string }[] = [{ value: "day", label: `On day ${day}` }];
  if ((day - 1) / 7 < 4 && Math.floor((day - 1) / 7) < 4) out.push({ value: "nth", label: `On the ${NTH[Math.floor((day - 1) / 7)]} ${name}` });
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  if (day + 7 > lastDay) out.push({ value: "last", label: `On the last ${name}` });
  return out;
}

/** The repeat rule the controls describe, or null for no repeat. */
function ruleText(v: FormValues): string | null {
  const start = startWall(v);
  if (v.repeat === "none" || start === null) return null;
  const parts = [`FREQ=${v.repeat.toUpperCase()}`];
  const date = new Date(start);
  if (v.repeat === "weekly") {
    const own = CODE_OF_WEEKDAY[date.getUTCDay()];
    const chosen = new Set([...v.byDays, own]);
    parts.push("BYDAY=" + DAY_CODES.filter((c) => chosen.has(c)).join(","));
  }
  if (v.repeat === "monthly" && v.monthlyBy !== "day" && monthlyChoices(start).some((c) => c.value === v.monthlyBy)) {
    const nth = v.monthlyBy === "last" ? "-1" : String(Math.floor((date.getUTCDate() - 1) / 7) + 1);
    parts.push(`BYDAY=${nth}${CODE_OF_WEEKDAY[date.getUTCDay()]}`);
  }
  if (v.endMode === "date" && parseDate(v.endDate) !== null) parts.push("UNTIL=" + v.endDate.replaceAll("-", ""));
  if (v.endMode === "count" && /^\d+$/.test(v.occurrences)) parts.push("COUNT=" + v.occurrences);
  return parts.join(";");
}

interface Built {
  payload: Record<string, unknown>;
  errors: Record<string, string>;
}

function build(v: FormValues): Built {
  const errors: Record<string, string> = {};
  if (v.title.trim() === "") errors.title = "Enter a title.";
  const formatCopy = v.all_day ? "Use YYYY-MM-DD." : "Use YYYY-MM-DD HH:MM.";
  const start = v.all_day ? parseDate(v.starts.trim()) : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v.starts.trim()) ? parseWall(v.starts) : null;
  const end = v.all_day ? parseDate(v.ends.trim()) : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v.ends.trim()) ? parseWall(v.ends) : null;
  if (start === null) errors.starts = formatCopy;
  if (end === null) errors.ends = formatCopy;
  if (start !== null && end !== null && (v.all_day ? end < start : end <= start)) errors.ends = "End must be after start.";
  if (v.reminders.trim() !== "" && !/^\d+(\s*,\s*\d+)*$/.test(v.reminders.trim())) errors.reminders = "Use whole minutes separated by commas, like 10,60.";
  if (v.repeat !== "none" && v.endMode === "date" && parseDate(v.endDate.trim()) === null) errors.endDate = "Use YYYY-MM-DD.";
  if (v.repeat !== "none" && v.endMode === "count" && !/^\d+$/.test(v.occurrences.trim())) errors.occurrences = "Use a whole number from 1 to 999.";
  const payload: Record<string, unknown> = {
    title: v.title.trim(), calendar_id: v.calendar_id, kind: v.kind, colour: v.colour, all_day: v.all_day,
    start_local: start === null ? v.starts : v.all_day ? dateOf(start) : apiWall(start),
    end_local: end === null ? v.ends : v.all_day ? dateOf(end) : apiWall(end),
    zone: v.zone, location: v.location, notes: v.notes, visibility: v.isPrivate ? "private" : "default",
    reminders: v.all_day || v.reminders.trim() === "" ? [] : v.reminders.split(",").map((s) => Number(s.trim())),
    rrule: ruleText({ ...v, endDate: v.endDate.trim(), occurrences: v.occurrences.trim() }),
  };
  if (v.kind === "focus") payload.decline_mode = v.decline;
  if (v.kind === "out_of_office") payload.decline_message = v.declineMessage.trim() === "" ? null : v.declineMessage.trim();
  if (v.guestIds.length > 0) payload.guest_ids = v.guestIds;
  return { payload, errors };
}

function Field({ id, label, error, half, children }: { id: string; label: string; error?: string; half?: boolean; children: preact.ComponentChildren }) {
  return (
    <div class={half ? "field half" : "field"}>
      <label for={id}>{label}</label>
      {children}
      {error && (
        <p class="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

interface FormProps {
  values: FormValues;
  onChange: (next: FormValues) => void;
  errors: Record<string, string>;
  prefix: string;
  me: Me;
  original?: boolean;
}

/** The fields of the New event and Edit event dialogs and of the event page. */
export function EventFields({ values: v, onChange, errors, prefix, me }: FormProps) {
  const calendars = editableCalendars(useStore(calendars$));
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => onChange({ ...v, [key]: value });
  const id = (name: string) => `${prefix}-${name}`;
  const start = startWall(v);
  const choices = monthlyChoices(start);
  const monthly = choices.some((c) => c.value === v.monthlyBy) ? v.monthlyBy : "day";
  const toggleAllDay = (on: boolean) => {
    const s = parseWall(v.starts) ?? wallInZone(serverNow(), me.zone);
    const day = dateOf(s);
    onChange({ ...v, all_day: on, starts: on ? day : `${day} 09:00`, ends: on ? day : `${day} 10:00` });
  };
  return (
    <>
      <Field id={id("title")} label="Title" error={errors.title}>
        <input id={id("title")} type="text" value={v.title} data-autofocus onInput={(e) => set("title", e.currentTarget.value)} aria-describedby={errors.title ? id("title-error") : undefined} />
      </Field>
      <Field id={id("calendar")} label="Calendar" half>
        <select id={id("calendar")} value={v.calendar_id} onChange={(e) => set("calendar_id", e.currentTarget.value)}>
          {calendars.map((c) => (
            <option value={c.id} key={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id={id("kind")} label="Kind" half>
        <select id={id("kind")} value={v.kind} onChange={(e) => set("kind", e.currentTarget.value as FormValues["kind"])}>
          {Object.entries(KIND_LABELS).map(([value, text]) => (
            <option value={value} key={value}>
              {text}
            </option>
          ))}
        </select>
      </Field>
      <Field id={id("colour")} label="Colour" half>
        <select id={id("colour")} value={v.colour} onChange={(e) => set("colour", e.currentTarget.value)}>
          {COLOURS.map(([value, text]) => (
            <option value={value} key={value}>
              {text}
            </option>
          ))}
        </select>
      </Field>
      <label class="check">
        <input type="checkbox" checked={v.all_day} onChange={(e) => toggleAllDay(e.currentTarget.checked)} />
        All day
      </label>
      <Field id={id("starts")} label="Starts" error={errors.starts} half>
        <input id={id("starts")} type="text" value={v.starts} onInput={(e) => set("starts", e.currentTarget.value)} autocomplete="off" placeholder={v.all_day ? "YYYY-MM-DD" : "YYYY-MM-DD HH:MM"} />
      </Field>
      <Field id={id("ends")} label="Ends" error={errors.ends} half>
        <input id={id("ends")} type="text" value={v.ends} onInput={(e) => set("ends", e.currentTarget.value)} autocomplete="off" placeholder={v.all_day ? "YYYY-MM-DD" : "YYYY-MM-DD HH:MM"} />
      </Field>
      <Field id={id("zone")} label="Zone" half>
        <select id={id("zone")} value={v.zone} onChange={(e) => set("zone", e.currentTarget.value as Zone)}>
          {ZONES.map((z) => (
            <option value={z} key={z}>
              {CITY_OF[z]}
            </option>
          ))}
        </select>
      </Field>
      <Field id={id("location")} label="Location" half>
        <input id={id("location")} type="text" value={v.location} onInput={(e) => set("location", e.currentTarget.value)} />
      </Field>
      <Field id={id("notes")} label="Notes">
        <textarea id={id("notes")} rows={3} value={v.notes} onInput={(e) => set("notes", e.currentTarget.value)} />
      </Field>
      <label class="check">
        <input type="checkbox" checked={v.isPrivate} onChange={(e) => set("isPrivate", e.currentTarget.checked)} />
        Private
      </label>
      {!v.all_day && (
        <Field id={id("reminders")} label="Reminder minutes" error={errors.reminders}>
          <input id={id("reminders")} type="text" value={v.reminders} onInput={(e) => set("reminders", e.currentTarget.value)} autocomplete="off" />
        </Field>
      )}
      <div role="radiogroup" aria-label="Repeat" class="choice">
        {(["none", "daily", "weekly", "monthly", "yearly"] as const).map((r) => (
          <label class="radio" key={r}>
            <input type="radio" name={id("repeat")} checked={v.repeat === r} onChange={() => set("repeat", r)} />
            {r === "none" ? "Does not repeat" : r[0].toUpperCase() + r.slice(1)}
          </label>
        ))}
      </div>
      {errors.rrule && <p class="field-error">{errors.rrule}</p>}
      {v.repeat === "weekly" && (
        <div role="group" aria-label="Repeat on" class="choice">
          {DAY_SHORT.map((name, i) => {
            const own = start !== null && CODE_OF_WEEKDAY[new Date(start).getUTCDay()] === DAY_CODES[i];
            const on = own || v.byDays.includes(DAY_CODES[i]);
            return (
              <label class="check" key={name}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    set("byDays", e.currentTarget.checked ? [...v.byDays, DAY_CODES[i]] : v.byDays.filter((c) => c !== DAY_CODES[i]))
                  }
                />
                {name}
              </label>
            );
          })}
        </div>
      )}
      {v.repeat === "monthly" && (
        <div role="radiogroup" aria-label="Monthly by" class="choice">
          {choices.map((c) => (
            <label class="radio" key={c.value}>
              <input type="radio" name={id("monthly")} checked={monthly === c.value} onChange={() => set("monthlyBy", c.value)} />
              {c.label}
            </label>
          ))}
        </div>
      )}
      {v.repeat !== "none" && (
        <div role="radiogroup" aria-label="Ends" class="choice">
          <label class="radio">
            <input type="radio" name={id("ends-mode")} checked={v.endMode === "never"} onChange={() => set("endMode", "never")} />
            Never
          </label>
          <label class="radio">
            <input type="radio" name={id("ends-mode")} checked={v.endMode === "date"} onChange={() => set("endMode", "date")} />
            On date
          </label>
          {v.endMode === "date" && (
            <Field id={id("end-date")} label="End date" error={errors.endDate}>
              <input id={id("end-date")} type="text" value={v.endDate} onInput={(e) => set("endDate", e.currentTarget.value)} placeholder="YYYY-MM-DD" />
            </Field>
          )}
          <label class="radio">
            <input type="radio" name={id("ends-mode")} checked={v.endMode === "count"} onChange={() => set("endMode", "count")} />
            After a number
          </label>
          {v.endMode === "count" && (
            <Field id={id("occurrences")} label="Occurrences" error={errors.occurrences}>
              <input id={id("occurrences")} type="number" min={1} max={999} value={v.occurrences} onInput={(e) => set("occurrences", e.currentTarget.value)} />
            </Field>
          )}
        </div>
      )}
      {v.kind === "focus" && (
        <div role="radiogroup" aria-label="Decline" class="choice">
          <label class="radio">
            <input type="radio" name={id("decline")} checked={v.decline === "new_only"} onChange={() => set("decline", "new_only")} />
            Only new invitations
          </label>
          <label class="radio">
            <input type="radio" name={id("decline")} checked={v.decline === "new_and_existing"} onChange={() => set("decline", "new_and_existing")} />
            New and existing meetings
          </label>
        </div>
      )}
      {v.kind === "out_of_office" && (
        <Field id={id("decline-message")} label="Decline message" error={errors.declineMessage}>
          <input id={id("decline-message")} type="text" value={v.declineMessage} onInput={(e) => set("declineMessage", e.currentTarget.value)} />
        </Field>
      )}
      <p class="muted-note" hidden>
        {me.id}
      </p>
    </>
  );
}

const FIELD_ORDER = ["title", "starts", "ends", "reminders", "endDate", "occurrences", "rrule", "declineMessage"];

/** Field errors as a linked summary at the top of the form. */
export function ErrorSummary({ errors, prefix }: { errors: Record<string, string>; prefix: string }) {
  const ids: Record<string, string> = {
    title: "title", starts: "starts", ends: "ends", reminders: "reminders", endDate: "end-date", occurrences: "occurrences",
    declineMessage: "decline-message", rrule: "repeat",
  };
  const keys = FIELD_ORDER.filter((k) => errors[k]);
  if (keys.length === 0) return null;
  return (
    <ul class="error-summary" aria-label="Fix these fields">
      {keys.map((k) => (
        <li key={k}>
          <a
            href={`#${prefix}-${ids[k]}`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(`${prefix}-${ids[k]}`)?.focus();
            }}
          >
            {errors[k]}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Maps server field errors onto form fields. */
function fromServer(fields: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = { start_local: "starts", end_local: "ends", decline_message: "declineMessage" };
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [map[k] ?? k, v]));
}

// ---- New event dialog (global, so the calendar, find a time and shortcuts all open the same one) ----

export const newEvent$ = new Store<{ values: FormValues; fallback?: () => void } | null>(null);

// Draft requests go one after another so a delete can never be overtaken by an earlier put.
let draftChain: Promise<unknown> = Promise.resolve();
const sentDrafts: string[] = [];
let pendingDrafts = 0;
let lastDraftMethod: "PUT" | "DELETE" | null = null;

function draftRequest(method: "PUT" | "DELETE", body?: Draft): void {
  if (body) sentDrafts.push(canon(body));
  pendingDrafts += 1;
  lastDraftMethod = method;
  draftChain = draftChain
    .then(() => send(method, "/api/draft", body))
    .catch(() => undefined)
    .then(() => {
      pendingDrafts -= 1;
    });
}

/** Whether a draft is one this browser sent itself (its echo from the live feed). */
export function isOwnDraft(draft: Draft): boolean {
  return sentDrafts.includes(canon(draft));
}

/** Whether this browser's latest draft request is a save still on its way: the server holds that draft once it lands,
 * so an empty draft seen meanwhile (the echo of an earlier delete) must not close the dialog. */
function savingDraft(): boolean {
  return pendingDrafts > 0 && lastDraftMethod === "PUT";
}
export const focusAfter$ = new Store<string | null>(null);

export function openNewEvent(values: FormValues, fallback?: () => void): void {
  newEvent$.set({ values, fallback });
  draftRequest("PUT", draftOf(values));
}

function closeNewEvent(): void {
  newEvent$.set(null);
  draftRequest("DELETE");
}

export function NewEventDialog({ me }: { me: Me }) {
  const open = useStore(newEvent$);
  const draft = useStore(draft$);
  const [values, setValues] = useState<FormValues | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const lastOpen = useRef(open);

  useEffect(() => {
    if (open && open !== lastOpen.current) {
      setValues(open.values);
      setErrors({});
    }
    if (!open) setValues(null);
    lastOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!draft.loaded || !values) return;
    if (draft.draft === null) {
      if (newEvent$.get() && !savingDraft()) newEvent$.set(null);
      return;
    }
    if (!isOwnDraft(draft.draft)) {
      sentDrafts.push(canon(draft.draft));
      setValues(valuesFromDraft(draft.draft, me));
    }
  }, [draft]);

  if (!open || !values) return null;

  const change = (next: FormValues) => {
    setValues(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      draftRequest("PUT", draftOf(next));
    }, 250);
  };
  const cancel = () => {
    clearTimeout(timer.current);
    closeNewEvent();
  };
  const save = async (event: Event) => {
    event.preventDefault();
    const built = build(values);
    setErrors(built.errors);
    if (Object.keys(built.errors).length > 0) return;
    setBusy(true);
    announce(`Saving ${values.title.trim()}...`);
    try {
      const reply = await send<Item>("POST", "/api/events", built.payload);
      clearTimeout(timer.current);
      announce(`Saved ${reply.data.title}.`);
      focusAfter$.set(reply.data.id as string);
      closeNewEvent();
      bump();
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fields).length > 0) setErrors(fromServer(error.fields));
      else announce(describe(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal label="New event" onClose={cancel} fallback={open.fallback} className="wide-dialog">
      <form onSubmit={save} noValidate class="dialog-form">
        <div class="dialog-fields">
        <h2>New event</h2>
        <ErrorSummary errors={errors} prefix="ne" />
        <EventFields values={values} onChange={change} errors={errors} prefix="ne" me={me} />
        </div>
        <div class="actions">
          <button type="submit" class="primary" disabled={busy}>
            Save
          </button>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---- Editing an existing event: shared by the Edit event dialog and the event page ----

/** Only the fields that changed, under their API names. */
function diff(now: Record<string, unknown>, before: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(now)) {
    if (key === "calendar_id" || key === "guest_ids") continue;
    if (JSON.stringify(value) !== JSON.stringify(before[key])) out[key] = value;
  }
  return out;
}

interface EditTarget {
  item: Item;
  occurrenceId?: string;
  fallback?: () => void;
}

export const editEvent$ = new Store<EditTarget | null>(null);

/** Saves edits after asking the scope for a repeating event. Returns true when saved. */
export async function submitEdit(
  item: Item,
  occurrenceId: string | undefined,
  now: FormValues,
  before: FormValues,
  setErrors: (e: Record<string, string>) => void,
  version: number,
): Promise<boolean> {
  const built = build(now);
  setErrors(built.errors);
  if (Object.keys(built.errors).length > 0) return false;
  const patch = diff(built.payload, build(before).payload);
  const recurring = Boolean(item.rrule);
  let scope;
  if (recurring) {
    scope = await askScope("edit", item.title);
    if (scope === null) return false;
  }
  try {
    const eventId = (item.event_id ?? item.id) as string;
    const result = await saveEvent({ id: eventId, title: now.title.trim(), version, patch, scope, occurrenceId: recurring ? occurrenceId : undefined });
    if (!result) return true;
    announce(`Saved ${result.event.title}.`);
    bump();
    return true;
  } catch (error) {
    if (error instanceof ApiError && Object.keys(error.fields).length > 0) setErrors(fromServer(error.fields));
    return false;
  }
}

export function EditEventDialog({ me }: { me: Me }) {
  const target = useStore(editEvent$);
  const [values, setValues] = useState<FormValues | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const before = useRef<FormValues | null>(null);
  const version = useRef(0);
  useEffect(() => {
    if (target) {
      const v = valuesFromItem(target.item);
      before.current = v;
      version.current = target.item.version as number;
      setValues(v);
      setErrors({});
    } else setValues(null);
  }, [target]);
  if (!target || !values || !before.current) return null;
  const close = () => editEvent$.set(null);
  const save = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    const ok = await submitEdit(target.item, target.occurrenceId, values, before.current as FormValues, setErrors, version.current);
    setBusy(false);
    if (ok) close();
  };
  return (
    <Modal label="Edit event" onClose={close} fallback={target.fallback} className="wide-dialog">
      <form onSubmit={save} noValidate class="dialog-form">
        <div class="dialog-fields">
        <h2>Edit event</h2>
        <ErrorSummary errors={errors} prefix="ee" />
        <EventFields values={values} onChange={setValues} errors={errors} prefix="ee" me={me} />
        </div>
        <div class="actions">
          <button type="submit" class="primary" disabled={busy}>
            Save
          </button>
          <button type="button" onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
