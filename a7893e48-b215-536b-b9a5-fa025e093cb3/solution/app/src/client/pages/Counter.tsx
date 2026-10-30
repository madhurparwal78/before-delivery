import { useCallback, useEffect, useState } from "react";
import { api, ApiFailure, idempotencyKey, serverNow } from "../api.js";
import { Delayed, Live, Select, useApp, type Message } from "../app.js";
import { Modal, useClose } from "../dialog.js";
import { overrunCents } from "../../shared/pricing.js";
import { localDate, money, stampParts, STATUS_STAMPS } from "../format.js";
import type { Booking, Site } from "../types.js";

const OVERRUN_DELAYED = "Overrun can't be charged while billing is unreachable. Nothing was charged.";


function OverrunForm({ booking, rate, onCharged, report }: { booking: Booking; rate: number; onCharged: () => void; report: (message: Message) => void }) {
  const close = useClose();
  const [minutes, setMinutes] = useState("");
  const [key] = useState(idempotencyKey);
  const [busy, setBusy] = useState(false);
  const value = Number(minutes);
  const valid = Number.isInteger(value) && value >= 1 && value <= 240;
  const charge = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    report({ text: "Charging…", tone: "pending" });
    try {
      const result = await api<{ booking: Booking }>("POST", `/api/bookings/${booking.id}/overrun`, { minutes: value }, key);
      report({ text: `Overrun of ${result.booking.overrun_minutes ?? value} min charged: ${money(result.booking.overrun_cents ?? 0)}.`, tone: "success" });
      onCharged();
      close();
    } catch (error) {
      report({ text: error instanceof ApiFailure && error.code === "billing_unavailable" ? OVERRUN_DELAYED : error instanceof ApiFailure ? error.detail : "Charging failed.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="overrun-form" onSubmit={(event) => { event.preventDefault(); void charge(); }}>
      <p className="overrun-who">{booking.renter_business} · {booking.station_name}</p>
      <label className="field">
        <span>Overrun minutes</span>
        <input type="number" min={1} max={240} step={1} inputMode="numeric" className="mono" value={minutes} onChange={(event) => setMinutes(event.target.value)} />
      </label>
      <p className="overrun-quote">Charge <span className="mono quote-figure">{money(valid ? overrunCents(value, rate) : 0)}</span> at {money(rate)}/h</p>
      <div className="actions">
        <button type="submit" className="button button-primary" aria-busy={busy}>Charge</button>
        <button type="button" className="button" onClick={close}>Close</button>
      </div>
    </form>
  );
}

export function Counter() {
  const { user, sites } = useApp();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const site: Site | undefined = sites.find((candidate) => candidate.id === siteId);
  const zone = site?.time_zone ?? "UTC";
  const today = localDate(zone, serverNow());
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [overrun, setOverrun] = useState<Booking | null>(null);
  const load = useCallback(async () => {
    setBookings((await api<{ bookings: Booking[] }>("GET", `/api/bookings?site_id=${siteId}&date=${today}`)).bookings);
  }, [siteId, today]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const act = async (booking: Booking, action: "check-in" | "check-out" | "cleaning-fee" | "settle"): Promise<void> => {
    setMessage({ text: action === "cleaning-fee" ? "Charging…" : action === "settle" ? "Settling…" : "Saving…", tone: "pending" });
    const key = action === "cleaning-fee" ? idempotencyKey() : undefined;
    try {
      const result = await api<{ booking: Booking }>("POST", `/api/bookings/${booking.id}/${action}`, {}, key);
      const done = result.booking;
      const text = action === "check-in" ? `Checked in: ${done.renter_business}.`
        : action === "check-out" ? `Checked out: ${done.renter_business}.`
          : action === "cleaning-fee" ? `Cleaning fee charged: ${money(done.cleaning_fee_cents ?? 0)}.`
            : done.refund.deposit_refund_cents > 0 ? `Settled. Deposit refunded: ${money(done.refund.deposit_refund_cents)}.` : "Settled.";
      setMessage({ text, tone: "success" });
    } catch (error) {
      const code = error instanceof ApiFailure ? error.code : "";
      const text = code === "outside_check_in_window" ? "Check-in opens 30 minutes before start."
        : code === "billing_unavailable" && action === "cleaning-fee" ? "Cleaning fee can't be charged while billing is unreachable. Nothing was charged."
          : code === "billing_unavailable" ? "Settlement is delayed while billing is unreachable. The booking is unchanged."
            : error instanceof ApiFailure ? error.detail : "That didn't save. Try again.";
      setMessage({ text, tone: "error" });
    }
    await load();
  };

  const rateOf = (booking: Booking): number => site?.stations.find((station) => station.id === booking.station_id)?.rate_cents ?? 0;
  return (
    <main className="page counter-page">
      <header className="page-head">
        <h1>Counter</h1>
        <p className="lede">Today's bookings at <strong>{site?.name}</strong> · <span className="mono">{today}</span></p>
      </header>
      {user.role === "manager" ? (
        <Select label="Counter site" inline value={siteId} onChange={setSiteId}>
          {sites.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </Select>
      ) : null}
      <Live label="Counter status" message={message} />
      <div className="table-frame counter-frame">
        <table aria-label="Today's bookings" className="counter-table">
          <thead><tr><th scope="col">Renter</th><th scope="col">Station</th><th scope="col">Time</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
          <tbody>
            {!bookings ? <tr><td colSpan={5} className="loading-row">Loading…</td></tr> : bookings.length === 0
              ? <tr><td colSpan={5} className="empty-row">No bookings at this site today.</td></tr>
              : bookings.map((booking) => (
                <tr key={booking.id} className="slip-row">
                  <td data-label="Renter"><strong>{booking.renter_business}</strong></td>
                  <td data-label="Station">{booking.station_name}</td>
                  <td data-label="Time" className="mono">{stampParts(booking.local_start).time} – {stampParts(booking.local_end).time}</td>
                  <td data-label="Status"><span className={`stamp stamp-${booking.status}`}>{STATUS_STAMPS[booking.status]}</span></td>
                  <td data-label="Actions">
                    <div className="row-actions">
                      {booking.status === "confirmed" ? <button type="button" className="button" onClick={() => void act(booking, "check-in")}>Check in</button> : null}
                      {booking.status === "checked_in" ? <button type="button" className="button" aria-label="Charge overrun" onClick={() => setOverrun(booking)}>Charge overrun<Delayed /></button> : null}
                      {booking.status === "checked_in" || booking.status === "overrun_billed" ? <button type="button" className="button" onClick={() => void act(booking, "check-out")}>Check out</button> : null}
                      {booking.status === "checked_out" && booking.cleaning_fee_cents === null ? <button type="button" className="button" aria-label="Add cleaning fee" onClick={() => void act(booking, "cleaning-fee")}>Add cleaning fee<Delayed /></button> : null}
                      {booking.status === "checked_out" ? <button type="button" className="button button-primary" aria-label="Settle" onClick={() => void act(booking, "settle")}>Settle<Delayed /></button> : null}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {overrun ? (
        <Modal title="Charge overrun" onClose={() => setOverrun(null)}>
          <OverrunForm booking={overrun} rate={rateOf(overrun)} onCharged={() => void load()} report={setMessage} />
        </Modal>
      ) : null}
    </main>
  );
}
