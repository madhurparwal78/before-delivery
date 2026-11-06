// The board's dialogs, and the cancel dialog the Bookings screen shares.

import { useRef, useState } from "preact/hooks";
import { ApiFailure, post, postOnce } from "../api.js";
import { Dialog, useDialogClose } from "../dialog.js";
import { Button, Field, errorCopy, focusFirstInvalid, useAction } from "../ui.js";
import { showClaimError } from "../store.js";
import type { Booking, HourBank, OutOfService, StationInfo } from "../types.js";
import { blockLabel, money } from "../../shared/format.js";
import { isLateCancellation, lateFeeCents } from "../../shared/rules.js";

export const labelFor = (b: Booking): string => blockLabel(b);

// ------------------------------------------------------------- new booking

export interface NewBookingPreset { stationId: string; date: string; start?: string; end?: string; days?: number }

interface HoldResult { bookings: Booking[]; seriesId: string | null }

const FIELD_ORDER = ["stationId", "date", "start", "end", "days", "repeatWeeks", "notes"];

export function NewBookingDialog({ stations, preset, onHeld, onClose }: {
  stations: StationInfo[]; preset: NewBookingPreset | null; onHeld: (r: HoldResult) => void; onClose: () => void;
}) {
  const [stationId, setStationId] = useState(preset?.stationId ?? "");
  const [date, setDate] = useState(preset?.date ?? "");
  const [start, setStart] = useState(preset?.start ?? "");
  const [end, setEnd] = useState(preset?.end ?? "");
  const [days, setDays] = useState(String(preset?.days ?? 1));
  const [weeks, setWeeks] = useState("1");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  const { busy, run } = useAction();
  const station = stations.find((s) => s.id === stationId);
  const shelf = station?.kind === "shelf";
  const label = station
    ? blockLabel({ stationName: station.name, localDate: date, localStart: start, localEnd: end, days: shelf ? Number(days) : null })
    : "block";
  const num = (v: string): number | string => (/^-?\d+$/.test(v.trim()) ? Number(v) : v);

  const submit = (e: Event): void => {
    e.preventDefault();
    const body = shelf
      ? { stationId, date, days: num(days), notes }
      : { stationId, date, start, end, repeatWeeks: num(weeks), notes };
    void run("hold", `Holding ${label}…`, async () => {
      const { data } = await postOnce<HoldResult>("/api/bookings", body);
      setErrors({});
      onHeld(data);
      return null;
    }, (error) => {
      if (error instanceof ApiFailure && error.code === "validation_failed") {
        const fields = error.fieldErrors;
        setErrors(fields);
        const firstField = FIELD_ORDER.find((f) => fields[f]);
        focusFirstInvalid(firstField ? form.current : null, form.current?.querySelector<HTMLElement>("button[type=submit]"));
        return true;
      }
      setErrors({});
      // Lost the race: the dialog stays open with what was typed, and the block_taken copy stays in
      // the alert through every board refresh (Interactions › Claim outcomes).
      if (error instanceof ApiFailure && error.code === "block_taken") {
        showClaimError(errorCopy(error));
        return true;
      }
      return false;
    });
  };

  const formError = [errors.hours, errors.documents].filter(Boolean).join(" ");
  return (
    <Dialog title="New booking" onClose={onClose}>
      <form ref={form} class="form" onSubmit={submit} noValidate>
        <Field label="Station" error={errors.stationId}>
          {(p) => (
            <select {...p} class="input" value={stationId} onChange={(e) => setStationId(e.currentTarget.value)}>
              <option value="">Choose a station</option>
              {stations.map((s) => <option value={s.id}>{s.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Date" error={errors.date} hint="YYYY-MM-DD">
          {(p) => <input {...p} class="input" type="text" autoComplete="off" value={date} onInput={(e) => setDate(e.currentTarget.value)} />}
        </Field>
        {shelf ? (
          <Field label="Days" error={errors.days}>
            {(p) => <input {...p} class="input" type="number" min="1" max="31" value={days} onInput={(e) => setDays(e.currentTarget.value)} />}
          </Field>
        ) : (
          <div class="form-row">
            <Field label="Start" error={errors.start} hint="HH:MM">
              {(p) => <input {...p} class="input" type="text" autoComplete="off" value={start} onInput={(e) => setStart(e.currentTarget.value)} />}
            </Field>
            <Field label="End" error={errors.end} hint="HH:MM">
              {(p) => <input {...p} class="input" type="text" autoComplete="off" value={end} onInput={(e) => setEnd(e.currentTarget.value)} />}
            </Field>
          </div>
        )}
        {!shelf && (
          <Field label="Repeat weekly" error={errors.repeatWeeks} hint="Weeks in a row, 1 to 12">
            {(p) => <input {...p} class="input" type="number" min="1" max="12" value={weeks} onInput={(e) => setWeeks(e.currentTarget.value)} />}
          </Field>
        )}
        <Field label="Notes" error={errors.notes}>
          {(p) => <textarea {...p} class="input" rows={2} value={notes} onInput={(e) => setNotes(e.currentTarget.value)} />}
        </Field>
        {formError && <p class="form-error" id="hold-error">{formError}</p>}
        <div class="actions">
          <Button type="submit" variant="primary" busy={busy === "hold"} aria-describedby={formError ? "hold-error" : undefined}>Hold block</Button>
          <CloseButton />
        </div>
      </form>
    </Dialog>
  );
}

function CloseButton({ label = "Close" }: { label?: string }) {
  const close = useDialogClose();
  return <Button class="btn-quiet" onClick={close}>{label}</Button>;
}

// ------------------------------------------------------------- cancel

/** The `current` booking a 409 or 412 carries, for the redraw. */
export function currentBooking(error: unknown): Booking | null {
  return error instanceof ApiFailure && error.body.current && typeof error.body.current === "object" ? (error.body.current as Booking) : null;
}

export function CancelDialog({ booking, now, onDone, onClose, onPending, onRefused, returnTo }: {
  booking: Booking; now: number; onDone: (b: Booking) => void; onClose: () => void;
  onPending?: (on: boolean) => void; onRefused?: (current: Booking) => void; returnTo?: () => HTMLElement | null;
}) {
  const { busy, run } = useAction();
  const late = booking.status === "confirmed" && isLateCancellation(Date.parse(booking.start), now);
  const feeLine = late ? `Late cancellation fee: ${money(lateFeeCents(booking.chargeCents))}` : "No cancellation fee";
  const confirm = (): void => {
    onPending?.(true);
    void run("cancel", "Cancelling…", async () => {
      const { data } = await postOnce<{ booking: Booking; hourBank: HourBank }>(`/api/bookings/${booking.id}/cancel`, {});
      onDone(data.booking);
      return data.booking.status === "cancelled_late"
        ? `Cancelled. Late cancellation fee: ${money(data.booking.penaltyCents)}.` : "Cancelled. No cancellation fee.";
    }, (error) => {
      const current = currentBooking(error);
      if (current && onRefused) onRefused(current);
      return false;
    }).finally(() => onPending?.(false));
  };
  return (
    <Dialog title="Cancel booking" onClose={onClose} {...(returnTo ? { returnTo } : {})}>
      <p class="dialog-lede">{labelFor(booking)}</p>
      <p class="dialog-fee">{feeLine}</p>
      <div class="actions">
        <Button variant="primary" busy={busy === "cancel"} onClick={confirm}>Confirm cancellation</Button>
        <CloseButton label="Keep booking" />
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------- move and release

export function MoveDialog({ from, to, chargeCents, onConfirm, onPutBack }: {
  from: string; to: string; chargeCents: number | null; onConfirm: () => void; onPutBack: () => void;
}) {
  return (
    <Dialog title="Move block" onClose={onPutBack} returnTo={() => null}>
      <p class="dialog-lede">From {from} to {to}</p>
      {chargeCents !== null && <p class="dialog-fee">New charge {money(chargeCents)}</p>}
      <div class="actions">
        <Button variant="primary" onClick={onConfirm}>Confirm move</Button>
        <Button class="btn-quiet" onClick={onPutBack}>Put back</Button>
      </div>
    </Dialog>
  );
}

export function ReleaseDialog({ booking, onDone, onRefused, onClose }: {
  booking: Booking; onDone: (b: Booking) => void; onRefused: (current: Booking) => void; onClose: () => void;
}) {
  const { busy, run } = useAction();
  const release = (): void => {
    void run("release", "Releasing…", async () => {
      const { data } = await post<{ booking: Booking }>(`/api/bookings/${booking.id}/release`);
      onDone(data.booking);
      return `Released ${labelFor(booking)}. No cancellation fee.`;
    }, (error) => {
      const current = currentBooking(error);
      if (current) onRefused(current);
      return false;
    });
  };
  return (
    <Dialog title="Release block" onClose={onClose}>
      <p class="dialog-lede">Release {labelFor(booking)} free of charge?</p>
      <div class="actions">
        <Button variant="primary" busy={busy === "release"} onClick={release}>Release</Button>
        <CloseButton label="Keep" />
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------- out of service

export function OutOfServiceDialog({ stations, date, onSaved, onClose }: {
  stations: StationInfo[]; date: string; onSaved: () => void; onClose: () => void;
}) {
  const [stationId, setStationId] = useState("");
  const [day, setDay] = useState(date);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  const { busy, run } = useAction();
  const submit = (e: Event): void => {
    e.preventDefault();
    const station = stations.find((s) => s.id === stationId);
    void run("save", "Saving…", async () => {
      const { data } = await post<{ window: OutOfService; conflicts: string[] }>("/api/out-of-service", { stationId, date: day, start, end, reason });
      onSaved();
      return `${station?.name} out of service ${data.window.localDate} ${data.window.localStart}–${data.window.localEnd}. ${data.conflicts.length} blocks need moving.`;
    }, (error) => {
      if (error instanceof ApiFailure && error.code === "validation_failed") {
        setErrors(error.fieldErrors);
        focusFirstInvalid(form.current);
        return true;
      }
      if (error instanceof ApiFailure && error.code === "not_found") {
        setErrors({ stationId: "Choose a station." });
        focusFirstInvalid(form.current);
        return true;
      }
      return false;
    });
  };
  return (
    <Dialog title="Out of service" onClose={onClose}>
      <form ref={form} class="form" onSubmit={submit} noValidate>
        <Field label="Station" error={errors.stationId}>
          {(p) => (
            <select {...p} class="input" value={stationId} onChange={(e) => setStationId(e.currentTarget.value)}>
              <option value="">Choose a station</option>
              {stations.map((s) => <option value={s.id}>{s.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Date" error={errors.date} hint="YYYY-MM-DD">
          {(p) => <input {...p} class="input" type="text" value={day} onInput={(e) => setDay(e.currentTarget.value)} />}
        </Field>
        <div class="form-row">
          <Field label="Start" error={errors.start} hint="HH:MM">
            {(p) => <input {...p} class="input" type="text" value={start} onInput={(e) => setStart(e.currentTarget.value)} />}
          </Field>
          <Field label="End" error={errors.end} hint="HH:MM">
            {(p) => <input {...p} class="input" type="text" value={end} onInput={(e) => setEnd(e.currentTarget.value)} />}
          </Field>
        </div>
        <Field label="Reason" error={errors.reason}>
          {(p) => <input {...p} class="input" type="text" maxLength={120} value={reason} onInput={(e) => setReason(e.currentTarget.value)} />}
        </Field>
        <div class="actions">
          <Button type="submit" variant="primary" busy={busy === "save"}>Save window</Button>
          <CloseButton />
        </div>
      </form>
    </Dialog>
  );
}
