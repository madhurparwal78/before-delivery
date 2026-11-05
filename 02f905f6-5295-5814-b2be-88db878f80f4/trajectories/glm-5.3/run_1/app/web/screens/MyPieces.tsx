import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, cents, pieceNumber, type Piece } from "../api.js";
import { StatusChip } from "../shared.js";

export default function MyPieces(): React.ReactElement {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    api
      .get<Piece[]>("/api/pieces")
      .then((p) => {
        setPieces(p);
        setLoaded(true);
      })
      .catch(() => undefined);
    api
      .get<{ owed_cents: number }>("/api/me/balance")
      .then((b) => {
        setBalance(b.owed_cents);
        setBalanceError(false);
      })
      .catch(() => setBalanceError(true));
  };

  useEffect(load, []);

  return (
    <main>
      <h1>My pieces</h1>
      <div className="pane">
        <table aria-label="My pieces">
          <thead>
            <tr>
              <th>Piece</th>
              <th>Status</th>
              <th>Sizes</th>
              <th>Fee</th>
            </tr>
          </thead>
          <tbody>
            {pieces.map((p) => (
              <tr key={p.number} className="hairline-row">
                <td>
                  <Link to={`/pieces/${p.number}`} className="num">
                    {pieceNumber(p.number)}
                  </Link>
                </td>
                <td>
                  <StatusChip status={p.status} label={p.status_label} />
                </td>
                <td className="num">
                  {p.sides_in.length && p.sides_in.width
                    ? `${p.sides_in.length} × ${p.sides_in.width} × ${p.sides_in.height} in`
                    : `${p.sides_in.diameter} × ${p.sides_in.height} in`}
                </td>
                <td className="num">{cents(p.fee_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loaded && pieces.length === 0 ? <p>No pieces yet.</p> : null}
      </div>
      <div className="pane" aria-label="My balance" role="region">
        <h2>My balance</h2>
        {balanceError ? (
          <p>Balance unavailable while billing is down.</p>
        ) : balance === null ? (
          <p>…</p>
        ) : (
          <p className="num">Owed {cents(balance)}</p>
        )}
      </div>
    </main>
  );
}
