// The board's day dialog (place, release, challenge, open Confirm) and the Confirm booking dialog above it.
// A refusal keeps the dialog open with every typed value and moves focus to the refusal; a 422 moves focus to
// the first invalid field; an ended session closes the dialog after keeping its values.

import { useEffect, useRef, useState } from "react";
import { api, newKey, type ApiErrorBody } from "../../../api.js";
import { Link } from "../../../router.js";
import { Dialog } from "../../../ui/dialog.js";
import { Button } from "../../../ui/button.js";
import { Checkbox, FieldError, RadioGroup, Select, TextArea, TextField } from "../../../ui/fields.js";
import { Problems, useFormErrors } from "../../../ui/problems.js";
import { formatDate, formatOfficeTime, listJoin, ordinal } from "../../../../shared/format.js";
import type { OfficeId } from "../../../../shared/zones.js";
import { endedSession, isLive, useFocusAfterRender, type Booking, type ClientSummary, type Ladder, type LadderDay, type OptionRecord,
  type TalentSummary } from "./common.js";

export interface DayValues {
  client: string;
  jobTitle: string;
  note: string;
  holdUntil: string;
}

const EMPTY: DayValues = { client: "", jobTitle: "", note: "", holdUntil: "" };

/** The published refusal copy for an option action; `office` sets the zone of every time shown. */
function refusalCopy(error: ApiErrorBody, office: OfficeId, company: string): string {
  const at = (key: string) => (typeof error[key] === "string" ? formatOfficeTime(error[key] as string, office) : "");
  switch (error.error) {
    case "ladder_full": return "This day already holds three options.";
    case "client_already_holds": return `${company} already holds an option on this day.`;
    case "day_booked": return "This day is already booked.";
    case "option_released": return `This option was released at ${at("releasedAt")}.`;
    case "not_second": return "Only the 2nd option can challenge the 1st.";
    case "already_challenged": return `The 1st option is already challenged until ${at("challengeDeadline")}.`;
    case "challenge_expired": return `The challenge deadline passed at ${at("challengeDeadline")}, so this option is being released.`;
    case "already_booked": return `Not booked: ${String(error.bookedBy ?? "")} confirmed this day first, at ${at("bookedAt")}.`;
    case "not_first": return "Only the 1st option can be confirmed.";
    case "billing_unavailable": return "Billing is unreachable, so nothing was booked. The option is still 1st. Try again in a few minutes.";
    default: return "That did not go through. Reload the board and try again.";
  }
}

/** A refusal message inside a dialog that takes focus when it appears. */
function Refusal({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (text) ref.current?.focus();
  }, [text]);
  if (!text) return null;
  return <p ref={ref} tabIndex={-1} className="refusal">{text}</p>;
}

/** The control id of the first invalid field, in the dialog's order. */
function firstInvalid(ids: string[], errors: Record<string, string>, fields: Record<string, string>): string | undefined {
  return ids.find((id) => Object.entries(fields).some(([key, field]) => field === id && errors[key]));
}

const DAY_FIELDS: Record<string, string> = { clientId: "day-client", jobTitle: "day-job", note: "day-note",
  holdUntilLocal: "day-hold" };

export function DayDialog({ talent, office, date, initial, day, clients, reloadClients, reference, announce, onConfirm, onDone,
  onSessionEnded, onClose }: {
  talent: TalentSummary;
  office: OfficeId;
  date: string;
  initial?: DayValues;
  day: LadderDay;
  clients: ClientSummary[];
  reloadClients: () => Promise<ClientSummary[]>;
  reference: (bookingId: string) => string | undefined;
  announce: (text: string) => void;
  onConfirm: (option: OptionRecord) => void;
  onDone: (copy: string) => Promise<void>;
  onSessionEnded: (copy: string) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<DayValues>(initial ?? EMPTY);
  const [pending, setPending] = useState("");
  const [refusal, setRefusal] = useState("");
  const [key] = useState(newKey);
  const form = useFormErrors(DAY_FIELDS);
  const focusLater = useFocusAfterRender();
  const set = (field: keyof DayValues) => (value: string) => setValues((v) => ({ ...v, [field]: value }));
  const live = day.options.filter(isLive).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const booked = day.options.find((option) => option.state === "confirmed");

  const refused = (error: ApiErrorBody, company: string): void => {
    const ended = endedSession(error, "day", { date, ...values });
    if (ended) {
      onSessionEnded(ended);
      return;
    }
    if (error.error === "validation" && error.errors) {
      const { date: dateError, talentId: talentError, ...fields } = error.errors;
      if (fields.clientId && values.client.trim()) fields.clientId = "Enter a client company from the agency's client list.";
      form.set(fields);
      setRefusal(dateError ?? talentError ?? "");
      announce(Object.keys(fields).length === 1 ? "Please fix 1 problem." : `Please fix ${Object.keys(fields).length} problems.`);
      const first = firstInvalid(["day-client", "day-job", "day-note", "day-hold"], fields, DAY_FIELDS);
      if (first) focusLater(() => document.getElementById(first));
      return;
    }
    form.clear();
    setRefusal(refusalCopy(error, office, company));
  };

  const place = async () => {
    const company = values.client.trim();
    const matches = (list: ClientSummary[]) => list.find((c) => c.company.toLowerCase() === company.toLowerCase());
    const client = matches(clients) ?? (company ? matches(await reloadClients()) : undefined);
    setPending("place");
    const result = await api<{ option: OptionRecord }>("POST", "/api/options", {
      talentId: talent.id, clientId: client?.id ?? "", date, jobTitle: values.jobTitle, note: values.note,
      holdUntilLocal: values.holdUntil || null,
    }, { idempotencyKey: key });
    setPending("");
    if (result.ok) {
      const option = result.data.option;
      await onDone(`Placed ${ordinal(option.rank ?? 1)} option for ${option.clientCompany} on ${formatDate(date)}.`);
      return;
    }
    refused(result.error, client?.company ?? company);
  };

  const release = async (option: OptionRecord) => {
    setPending(`release:${option.id}`);
    const result = await api<{ option: OptionRecord; ladder: OptionRecord[] }>("POST", `/api/options/${option.id}/release`, {});
    setPending("");
    if (result.ok) {
      const next = result.data.ladder.find((o) => o.rank === 1);
      const promoted = option.rank === 1 && next ? ` ${next.clientCompany} now holds 1st.` : "";
      await onDone(`Released ${option.clientCompany}'s option.${promoted}`);
      return;
    }
    refused(result.error, option.clientCompany);
  };

  const challenge = async (option: OptionRecord) => {
    setPending(`challenge:${option.id}`);
    const result = await api<{ ladder: OptionRecord[] }>("POST", `/api/options/${option.id}/challenge`, {});
    setPending("");
    if (result.ok) {
      const first = result.data.ladder.find((o) => o.rank === 1);
      await onDone(`Challenged ${first?.clientCompany ?? ""}'s 1st option. It must be answered by ${
        first?.challengeDeadline ? formatOfficeTime(first.challengeDeadline, office) : ""}.`);
      return;
    }
    refused(result.error, option.clientCompany);
  };

  return (
    <Dialog title={`${talent.displayName}, ${formatDate(date)}`} onClose={onClose} sheet wide
      actions={<Button pending={pending === "place"} pendingLabel="Placing option…" onClick={() => void place()}>
        Place option</Button>}>
      <>
        <Problems items={form.problems} focusOnShow={false} />
        <Refusal text={refusal} />
        {booked ? (
          <div className="dialog-chip" data-rank="1" data-state="booked">
            <p><strong>Booked</strong> {booked.clientCompany} — {booked.jobTitle}</p>
            {day.bookingId && reference(day.bookingId) ? (
              <Link href={`/workspace/bookings/${day.bookingId}`}>View booking {reference(day.bookingId)}</Link>
            ) : null}
          </div>
        ) : null}
        {live.length ? (
          <ul className="dialog-chips" aria-label="Options on this day">
            {live.map((option) => (
              <li key={option.id} className="dialog-chip" data-rank={option.rank ?? undefined}
                data-state={option.state === "placed" ? "option" : option.state}>
                <p className="dialog-chip-title"><span className="tnum">{ordinal(option.rank ?? 1)}</span> {option.clientCompany}</p>
                <p className="muted">{option.jobTitle}{option.note ? ` — ${option.note}` : ""}</p>
                {option.state === "challenged" && option.challengeDeadline ? (
                  <p className="dialog-chip-note">Challenged until {formatOfficeTime(option.challengeDeadline, office)}</p>
                ) : null}
                <p className="muted">Releases {formatOfficeTime(option.releaseAt, office)}</p>
                <div className="btn-row">
                  <Button variant="quiet" pending={pending === `release:${option.id}`} pendingLabel="Releasing…"
                    onClick={() => void release(option)}>Release</Button>
                  {option.rank === 1 ? (
                    <Button variant="quiet" onClick={() => onConfirm(option)}>Confirm</Button>
                  ) : null}
                  {option.rank === 2 ? (
                    <Button variant="quiet" pending={pending === `challenge:${option.id}`} pendingLabel="Sending challenge…"
                      onClick={() => void challenge(option)}>Challenge</Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : !booked ? <p className="muted">No options on this day yet.</p> : null}
        <form noValidate className="stack" onSubmit={(event) => {
          event.preventDefault();
          void place();
        }}>
          <h3>Place an option</h3>
          <TextField id="day-client" label="Client" value={values.client} onChange={set("client")}
            error={form.error("clientId")} autoComplete="off" />
          <TextField id="day-job" label="Job title" value={values.jobTitle} onChange={set("jobTitle")}
            error={form.error("jobTitle")} />
          <TextArea id="day-note" label="Note" value={values.note} onChange={set("note")} rows={2}
            error={form.error("note")} />
          <TextField id="day-hold" label="Hold until" type="datetime-local" value={values.holdUntil}
            onChange={set("holdUntil")} error={form.error("holdUntilLocal")}
            hint={`Optional, in ${office === "toronto" ? "Toronto" : "Vancouver"} time; before the automatic release.`} />
        </form>
      </>
    </Dialog>
  );
}

interface UsageRow {
  media: string;
  territory: string;
  term: string;
}

const MEDIA = [{ value: "digital", label: "Digital" }, { value: "print", label: "Print" },
  { value: "out_of_home", label: "Out of home" }, { value: "broadcast", label: "Broadcast" }];
const TERRITORIES = [{ value: "canada", label: "Canada" }, { value: "north_america", label: "North America" },
  { value: "worldwide", label: "Worldwide" }];
const TERMS = [{ value: "3", label: "3 months" }, { value: "6", label: "6 months" }, { value: "12", label: "12 months" }];
const CONFIRM_FIELDS: Record<string, string> = { dayType: "confirm-day-type", overtimeMinutes: "confirm-overtime",
  usage: "confirm-add-usage" };

interface Partner {
  talent: TalentSummary;
  option: OptionRecord;
}

/** Other talent of the office whose 1st option on the same day is held by the same client. */
async function partners(option: OptionRecord, talent: TalentSummary): Promise<Partner[]> {
  const roster = await api<{ talent: TalentSummary[] }>("GET", `/api/talent?office=${talent.office}&state=active`);
  if (!roster.ok) return [];
  const others = roster.data.talent.filter((t) => t.id !== talent.id);
  const found: Partner[] = [];
  for (let i = 0; i < others.length; i += 8) {
    const batch = await Promise.all(others.slice(i, i + 8).map(async (other) => {
      const ladder = await api<Ladder>("GET", `/api/talent/${other.id}/ladder?from=${option.date}&days=1`);
      const first = ladder.ok ? ladder.data.days[0]?.options.find((o) => isLive(o) && o.rank === 1) : undefined;
      return first && first.clientId === option.clientId ? { talent: other, option: first } : null;
    }));
    found.push(...batch.filter((partner): partner is Partner => partner !== null));
  }
  return found.sort((a, b) => a.talent.displayName.localeCompare(b.talent.displayName));
}

export function ConfirmDialog({ option, talent, office, onClose, onBooked, onSessionEnded }: {
  option: OptionRecord;
  talent: TalentSummary;
  office: OfficeId;
  onClose: () => void;
  onBooked: (copy: string, booking: Booking) => Promise<void>;
  onSessionEnded: (copy: string) => void;
}) {
  const [dayType, setDayType] = useState("full_day");
  const [overtime, setOvertime] = useState("");
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [others, setOthers] = useState<Partner[] | null>(null);
  const [also, setAlso] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState("");
  const form = useFormErrors(CONFIRM_FIELDS);
  const focusLater = useFocusAfterRender();

  useEffect(() => {
    void partners(option, talent).then(setOthers);
  }, [option, talent]);

  const submitBooking = async () => {
    const minutes = overtime.trim() === "" ? 0 : /^\d+$/.test(overtime.trim()) ? Number(overtime.trim()) : overtime;
    const rows = [option.id, ...also].map((optionId) => ({
      optionId, dayType, overtimeMinutes: minutes,
      usage: usage.map((row) => ({ media: row.media, territory: row.territory, termMonths: Number(row.term) })),
    }));
    setPending(true);
    const result = await api<{ booking: Booking }>("POST", "/api/bookings", { options: rows });
    setPending(false);
    if (result.ok) {
      const booking = result.data.booking;
      await onBooked(`Booked ${listJoin(booking.talent.map((t) => t.displayName))} for ${booking.clientCompany} on ${
        formatDate(booking.date)}. The confirmation email is on its way.`, booking);
      return;
    }
    const ended = endedSession(result.error, "day", { date: option.date, client: option.clientCompany, jobTitle: "",
      note: "", holdUntil: "" });
    if (ended) {
      onSessionEnded(ended);
      return;
    }
    if (result.error.error === "validation" && result.error.errors) {
      const { options: groupError, ...fields } = result.error.errors;
      form.set(fields);
      setRefusal(groupError ?? "");
      const first = firstInvalid(["confirm-day-type", "confirm-overtime", "confirm-add-usage"], fields, CONFIRM_FIELDS);
      if (first) focusLater(() => document.getElementById(first));
      return;
    }
    form.clear();
    setRefusal(refusalCopy(result.error, office, option.clientCompany));
  };

  const setRow = (index: number, field: keyof UsageRow) => (value: string) =>
    setUsage((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));

  return (
    <Dialog title="Confirm booking" onClose={onClose} sheet wide
      actions={<Button pending={pending} pendingLabel="Confirming booking…" onClick={() => void submitBooking()}>
        Confirm booking</Button>}>
      <Problems items={form.problems} focusOnShow={false} />
      <Refusal text={refusal} />
      <p className="muted">{talent.displayName} for {option.clientCompany} on {formatDate(option.date)} — {option.jobTitle}</p>
      <form noValidate className="stack" onSubmit={(event) => {
        event.preventDefault();
        void submitBooking();
      }}>
        <RadioGroup id="confirm-day-type" label="Day type" name="day-type" value={dayType} onChange={setDayType}
          choices={[{ value: "full_day", label: "Full day" }, { value: "half_day", label: "Half day" }]}
          error={form.error("dayType")} />
        <TextField id="confirm-overtime" label="Overtime minutes" inputMode="numeric" value={overtime}
          onChange={setOvertime} error={form.error("overtimeMinutes")} hint="Charged per started quarter hour, up to 600." />
        {usage.map((row, index) => (
          <div key={index} role="group" aria-label={`Usage line ${index + 1}`} className="usage-row">
            <Select id={`usage-${index}-media`} label="Media" choices={MEDIA} value={row.media} onChange={setRow(index, "media")} />
            <Select id={`usage-${index}-territory`} label="Territory" choices={TERRITORIES} value={row.territory}
              onChange={setRow(index, "territory")} />
            <Select id={`usage-${index}-term`} label="Term" choices={TERMS} value={row.term} onChange={setRow(index, "term")} />
            <Button variant="text" onClick={() => setUsage((rows) => rows.filter((_, i) => i !== index))}>
              Remove usage line {index + 1}</Button>
          </div>
        ))}
        <div>
          <Button id="confirm-add-usage" variant="quiet"
            onClick={() => setUsage((rows) => [...rows, { media: "digital", territory: "canada", term: "3" }])}>
            Add usage</Button>
          <FieldError id="confirm-add-usage" error={form.error("usage")} />
        </div>
        <fieldset className="also-book">
          <legend className="group-label">Also book</legend>
          <div role="group" aria-label="Also book">
            {others === null ? <p className="muted">Checking other talent on this day…</p> : others.length ? (
              others.map((partner) => (
                <Checkbox key={partner.option.id} id={`also-${partner.option.id}`} label={partner.talent.displayName}
                  checked={also.includes(partner.option.id)} onChange={(checked) => setAlso((ids) =>
                    checked ? [...ids, partner.option.id] : ids.filter((id) => id !== partner.option.id))} />
              ))
            ) : (
              <p className="muted">No other talent holds a 1st option for {option.clientCompany} on this day.</p>
            )}
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
