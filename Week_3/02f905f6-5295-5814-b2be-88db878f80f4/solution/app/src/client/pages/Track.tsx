// The guest's tracking card: one piece's number, status and pickup shelf, and nothing else.
import { useEffect, useState } from "react";
import type { Tracking } from "../../shared/api";
import { request } from "../api";
import { ConeGlyph } from "../components/ConeGlyph";
import { Status } from "../components/Status";

export function Track({ token }: { token: string }) {
  const [card, setCard] = useState<Tracking | "dead" | null>(null);
  useEffect(() => {
    void request<Tracking>("GET", `/api/track/${token}`).then((r) => setCard(r.ok ? r.data : "dead"));
  }, [token]);

  return (
    <main className="track-page">
      <p className="track-studio">Brickfield Lane Clayhouse</p>
      <div className="track-card stub">
        {card === null ? <p className="muted">Looking up your piece…</p> : null}
        {card === "dead" ? (
          <div className="track-dead">
            <ConeGlyph bent={false} size={32} />
            <p>This tracking link is no longer active.</p>
          </div>
        ) : null}
        {card && card !== "dead" ? (
          <>
            <h1>
              Piece <span className="num">{card.piece_number}</span>
            </h1>
            <p className="track-status">
              <Status status={card.status} label={card.status_label} />
            </p>
            {card.pickup_shelf ? (
              <p className="track-shelf">
                Pickup shelf <span className="num-strong">{card.pickup_shelf}</span>
              </p>
            ) : (
              <p className="muted small">This page updates each time you open it.</p>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}
