// My pieces and My balance, for a member.
import { useEffect, useState } from "react";
import type { Piece } from "../../shared/api";
import { request } from "../api";
import { EmptySlip } from "../components/EmptySlip";
import { Status } from "../components/Status";
import { money } from "../format";
import { Link } from "../router";

export function sizesText(piece: Piece): string {
  const s = piece.sides_in;
  return piece.shape === "rectangular" ? `${s.length} × ${s.width} × ${s.height} in` : `⌀ ${s.diameter} × ${s.height} in`;
}

export function Pieces() {
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  const [balance, setBalance] = useState<{ kind: "loading" } | { kind: "ok"; cents: number } | { kind: "down" }>({ kind: "loading" });

  useEffect(() => {
    void request<Piece[]>("GET", "/api/pieces").then((r) => setPieces(r.ok ? r.data : []));
    void request<{ owed_cents: number }>("GET", "/api/me/balance").then((r) => setBalance(r.ok ? { kind: "ok", cents: r.data.owed_cents } : { kind: "down" }));
  }, []);

  return (
    <div className="page pieces-page">
      <div className="page-head">
        <h1>My pieces</h1>
        <Link href="/intake" className="btn">
          Log another piece
        </Link>
      </div>
      <section className="pane balance" aria-labelledby="balance-title">
        <h2 id="balance-title">My balance</h2>
        {balance.kind === "loading" ? <p className="balance-figure muted">Reading your balance…</p> : null}
        {balance.kind === "ok" ? (
          <p className="balance-figure">
            {balance.cents > 0 ? "You owe " : "Nothing owed: "}
            <span className="num-strong">{money(Math.max(balance.cents, 0))}</span>
          </p>
        ) : null}
        {balance.kind === "down" ? <p className="is-error">Balance unavailable while billing is down.</p> : null}
      </section>
      <section className="pane">
        {pieces === null ? <p className="muted">Loading your pieces…</p> : null}
        {pieces !== null && pieces.length === 0 ? <EmptySlip>No pieces yet. Log one at the intake bench and it will appear here.</EmptySlip> : null}
        {pieces !== null && pieces.length > 0 ? (
          <div className="table-wrap" tabIndex={0}>
            <table className="table" aria-label="My pieces">
              <thead>
                <tr>
                  <th scope="col">Piece</th>
                  <th scope="col">Status</th>
                  <th scope="col">Sizes</th>
                  <th scope="col" className="right">
                    Fee
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
                    <td>
                      <Status status={piece.status} label={piece.status_label} />
                      {piece.pickup_shelf && (piece.status === "ready" || piece.status === "uncollected") ? (
                        <span className="small muted"> · shelf <span className="num">{piece.pickup_shelf}</span></span>
                      ) : null}
                    </td>
                    <td className="num">{sizesText(piece)}</td>
                    <td className="num right">{money(piece.fee_cents)}</td>
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
