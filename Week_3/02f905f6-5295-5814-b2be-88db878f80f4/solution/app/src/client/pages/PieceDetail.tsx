// One piece: its intake photo, frozen measurements and fee, status and history; for the owner and a
// guest piece, the tracking-link controls.
import { useEffect, useState } from "react";
import type { Clay, Piece, User } from "../../shared/api";
import { request } from "../api";
import { Photo } from "../components/Photo";
import { Status } from "../components/Status";
import { money, PLAN_LABELS } from "../format";
import { sizesText } from "./Pieces";

const ACTIONS: Record<string, string> = {
  accepted: "Accepted and charged",
  paid: "Paid at the counter",
  placed: "Placed on a shelf",
  moved: "Moved on the shelf",
  removed: "Taken off the shelf",
  fired: "Firing started",
  unloaded: "Unloaded",
  collected: "Collected",
  uncollected: "Lapsed to uncollected",
  "damage reported": "Damage reported",
  "damage charged": "Shelf damage charged",
  "damage waived": "Shelf damage waived",
  "tracking revoked": "Tracking link revoked",
  "tracking replaced": "Tracking link replaced",
};

export function PieceDetail({ user, number }: { user: User; number: string }) {
  const [piece, setPiece] = useState<Piece | null | "missing">(null);
  const [clays, setClays] = useState<Clay[]>([]);
  const [tracking, setTracking] = useState("");

  useEffect(() => {
    void request<Piece>("GET", `/api/pieces/${number}`).then((r) => setPiece(r.ok ? r.data : "missing"));
    void request<Clay[]>("GET", "/api/clays").then((r) => r.ok && setClays(r.data));
  }, [number]);

  if (piece === null) return <p className="page muted">Loading piece…</p>;
  if (piece === "missing") {
    return (
      <div className="page">
        <div className="empty">
          <p>There is no piece {number} you can open.</p>
        </div>
      </div>
    );
  }

  const revoke = async () => {
    const r = await request("POST", `/api/pieces/${piece.number}/tracking-link/revoke`, {});
    setTracking(r.ok ? "Tracking link revoked." : r.error?.message ?? "Not saved — the studio server is unreachable.");
  };
  const replace = async () => {
    const r = await request<{ tracking_url: string }>("POST", `/api/pieces/${piece.number}/tracking-link`, {});
    setTracking(r.ok ? `New tracking link created. An email to ${piece.owner.email} is on its way.` : r.error?.message ?? "Not saved — the studio server is unreachable.");
  };
  const clay = clays.find((c) => c.id === piece.clay_id);

  return (
    <div className="page piece-page">
      <div className="page-head">
        <h1>
          Piece <span className="num">{piece.number}</span>
        </h1>
        <Status status={piece.status} label={piece.status_label} />
      </div>
      <div className="piece-layout">
        <Photo photoId={piece.intake_photo_id} alt={`Intake photo of Piece ${piece.number}`} caption={`Piece ${piece.number} · intake photo`} />
        <section className="pane" aria-labelledby="piece-facts">
          <h2 id="piece-facts">Ticket</h2>
          <dl className="facts">
            <dt>Owner</dt>
            <dd>{piece.owner.name}</dd>
            <dt>Rounded sides</dt>
            <dd className="num">{sizesText(piece)}</dd>
            <dt>Volume</dt>
            <dd className="num">{piece.cubic_inches} in³</dd>
            <dt>Fee</dt>
            <dd className="num">{money(piece.fee_cents)}</dd>
            <dt>Plan</dt>
            <dd>{PLAN_LABELS[piece.plan]}</dd>
            <dt>Glaze cone</dt>
            <dd>{piece.cone ? <span className="num">Cone {piece.cone}</span> : "None"}</dd>
            <dt>Clay body</dt>
            <dd>{clay?.name ?? piece.clay_id}</dd>
            <dt>Pickup shelf</dt>
            <dd>{piece.pickup_shelf ? <span className="num">{piece.pickup_shelf}</span> : "Not yet"}</dd>
            {piece.days_on_shelf !== null ? (
              <>
                <dt>Days waiting</dt>
                <dd className="num">{piece.days_on_shelf} days</dd>
              </>
            ) : null}
          </dl>
          {user.role === "owner" && piece.owner.kind === "guest" ? (
            <div className="tracking-controls">
              <h3>Tracking link</h3>
              <div className="button-row">
                <button type="button" className="btn" onClick={() => void revoke()}>
                  Revoke tracking link
                </button>
                <button type="button" className="btn" onClick={() => void replace()}>
                  New tracking link
                </button>
              </div>
              <p role="status" aria-label="Tracking result" className="result">
                {tracking}
              </p>
            </div>
          ) : null}
        </section>
        <section className="pane" aria-labelledby="history-title">
          <h2 id="history-title">History</h2>
          <ol className="history" aria-label="History">
            {piece.history.map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <span className="history-action">{ACTIONS[entry.action] ?? entry.action}</span>
                <span className="small muted">
                  {entry.actor} · <span className="num">{entry.at_label}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
