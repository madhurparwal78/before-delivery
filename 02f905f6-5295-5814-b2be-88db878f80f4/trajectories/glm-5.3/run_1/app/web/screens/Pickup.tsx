import React, { useEffect, useState } from "react";
import { api, pieceNumber, type Piece, ApiError } from "../api.js";

export default function Pickup(): React.ReactElement {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [result, setResult] = useState<string | null>(null);

  const load = () => {
    api
      .get<Piece[]>("/api/pieces?status=ready")
      .then(setPieces)
      .catch(() => setPieces([]));
    api
      .get<Piece[]>("/api/pieces?status=uncollected")
      .then((uncollected) => setPieces((p) => [...p, ...uncollected]))
      .catch(() => undefined);
  };

  useEffect(load, []);
  useEffect(() => {
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  });

  const collect = async (number: number) => {
    try {
      await api.post(`/api/pieces/${number}/collect`);
      setResult(`Piece ${pieceNumber(number)} marked collected.`);
      load();
    } catch (err) {
      const msg = err instanceof ApiError && err.code === "invalid_transition"
        ? `Piece ${pieceNumber(number)} is not on the pickup shelf.`
        : "Something went wrong.";
      setResult(msg);
    }
  };

  return (
    <main>
      <h1>Pickup shelf</h1>
      <div className="pane">
        <table aria-label="Pickup shelf">
          <thead>
            <tr>
              <th>Piece</th>
              <th>Owner</th>
              <th>Shelf</th>
              <th>Days waiting</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pieces.map((p) => (
              <tr key={p.number} className="hairline-row">
                <td className="num">{pieceNumber(p.number)}</td>
                <td>{p.owner.name}</td>
                <td className="num">{p.pickup_shelf ?? ""}</td>
                <td className="num">{p.days_on_shelf ?? 0} days</td>
                <td>
                  <button onClick={() => void collect(p.number)}>Mark Piece {pieceNumber(p.number)} collected</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pieces.length === 0 ? <p>Nothing waiting for pickup.</p> : null}
        <div role="status" aria-live="polite" className="status-line" aria-label="Pickup result">
          {result ? <span>{result}</span> : <span className="sr-only">Pickup result</span>}
        </div>
      </div>
    </main>
  );
}
