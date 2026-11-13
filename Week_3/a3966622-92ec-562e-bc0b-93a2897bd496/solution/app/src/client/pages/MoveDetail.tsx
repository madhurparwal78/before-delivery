// A move's page: status, plan, notice cutoff and verdict, charges, notices, ladder reports, lines,
// invoices and history, with the amend, cancel, re-order and status actions the user may take.
import { useEffect, useRef, useState } from "react";
import { draughtMmFromMetres } from "../../shared/draught";
import { draughtMetres, signedMetres } from "../../shared/numerals";
import type { Move, Plan, Vessel } from "../../shared/types";
import { get, NO_REPLY, request, useKeyedControl, useSingleFlight } from "../api";
import { navigate } from "../router";
import { useUser } from "../session";
import { WaypointTable } from "../section/WaypointTable";
import { Shell } from "../ui/Chrome";
import { CHARGES, cutoffText, dateTimeOf, dollars, statusText, verdictText } from "../ui/format";
import { countCopy, FormErrors, type FieldErrors } from "../ui/FormErrors";
import { LiveRegion, useLive } from "../ui/live";
import { MoveActions, useConfirmedMove } from "../ui/MoveActions";
import { Panel } from "../ui/Panel";
import { NotFound } from "./NotFound";

const LATE_CANCEL = "Cancelled late - under 2 hours' notice. The cancellation charge applies.";
const LATE_AMEND = "Late amendment - under 2 hours' notice. The cancellation charge applies.";
const AMEND_FIELDS: Record<string, string> = { boarding_at: "amend-date", speed_kn: "amend-speed", duty_minutes: "amend-duty", draught_m: "amend-draught" };

function Notice({ move }: { move: Move }) {
  return (
    <dl className="facts">
      <div>
        <dt>Notice cutoff</dt>
        <dd className="num">{cutoffText(move.notice)}</dd>
      </div>
      <div>
        <dt>Notice verdict</dt>
        <dd className={move.notice.state === "late" ? "short" : undefined}>{verdictText(move.notice)}</dd>
      </div>
    </dl>
  );
}

function AmendDialog({ move, open, onClose, announcements, onDone }: { move: Move; open: boolean; onClose: () => void; announcements: ReturnType<typeof useLive>; onDone: (move: Move | null) => void }) {
  const [date, setDate] = useState(move.boarding_at.slice(0, 10));
  const [time, setTime] = useState(move.boarding_at.slice(11, 16));
  const [speed, setSpeed] = useState(String(move.speed_kn));
  const [duty, setDuty] = useState(String(move.duty_minutes));
  const [draught, setDraught] = useState(draughtMetres(move.draught_mm));
  const [errors, setErrors] = useState<FieldErrors>({});
  const flight = useSingleFlight();
  const atOpen = useRef(move);
  atOpen.current = open ? atOpen.current : move;
  useEffect(() => {
    if (!open) return;
    const start = atOpen.current;
    setDate(start.boarding_at.slice(0, 10));
    setTime(start.boarding_at.slice(11, 16));
    setSpeed(String(start.speed_kn));
    setDuty(String(start.duty_minutes));
    setDraught(draughtMetres(start.draught_mm));
    setErrors({});
  }, [open]);

  const save = (): Promise<unknown> =>
    flight(async () => {
      const mm = draughtMmFromMetres(Number(draught));
      const body = { boarding_at: `${date}T${time}`, speed_kn: Number(speed), duty_minutes: Number(duty), draught_m: mm === null ? draught : mm / 1000 };
      announcements.say("Saving amendment...");
      const outcome = await request<Move>(`/api/moves/${encodeURIComponent(move.ref)}`, { method: "PATCH", body, ifMatch: move.version });
      if (outcome.kind === "no-reply") {
        announcements.say(NO_REPLY);
        return;
      }
      if (outcome.kind === "ok") {
        const saved = outcome.data.window_returned ? "Amendment saved. Window no longer clears - move returned to Ordered." : "Amendment saved";
        announcements.say(outcome.data.late_notice ? `${saved} ${LATE_AMEND}` : saved);
        onDone(outcome.data);
        return;
      }
      if (outcome.error.errors) {
        setErrors(outcome.error.errors);
        announcements.say(countCopy(outcome.error.errors));
        return;
      }
      announcements.say(outcome.status === 412 ? "This move changed. Fresh data shown." : outcome.error.error === "not_amendable" ? "This move can no longer be amended." : outcome.error.message);
      onDone(outcome.error.current ?? null);
    });

  return (
    <Panel open={open} label="Amend move" variant="dialog" onClose={onClose}>
      <header className="panel-head">
        <h2>Amend move</h2>
        <p className="muted">
          {move.ref} · {move.vessel.name}
        </p>
      </header>
      <form
        className="panel-body"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Notice move={move} />
        <FormErrors errors={errors} fieldIds={AMEND_FIELDS} />
        <div className="form-grid">
          <label className="field">
            <span>Boarding date</span>
            <input id="amend-date" type="text" className="num" value={date} onChange={(e) => setDate(e.target.value.trim())} />
          </label>
          <label className="field">
            <span>Boarding time</span>
            <input type="text" className="num" value={time} onChange={(e) => setTime(e.target.value.trim())} />
          </label>
          <label className="field">
            <span>Draught in metres</span>
            <input id="amend-draught" type="number" step="0.001" className="num" value={draught} onChange={(e) => setDraught(e.target.value)} />
          </label>
          <label className="field">
            <span>Speed in knots</span>
            <input id="amend-speed" type="number" step="0.5" className="num" value={speed} onChange={(e) => setSpeed(e.target.value)} />
          </label>
          <label className="field">
            <span>Duty minutes</span>
            <input id="amend-duty" type="number" step="5" className="num" value={duty} onChange={(e) => setDuty(e.target.value)} />
          </label>
        </div>
        <div className="panel-actions">
          <button type="submit" className="primary">
            Save amendment
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Close amendment
          </button>
        </div>
      </form>
    </Panel>
  );
}

function CancelDialog({ move, open, onClose, announcements, onDone }: { move: Move; open: boolean; onClose: () => void; announcements: ReturnType<typeof useLive>; onDone: (move: Move | null) => void }) {
  const control = useKeyedControl();
  const confirmCancellation = async (): Promise<void> => {
    const key = control.begin({ ref: move.ref });
    if (key === null) return;
    announcements.say("Cancelling move...");
    const outcome = await request<Move>(`/api/moves/${encodeURIComponent(move.ref)}/cancel`, { body: {}, key });
    control.end(outcome);
    if (outcome.kind === "no-reply") {
      announcements.say(NO_REPLY);
      return;
    }
    if (outcome.kind === "ok") {
      announcements.say(outcome.data.status === "Cancelled late" ? LATE_CANCEL : "Move cancelled");
      onDone(outcome.data);
      return;
    }
    announcements.say("This move can no longer be cancelled.");
    onDone(null);
  };
  return (
    <Panel open={open} label="Cancel move" variant="dialog" onClose={onClose}>
      <header className="panel-head">
        <h2>Cancel move</h2>
        <p className="muted">
          {move.ref} · {move.vessel.name} · boarding <span className="num">{dateTimeOf(move.boarding_at)}</span>
        </p>
      </header>
      <div className="panel-body">
        <Notice move={move} />
        <div className="panel-actions">
          <button type="button" className="danger" onClick={() => void confirmCancellation()}>
            Confirm cancellation
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Keep move
          </button>
        </div>
      </div>
    </Panel>
  );
}

function ReorderDialog({ move, open, onClose, announcements, onDone }: { move: Move; open: boolean; onClose: () => void; announcements: ReturnType<typeof useLive>; onDone: (move: Move | null) => void }) {
  const [correction, setCorrection] = useState("");
  const [date, setDate] = useState(move.boarding_at.slice(0, 10));
  const [time, setTime] = useState(move.boarding_at.slice(11, 16));
  const [errors, setErrors] = useState<FieldErrors>({});
  const flight = useSingleFlight();
  const place = (): Promise<unknown> =>
    flight(async () => {
      announcements.say("Saving...");
      const outcome = await request<Move>(`/api/moves/${encodeURIComponent(move.ref)}/reorder`, { body: { boarding_at: `${date}T${time}`, correction } });
      if (outcome.kind === "no-reply") {
        announcements.say(NO_REPLY);
        return;
      }
      if (outcome.kind === "ok") {
        announcements.say(`Status now ${outcome.data.status}`);
        onDone(outcome.data);
        return;
      }
      if (outcome.error.errors) {
        setErrors(outcome.error.errors);
        announcements.say(countCopy(outcome.error.errors));
        return;
      }
      announcements.say("This action is not available for the move's current status.");
    });
  return (
    <Panel open={open} label="Corrected re-order" variant="dialog" onClose={onClose}>
      <header className="panel-head">
        <h2>Corrected re-order</h2>
      </header>
      <form
        className="panel-body"
        onSubmit={(event) => {
          event.preventDefault();
          void place();
        }}
      >
        <FormErrors errors={errors} fieldIds={{ correction: "reorder-correction", boarding_at: "reorder-date" }} />
        <label className="field">
          <span>Correction</span>
          <input id="reorder-correction" type="text" value={correction} onChange={(e) => setCorrection(e.target.value)} />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Boarding date</span>
            <input id="reorder-date" type="text" className="num" value={date} onChange={(e) => setDate(e.target.value.trim())} />
          </label>
          <label className="field">
            <span>Boarding time</span>
            <input type="text" className="num" value={time} onChange={(e) => setTime(e.target.value.trim())} />
          </label>
        </div>
        <div className="panel-actions">
          <button type="submit" className="primary">
            Place re-order
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Close re-order
          </button>
        </div>
      </form>
    </Panel>
  );
}

function PilotCard({ move, user }: { move: Move; user: ReturnType<typeof useUser> }) {
  const [vessel, setVessel] = useState<Vessel | null>(null);
  const [message, setMessage] = useState("");
  const read = (): void => {
    void get<{ vessels: Vessel[] }>("/api/vessels").then((o) => {
      if (o.kind === "ok") setVessel(o.data.vessels.find((v) => v.id === move.vessel.id) ?? null);
    });
  };
  useEffect(read, [move.vessel.id]);
  if (user.role === "clerk") return null;
  const card = vessel?.pilot_card;
  return (
    <section className="block" aria-labelledby="card-heading">
      <h2 id="card-heading">Pilot card</h2>
      {card ? (
        <p>
          <a href={`/api/vessels/${encodeURIComponent(move.vessel.id)}/pilot-cards/${encodeURIComponent(card.card_id)}/content`} download>
            Pilot card
          </a>{" "}
          <span className="num hash">SHA-256 {card.sha256}</span>
        </p>
      ) : (
        <p className="muted">No pilot card on file for {move.vessel.name}</p>
      )}
      {user.role === "agent" || user.role === "dispatcher" ? (
        <label className="field">
          <span>Upload pilot card PDF</span>
          <input
            type="file"
            accept="application/pdf"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setMessage("Uploading pilot card...");
              const outcome = await request<{ sha256: string }>(`/api/vessels/${encodeURIComponent(move.vessel.id)}/pilot-cards`, { raw: file });
              setMessage(
                outcome.kind === "ok"
                  ? `Pilot card stored. SHA-256 ${outcome.data.sha256}`
                  : outcome.kind === "no-reply"
                    ? NO_REPLY
                    : outcome.status === 503
                      ? "Evidence store unreachable - pilot card kept on this device, retry when it returns."
                      : "Pilot card is not a PDF under 10,000,000 bytes.",
              );
              if (outcome.kind === "ok") read();
            }}
          />
        </label>
      ) : null}
      {message ? <p className="muted">{message}</p> : null}
    </section>
  );
}

export function MoveDetail({ moveRef }: { moveRef: string }) {
  const user = useUser();
  const { move, setMove, reread, touch } = useConfirmedMove(moveRef);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [panel, setPanel] = useState<"amend" | "cancel" | "reorder" | null>(null);
  const announcements = useLive();
  const confirmed = move && move !== "missing" ? move : null;
  const planAt = confirmed ? (confirmed.committed?.boarding_at ?? confirmed.boarding_at) : null;

  useEffect(() => {
    if (!planAt || user.role === "clerk") return;
    void get<Plan>(`/api/moves/${encodeURIComponent(moveRef)}/plan?boarding_at=${planAt}`).then((o) => o.kind === "ok" && setPlan(o.data));
  }, [moveRef, planAt, user.role]);

  if (move === "missing") return <NotFound />;
  const done = (fresh: Move | null): void => {
    setPanel(null);
    if (fresh) setMove(fresh);
    void reread();
  };

  return (
    <Shell>
      {confirmed === null ? (
        <p className="muted">Loading move…</p>
      ) : (
        <article className="move">
          <header className="move-head">
            <h1>
              {confirmed.ref} <span className="muted">{confirmed.vessel.name}</span>
            </h1>
            <p className="status-chip big" data-status={confirmed.status}>
              {statusText(confirmed)}
            </p>
          </header>
          {confirmed.status === "Refused at ladder" ? <h2 className="alarm">Boarding refused at ladder</h2> : null}
          {confirmed.status === "Cancelled late" ? <p className="alarm-text">{LATE_CANCEL}</p> : null}
          {confirmed.late_amendments > 0 ? <p className="alarm-text">{LATE_AMEND}</p> : null}
          <div className="columns">
            <div className="column">
              <dl className="facts">
                <div>
                  <dt>Boarding</dt>
                  <dd>
                    <span className="num">{dateTimeOf(confirmed.boarding_at)}</span> port time
                  </dd>
                </div>
                <div>
                  <dt>Draught</dt>
                  <dd>
                    <span className="num">{confirmed.draught.metres} m</span> / <span className="num">{confirmed.draught.feet}</span>
                  </dd>
                </div>
                <div>
                  <dt>Speed</dt>
                  <dd className="num">{confirmed.speed_kn} kn</dd>
                </div>
                <div>
                  <dt>Duty</dt>
                  <dd className="num">{confirmed.duty_minutes} min</dd>
                </div>
                <div>
                  <dt>Pilot</dt>
                  <dd>{confirmed.pilot?.name ?? "None assigned"}</dd>
                </div>
                <div>
                  <dt>Window</dt>
                  <dd>
                    {confirmed.committed ? (
                      <>
                        <span className="num">{dateTimeOf(confirmed.committed.boarding_at)}</span>, pinch {confirmed.committed.pinch_waypoint}{" "}
                        <span className={confirmed.committed.margin_mm < 0 ? "num short" : "num"}>{signedMetres(confirmed.committed.margin_mm)} m</span>
                      </>
                    ) : (
                      "Not committed"
                    )}
                  </dd>
                </div>
                {confirmed.detention.seconds > 0 || confirmed.detained ? (
                  <div>
                    <dt>Detention</dt>
                    <dd className="num">{Math.floor(confirmed.detention.seconds / 60)} min</dd>
                  </div>
                ) : null}
              </dl>
              <Notice move={confirmed} />
              <dl className="facts">
                <div>
                  <dt>Charges</dt>
                  <dd>{CHARGES[confirmed.billing.state]}</dd>
                </div>
              </dl>
              <MoveActions move={confirmed} announcements={announcements} onReply={() => void reread()} onNoReply={touch} />
              <div className="actions">
                {confirmed.actions.includes("amend") ? (
                  <button type="button" className="ghost" onClick={() => setPanel("amend")}>
                    Amend move
                  </button>
                ) : null}
                {confirmed.actions.includes("cancel") ? (
                  <button type="button" className="ghost" onClick={() => setPanel("cancel")}>
                    Cancel move
                  </button>
                ) : null}
                {confirmed.actions.includes("reorder") ? (
                  <button type="button" className="ghost" onClick={() => setPanel("reorder")}>
                    Corrected re-order
                  </button>
                ) : null}
              </div>
              <LiveRegion name="Move announcements" live={announcements} />
              <section className="block" aria-labelledby="notices-heading">
                <h2 id="notices-heading">Notices</h2>
                {confirmed.notices.length ? (
                  <ul aria-label="Notices" className="rows">
                    {confirmed.notices.map((n, i) => (
                      <li key={`${n.kind}-${i}`} className="row">
                        {n.kind}: {n.state}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul aria-label="Notices" className="rows">
                    <li className="row muted">No notices yet</li>
                  </ul>
                )}
              </section>
              <PilotCard move={confirmed} user={user} />
            </div>
            <div className="column">
              <section className="block" aria-labelledby="lines-heading">
                <h2 id="lines-heading">Charge lines</h2>
                {confirmed.lines.length ? (
                  <div className="table-scroll" tabIndex={0} role="region" aria-label="Charge lines table">
                  <table className="mini">
                    <thead>
                      <tr>
                        <th scope="col">Line</th>
                        <th scope="col">Quantity</th>
                        <th scope="col">Unit</th>
                        <th scope="col">Amount</th>
                        <th scope="col">Revision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {confirmed.lines.map((l, i) => (
                        <tr key={`${l.label}-${i}`}>
                          <th scope="row">{l.label}</th>
                          <td className="num">{l.quantity}</td>
                          <td className="num">{dollars(l.unit_cents)}</td>
                          <td className="num">{dollars(l.amount_cents)}</td>
                          <td>{l.tariff_revision}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                ) : (
                  <p className="muted">No lines</p>
                )}
                {(user.role === "clerk" || user.role === "agent") && confirmed.billing.invoice_ids.length ? (
                  <ul className="rows">
                    {confirmed.billing.invoice_ids.map((id) => (
                      <li key={id} className="row">
                        <a href={`/invoices/${encodeURIComponent(id)}`} onClick={(e) => { e.preventDefault(); navigate(`/invoices/${encodeURIComponent(id)}`); }}>
                          Invoice {id}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
              <section className="block" aria-labelledby="reports-heading">
                <h2 id="reports-heading">Ladder reports</h2>
                {confirmed.ladder_reports.length ? (
                  <ul className="rows">
                    {confirmed.ladder_reports.map((id) => (
                      <li key={id} className="row">
                        <a href={`/reports/${encodeURIComponent(id)}`} onClick={(e) => { e.preventDefault(); navigate(`/reports/${encodeURIComponent(id)}`); }}>
                          Report {id}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No ladder reports</p>
                )}
              </section>
              <section className="block" aria-labelledby="history-heading">
                <h2 id="history-heading">History</h2>
                <ol className="rows">
                  {confirmed.history.map((h, i) => (
                    <li key={`${h.at}-${i}`} className="row">
                      <span className="num">{dateTimeOf(h.at)}</span> {h.status} <span className="muted">by {h.by}</span>
                      {h.note ? <span className="muted"> · {h.note}</span> : null}
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </div>
          {plan ? (
                <section className="block" aria-labelledby="plan-heading">
                  <h2 id="plan-heading">Plan at {dateTimeOf(plan.boarding_at)}</h2>
                  <div className="table-scroll" tabIndex={0} role="region" aria-label="Plan by waypoint">
                    <WaypointTable plan={plan} />
                  </div>
                </section>
              ) : null}
          <AmendDialog move={confirmed} open={panel === "amend"} onClose={() => setPanel(null)} announcements={announcements} onDone={done} />
          <CancelDialog move={confirmed} open={panel === "cancel"} onClose={() => setPanel(null)} announcements={announcements} onDone={done} />
          <ReorderDialog move={confirmed} open={panel === "reorder"} onClose={() => setPanel(null)} announcements={announcements} onDone={done} />
        </article>
      )}
    </Shell>
  );
}
