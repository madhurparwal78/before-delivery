import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, cents, pieceNumber, type Piece, type User, ApiError } from "../api.js";
import { StatusChip, useSession } from "../shared.js";

export default function PieceDetail(): React.ReactElement {
  const { number } = useParams();
  const { user } = useSession() as { user: User | null };
  const [piece, setPiece] = useState<Piece | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackingResult, setTrackingResult] = useState<string | null>(null);
  const [photoUnavailable, setPhotoUnavailable] = useState(false);

  useEffect(() => {
    api
      .get<Piece>(`/api/pieces/${number}`)
      .then((p) => {
        setPiece(p);
        setError(null);
      })
      .catch((e) => {
        setError(e instanceof ApiError ? "Not found." : "Not found.");
      });
  }, [number]);

  if (error) {
    return (
      <main>
        <div className="pane" role="status">
          <p>Not found.</p>
        </div>
      </main>
    );
  }

  if (!piece) {
    return (
      <main>
        <div className="pane" role="status">
          <p>Loading…</p>
        </div>
      </main>
    );
  }

  const isOwner = user?.role === "owner";
  const guestPiece = piece.owner.kind === "guest";

  const revoke = async () => {
    try {
      await api.post(`/api/pieces/${piece.number}/tracking-link/revoke`);
      setTrackingResult("Tracking link revoked.");
    } catch {
      setTrackingResult("Only guest pieces have a tracking link.");
    }
  };

  const newLink = async () => {
    try {
      const res = await api.post<{ tracking_url: string }>(`/api/pieces/${piece.number}/tracking-link`);
      setTrackingResult(`New tracking link created. An email to ${piece.owner.name} is on its way.`);
      void res;
    } catch {
      setTrackingResult("Only guest pieces have a tracking link.");
    }
  };

  return (
    <main>
      <h1>
        Piece <span className="num">{pieceNumber(piece.number)}</span>
      </h1>
      <div className="studio-grid">
        <div className="pane">
          <h2>Intake photo</h2>
          <figure className="photo-mat" style={{ margin: 0 }}>
            {photoUnavailable ? (
              <p>Photo unavailable while storage is down.</p>
            ) : (
              <img
                src={`/api/photos/${piece.intake_photo_id}`}
                alt={`Intake photo of Piece ${pieceNumber(piece.number)}`}
                onError={() => setPhotoUnavailable(true)}
              />
            )}
            <figcaption className="photo-caption">
              Piece {pieceNumber(piece.number)} intake photo
            </figcaption>
          </figure>
        </div>
        <div className="pane">
          <h2>Details</h2>
          <p>
            Status: <StatusChip status={piece.status} label={piece.status_label} />
          </p>
          <p className="num">
            {piece.sides_in.length && piece.sides_in.width
              ? `Sides ${piece.sides_in.length} in × ${piece.sides_in.width} in × ${piece.sides_in.height} in`
              : `Diameter ${piece.sides_in.diameter} in × Height ${piece.sides_in.height} in`}{" "}
            · {piece.cubic_inches} in³
          </p>
          <p className="num">Fee {cents(piece.fee_cents)}</p>
          <p>
            Plan: {piece.plan === "bisque_and_glaze" ? "Bisque and glaze" : piece.plan === "bisque_only" ? "Bisque only" : "Glaze only"}
            {piece.cone ? ` · Cone ${piece.cone}` : ""}
          </p>
          {piece.pickup_shelf ? (
            <p className="num">Pickup shelf {piece.pickup_shelf}</p>
          ) : null}
        </div>
      </div>
      <div className="pane">
        <h2>History</h2>
        <ul aria-label="History">
          {piece.history.map((h, i) => (
            <li key={i}>
              <span className="num">{h.at_label}</span> — {h.actor} — {h.action}
            </li>
          ))}
        </ul>
      </div>
      {isOwner && guestPiece ? (
        <div className="pane">
          <h2>Tracking link</h2>
          <div className="field-row">
            <button onClick={() => void revoke()}>Revoke tracking link</button>
            <button onClick={() => void newLink()}>New tracking link</button>
          </div>
          <div role="status" aria-live="polite" className="status-line" aria-label="Tracking result">
            {trackingResult ? <span>{trackingResult}</span> : <span className="sr-only">Tracking result</span>}
          </div>
        </div>
      ) : null}
    </main>
  );
}
