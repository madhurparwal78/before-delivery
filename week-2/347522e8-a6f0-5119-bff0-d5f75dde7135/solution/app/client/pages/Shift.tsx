// Shift: the usage sheet for one kitchen day (from the address), check-in, check-out and blocking a station.

import { LogIn, LogOut, Wrench } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { MaintenanceBlockView, StationsResponse, UsageRowView, UsageSheetResponse } from "../../shared/api.js";
import { SLOT_MINUTES, formatHHMM, isIsoDate, longDate, wallClockOf } from "../../shared/kitchenTime.js";
import { type ApiFailure, api } from "../api.js";
import { serverNow, syncServerClock } from "../clock.js";
import { Field } from "../components/Field.js";
import { EmptySpike, type Message, StatusRegion, failure, info, success } from "../components/Feedback.js";
import { Modal } from "../components/Modal.js";
import { copy } from "../copy.js";
import { navigate, usePlace } from "../router.js";
import { SHEET_WORDS } from "../words.js";

/** The server's kitchen time, rounded down to 15 minutes. */
function nowRounded(): string {
  const now = serverNow();
  if (now === null) return "";
  const minute = wallClockOf(now).minuteOfDay;
  return formatHHMM(minute - (minute % SLOT_MINUTES));
}

function shiftError(error: ApiFailure): string {
  if (error.error === "billing_unavailable") return copy.shift.billingDown;
  if (error.error === "station_in_use") return copy.shift.inUse;
  if (error.error === "slot_conflict") return "That station already has maintenance during that time.";
  if (error.error === "invalid_transition") return "That booking has already moved on; the sheet is refreshed.";
  if (error.error === "validation") return Object.values(error.errors ?? {})[0] ?? copy.unexpected;
  return copy.unexpected;
}

function ClockDialog({ row, mode, onClose, onDone, say }: { row: UsageRowView; mode: "in" | "out"; onClose: () => void; onDone: () => Promise<void>; say: (m: Message) => void }) {
  const [value, setValue] = useState(nowRounded);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = mode === "in" ? "actual_start" : "actual_end";

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    say(info(copy.shift.saving));
    const result = await api<{ booking: { overage_units: number | null; overage_usd: string | null } }>(
      `/api/bookings/${row.booking_id}/${mode === "in" ? "check-in" : "check-out"}`,
      { method: "POST", json: { [field]: value.trim() } },
    );
    setBusy(false);
    if (result.ok) {
      await onDone();
      const units = result.data.booking.overage_units ?? 0;
      say(
        success(
          mode === "in"
            ? copy.shift.checkedIn(value.trim())
            : units > 0
              ? copy.shift.checkedOutOverage(units, result.data.booking.overage_usd ?? "0.00")
              : copy.shift.checkedOutNone,
        ),
      );
      onClose();
      return;
    }
    if (result.status === 422) setError(result.error.errors?.[field] ?? copy.unexpected);
    say(failure(shiftError(result.error)));
  };

  return (
    <Modal title={mode === "in" ? "Check in" : "Check out"} onClose={onClose} lede={<p className="modal__lede">{`${row.renter_business_name} · ${row.station_name} · ${row.start}–${row.end}`}</p>}>
      <form className="form" noValidate onSubmit={(event) => void save(event)}>
        <Field label={mode === "in" ? "Actual start" : "Actual end"} placeholder="HH:MM" inputMode="numeric" value={value} onChange={(event) => setValue(event.target.value)} error={error} />
        <div className="modal__actions">
          <button type="submit" className="button button--primary" disabled={busy}>
            {mode === "in" ? "Record check-in" : "Record check-out"}
          </button>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Modal>
  );
}

function BlockDialog({ date, stations, onClose, onDone, say }: { date: string; stations: { id: string; name: string }[]; onClose: () => void; onDone: () => Promise<void>; say: (m: Message) => void }) {
  const [values, setValues] = useState({ station: stations[0]?.id ?? "", date, start: "", end: "", reason: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    say(info(copy.shift.saving));
    const result = await api<{ block: MaintenanceBlockView; displaced_booking_ids: string[] }>(`/api/stations/${values.station}/maintenance`, {
      method: "POST",
      json: { date: values.date.trim(), start: values.start.trim(), end: values.end.trim(), reason: values.reason.trim() },
    });
    setBusy(false);
    if (result.ok) {
      await onDone();
      say(success(copy.shift.blocked(result.data.displaced_booking_ids.length)));
      onClose();
      return;
    }
    setErrors(result.error.errors ?? {});
    say(failure(shiftError(result.error)));
  };

  return (
    <Modal title="Block station" onClose={onClose}>
      <form className="form" noValidate onSubmit={(event) => void save(event)}>
        <div className="field">
          <label className="field__label" htmlFor="block-station">
            Station
          </label>
          <select id="block-station" className="field__input" value={values.station} onChange={(event) => setValues({ ...values, station: event.target.value })}>
            {stations.map((station) => (
              <option key={station.id} value={station.id}>
                {station.name}
              </option>
            ))}
          </select>
        </div>
        <Field label="Date" placeholder="YYYY-MM-DD" value={values.date} onChange={(event) => setValues({ ...values, date: event.target.value })} error={errors.date ?? null} />
        <div className="form__pair">
          <Field label="From" placeholder="HH:MM" inputMode="numeric" value={values.start} onChange={(event) => setValues({ ...values, start: event.target.value })} error={errors.start ?? null} />
          <Field label="Until" placeholder="HH:MM" inputMode="numeric" value={values.end} onChange={(event) => setValues({ ...values, end: event.target.value })} error={errors.end ?? null} />
        </div>
        <Field label="Reason" maxLength={200} value={values.reason} onChange={(event) => setValues({ ...values, reason: event.target.value })} error={errors.reason ?? null} />
        <div className="modal__actions">
          <button type="submit" className="button button--primary" disabled={busy}>
            Save block
          </button>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Shift() {
  const { search } = usePlace();
  const requested = search.get("date");
  const date = requested !== null && isIsoDate(requested) ? requested : null;
  const heading = useRef<HTMLHeadingElement>(null);
  const [sheet, setSheet] = useState<UsageSheetResponse | null>(null);
  const [stations, setStations] = useState<{ id: string; name: string }[]>([]);
  const [typed, setTyped] = useState(date ?? "");
  const [dialog, setDialog] = useState<{ kind: "in" | "out"; row: UsageRowView } | { kind: "block" } | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => heading.current?.focus(), []);

  const load = useCallback(async () => {
    const result = await api<UsageSheetResponse>(date ? `/api/usage-sheet?date=${date}` : "/api/usage-sheet");
    if (!result.ok) return;
    syncServerClock(result.data.server_now);
    if (!date) {
      navigate(`/shift?date=${result.data.date}`, { replace: true });
      return;
    }
    setSheet(result.data);
  }, [date]);

  useEffect(() => {
    if (date) setTyped(date);
    void load();
  }, [load, date]);

  useEffect(() => {
    void api<StationsResponse>("/api/stations").then((result) => {
      if (result.ok) setStations(result.data.stations.map((station) => ({ id: station.id, name: station.name })));
    });
  }, []);

  const shown = sheet && sheet.date === date ? sheet : null;

  return (
    <div className="screen screen--shift">
      <div className="screen__head">
        <h1 ref={heading} tabIndex={-1} className="screen__title">
          Shift
        </h1>
        <StatusRegion name="Shift status" message={message} className="screen__notice" />
      </div>
      <div className="shift-bar">
        <Field
          label="Sheet date"
          placeholder="YYYY-MM-DD"
          inputMode="numeric"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            if (isIsoDate(event.target.value) && event.target.value !== date) navigate(`/shift?date=${event.target.value}`);
          }}
        />
        <button type="button" className="button button--primary" onClick={() => setDialog({ kind: "block" })} disabled={!date || stations.length === 0}>
          <Wrench aria-hidden="true" className="icon" />
          Block station
        </button>
      </div>
      <section className="card card--sheet" aria-labelledby="sheet-title">
        <h2 id="sheet-title" className="card__title">
          {date ? `Usage sheet for ${longDate(date)}` : "Usage sheet"}
        </h2>
        <div className="table-frame">
          <table className="table table--cards" aria-label="Usage sheet">
            <thead>
              <tr>
                <th scope="col">Booked</th>
                <th scope="col">Station</th>
                <th scope="col">Renter</th>
                <th scope="col">Actual</th>
                <th scope="col">Status</th>
                <th scope="col">Overage</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown === null ? (
                <tr className="skeleton-row">
                  <td colSpan={7}>
                    <span className="skeleton" />
                  </td>
                </tr>
              ) : shown.rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptySpike text={copy.empty.sheet} />
                  </td>
                </tr>
              ) : (
                shown.rows.map((row) => (
                  <tr key={row.booking_id}>
                    <td data-label="Booked" className="mono">{`${row.start}–${row.end}`}</td>
                    <td data-label="Station">{row.station_name}</td>
                    <td data-label="Renter">{row.renter_business_name}</td>
                    <td data-label="Actual" className="mono">
                      {row.actual_start ? `${row.actual_start}–${row.actual_end ?? ""}` : "—"}
                    </td>
                    <td data-label="Status">
                      <span className="stamp">{SHEET_WORDS[row.status]}</span>
                    </td>
                    <td data-label="Overage" className="mono">
                      {row.overage_units ? `${row.overage_units} × 15 min · $${row.overage_usd ?? ""}` : row.status === "completed" ? "None" : "—"}
                    </td>
                    <td data-label="Actions">
                      {row.status === "confirmed" ? (
                        <button type="button" className="button" onClick={() => setDialog({ kind: "in", row })}>
                          <LogIn aria-hidden="true" className="icon" />
                          Check in<span className="visually-hidden">{` ${row.renter_business_name}`}</span>
                        </button>
                      ) : null}
                      {row.status === "checked_in" ? (
                        <button type="button" className="button" onClick={() => setDialog({ kind: "out", row })}>
                          <LogOut aria-hidden="true" className="icon" />
                          Check out<span className="visually-hidden">{` ${row.renter_business_name}`}</span>
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      {dialog?.kind === "in" || dialog?.kind === "out" ? <ClockDialog row={dialog.row} mode={dialog.kind} onClose={() => setDialog(null)} onDone={load} say={setMessage} /> : null}
      {dialog?.kind === "block" && date ? <BlockDialog date={date} stations={stations} onClose={() => setDialog(null)} onDone={load} say={setMessage} /> : null}
    </div>
  );
}
