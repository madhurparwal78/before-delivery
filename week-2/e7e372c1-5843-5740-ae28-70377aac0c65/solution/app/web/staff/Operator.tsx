import { useState } from "react";
import { request } from "../api.ts";
import { OPERATOR_INVALID, OPERATOR_PAUSED, OPERATOR_PLAYING, OPERATOR_REAL_TIME, UNEXPECTED } from "../copy.ts";
import { usePolling } from "../hooks.ts";
import { formatInstant, isoWallClock, isoWallDate, parseWallTime } from "../../shared/newyork.ts";

interface Tape {
  state: "playing" | "paused";
  position: number;
}

interface ClockAnswer {
  now: string;
  rehearsal: boolean;
}

export function Operator() {
  const [tape, setTape] = useState<Tape | null>(null);
  const [clock, setClock] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [typed, setTyped] = useState("");
  const [denied, setDenied] = useState(false);

  usePolling(async () => {
    const [tapeAnswer, clockAnswer] = await Promise.all([request<Tape>("GET", "/api/operator/tape"), request<ClockAnswer>("GET", "/api/clock")]);
    if (tapeAnswer.kind === "ok") setTape(tapeAnswer.body);
    else if (tapeAnswer.kind === "refused" && tapeAnswer.status === 403) setDenied(true);
    if (clockAnswer.kind === "ok") setClock(clockAnswer.body.now);
  }, true);

  const setTapeState = async (state: Tape["state"]): Promise<void> => {
    const answer = await request<Tape>("PUT", "/api/operator/tape", { body: { state } });
    if (answer.kind === "ok") {
      setTape(answer.body);
      setStatus(state === "paused" ? OPERATOR_PAUSED : OPERATOR_PLAYING);
    } else setStatus(UNEXPECTED);
  };

  const sendClock = async (at: string | null, confirmation: string): Promise<void> => {
    const answer = await request<ClockAnswer>("PUT", "/api/operator/clock", { body: { at } });
    if (answer.kind === "ok") {
      setClock(answer.body.now);
      setStatus(confirmation);
    } else setStatus(UNEXPECTED);
  };

  const setRehearsal = async (): Promise<void> => {
    const instant = parseWallTime(typed.trim());
    if (instant === null) {
      setStatus(OPERATOR_INVALID);
      return;
    }
    const iso = formatInstant(instant);
    await sendClock(iso, `Clock set to ${isoWallDate(iso)} ${isoWallClock(iso, true)} ET.`);
  };

  if (denied) return <p>Your role cannot use the operator console.</p>;
  return (
    <>
      <h1>Operator console</h1>
      <div className="console" style={{ marginTop: 24 }}>
        <p className="line">{tape ? `Tape ${tape.state} at position ${tape.position}` : "Tape state loading"}</p>
        <p className="line">{clock ? `Market clock ${isoWallDate(clock)} ${isoWallClock(clock, true)} ET` : "Market clock loading"}</p>
        <div className="actions">
          <button type="button" onClick={() => void setTapeState("paused")}>Pause tape</button>
          <button type="button" onClick={() => void setTapeState("playing")}>Resume tape</button>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="rehearsal-clock">Rehearsal clock</label>
            <input id="rehearsal-clock" type="text" inputMode="numeric" placeholder="YYYY-MM-DD HH:MM:SS" aria-describedby="rehearsal-hint" value={typed} onChange={(event) => setTyped(event.target.value)} />
          </div>
          <button type="button" className="primary" onClick={() => void setRehearsal()}>Set clock</button>
          <button type="button" onClick={() => void sendClock(null, OPERATOR_REAL_TIME)}>Use real time</button>
        </div>
        <p className="hint" id="rehearsal-hint">New York time, 24-hour.</p>
        <p className="staff-updates" role="status" aria-label="Operator status">{status}</p>
      </div>
    </>
  );
}
