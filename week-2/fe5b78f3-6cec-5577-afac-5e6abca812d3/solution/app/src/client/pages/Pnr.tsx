// PNR status (`/pnr`, `/pnr/<pnr>`): public, statuses only, nothing that identifies the people on the booking.
import { type FormEvent, useEffect, useState } from "react";
import type { PublicPnr } from "../../shared/api";
import { Chip, statusOfLabel } from "../components/Chip";
import { useRibbon } from "../components/Shell";
import { ApiFailure, api } from "../lib/api";
import { navigate } from "../lib/router";
import { useStationNames } from "../lib/stations";

export function Pnr({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [result, setResult] = useState<PublicPnr | null>(null);
  const [lookup, setLookup] = useState("");
  const name = useStationNames();
  useRibbon(result ? [{ code: result.from, name: name(result.from), end: true }, { code: result.to, name: name(result.to), end: true }] : []);

  const check = async (pnr: string): Promise<void> => {
    setLookup("Checking status");
    try {
      const body = await api<PublicPnr>(`/api/pnr/${encodeURIComponent(pnr)}`);
      setResult(body);
      setLookup(`PNR ${body.pnr}: ${body.train.number} ${body.train.name}${body.chart_prepared ? ", chart prepared" : ""}`);
    } catch (error) {
      setResult(null);
      setLookup(error instanceof ApiFailure && error.status === 404 ? `No booking has PNR ${pnr}.` : "Can't reach Pakka right now. Try again.");
    }
  };

  useEffect(() => {
    if (initial) void check(initial);
  }, [initial]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const pnr = value.trim();
    navigate(`/pnr/${encodeURIComponent(pnr)}`, { replace: true });
    void check(pnr);
  };

  return (
    <section className="panel stack" aria-labelledby="pnr-title">
      <h1 id="pnr-title">PNR status</h1>
      <p className="muted">Anyone can check a PNR. The table shows statuses only, never who is travelling.</p>
      <form className="pnr-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="pnr-number">PNR number</label>
          <input id="pnr-number" inputMode="numeric" maxLength={10} value={value} onChange={(e) => setValue(e.target.value)} className="mono" />
        </div>
        <button type="submit" className="button primary">Check status</button>
      </form>
      <p className="status-line strong" role="status" aria-label="PNR lookup">{lookup}</p>
      {result ? (
        <div role="table" aria-label="PNR status" className="pnr-table">
          <div role="rowgroup" className="pnr-head">
            <div role="row">
              <span role="columnheader">Passenger</span>
              <span role="columnheader">Booking status</span>
              <span role="columnheader">Current status</span>
            </div>
          </div>
          <div role="rowgroup">
            {result.passengers.map((p) => (
              <div role="row" key={p.number}>
                <span role="rowheader" data-label="Passenger">{`Passenger ${p.number}`}</span>
                <span role="cell" data-label="Booking status"><Chip status={statusOfLabel(p.booking_status)} label={p.booking_status} /></span>
                <span role="cell" data-label="Current status"><Chip status={statusOfLabel(p.current_status)} label={p.current_status} /></span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
