// The pickup shelf: ready (and lapsed) pieces with their shelf and days waiting.
import { useEffect, useState } from "react";
import type { Piece } from "../../shared/api";
import { request } from "../api";
import { EmptySlip } from "../components/EmptySlip";
import { Status } from "../components/Status";
import { Link } from "../router";

export function Pickup() {
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: string }>({ text: "", tone: "" });

  const load = async () => {
    const [ready, lapsed] = await Promise.all([request<Piece[]>("GET", "/api/pieces?status=ready"), request<Piece[]>("GET", "/api/pieces?status=uncollected")]);
    setPieces([...(ready.ok ? ready.data : []), ...(lapsed.ok ? lapsed.data : [])].sort((a, b) => a.number.localeCompare(b.number)));
  };

  useEffect(() => {
    void load();
  }, []);

  const collect = async (number: string) => {
    const result = await request<Piece>("POST", `/api/pieces/${number}/collect`, {});
    if (result.ok) {
      setMessage({ text: `Piece ${number} marked collected.`, tone: "ok" });
      setPieces((current) => (current ?? []).filter((p) => p.number !== number));
    } else {
      setMessage({ text: result.error?.message ?? `Piece ${number} is not on the pickup shelf.`, tone: "error" });
    }
  };

  return (
    <div className="page pickup-page">
      <div className="page-head">
        <h1>Pickup shelf</h1>
        <p className="muted">A reminder goes out at 14 days; pieces lapse to Uncollected at 21.</p>
      </div>
      <p role="status" aria-label="Pickup result" className={`result${message.tone ? ` is-${message.tone}` : ""}`}>
        {message.text}
      </p>
      <section className="pane">
        {pieces === null ? <p className="muted">Loading the pickup shelf…</p> : null}
        {pieces !== null && pieces.length === 0 ? <EmptySlip>Nothing is waiting for pickup. Unloaded pieces land here with their shelf code.</EmptySlip> : null}
        {pieces !== null && pieces.length > 0 ? (
          <div className="table-wrap" tabIndex={0}>
            <table className="table" aria-label="Pickup shelf">
              <thead>
                <tr>
                  <th scope="col">Piece</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Shelf</th>
                  <th scope="col">Days waiting</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="visually-hidden">Collect</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pieces.map((piece) => (
                  <tr key={piece.number}>
                    <td>
                      <Link href={`/pieces/${piece.number}`} className="num row-link">
                        {piece.number}
                      </Link>
                    </td>
                    <td>{piece.owner.name}</td>
                    <td className="num">{piece.pickup_shelf}</td>
                    <td className="num">{piece.days_on_shelf} days</td>
                    <td>
                      <Status status={piece.status} label={piece.status_label} />
                    </td>
                    <td className="right">
                      <button type="button" className="btn" onClick={() => void collect(piece.number)} aria-label={`Mark Piece ${piece.number} collected`}>
                        Mark collected
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
