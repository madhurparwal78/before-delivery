import { GlassWater } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { z } from "zod";
import { nightDetailSchema, nightSummarySchema, type NightDetail, type NightSummary } from "../../shared/schemas";
import { ApiFailure, api } from "../lib/api";
import { HostShell } from "./HostShell";

const nightsReply = z.object({ nights: z.array(nightSummarySchema) });
const nightReply = z.object({ night: nightDetailSchema });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatNightDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function Nights() {
  const [nights, setNights] = useState<NightSummary[] | null>(null);
  useEffect(() => {
    void api("/api/nights", { schema: nightsReply }).then((reply) => setNights(reply.nights));
  }, []);

  return (
    <HostShell>
      <div className="page">
        <h1>Past nights</h1>
        {nights === null ? (
          <div className="skeletons" aria-busy="true">
            <p className="muted">Loading nights…</p>
            <div className="skeleton" />
          </div>
        ) : nights.length === 0 ? (
          <div className="empty">
            <GlassWater size={72} strokeWidth={1} aria-hidden="true" />
            <p>No nights yet.</p>
          </div>
        ) : (
          <ul className="night-list" aria-label="Past nights">
            {nights.map((night) => (
              <li key={night.roomId} className="panel night-row">
                <Link className="display night-link" to={`/host/nights/${night.roomId}`}>
                  {night.deckTitle} — {formatNightDate(night.endedAt)}
                </Link>
                <p className="night-podium">{night.podium.map((place) => place.nickname).join(" · ")}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </HostShell>
  );
}

export function NightResults() {
  const { roomId } = useParams();
  const [night, setNight] = useState<NightDetail | "missing" | null>(null);
  useEffect(() => {
    api(`/api/nights/${roomId}`, { schema: nightReply }).then(
      (reply) => setNight(reply.night),
      (error: unknown) => {
        if (error instanceof ApiFailure && error.status === 404) setNight("missing");
      },
    );
  }, [roomId]);

  return (
    <HostShell>
      <div className="page">
        <p>
          <Link to="/host/nights">All past nights</Link>
        </p>
        {night === null ? (
          <p className="muted">Loading nights…</p>
        ) : night === "missing" ? (
          <h1>Not found</h1>
        ) : (
          <>
            <h1>
              {night.deckTitle}
              <span className="night-date muted"> — {formatNightDate(night.endedAt)}</span>
            </h1>
            <table className="standings panel" aria-label="Final standings">
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Nickname</th>
                  <th scope="col">Score</th>
                </tr>
              </thead>
              <tbody>
                {night.standings.map((row) => (
                  <tr key={row.rank}>
                    <td className="display numeral">{row.rank}</td>
                    <td>{row.nickname}</td>
                    <td className="display numeral">{row.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </HostShell>
  );
}
