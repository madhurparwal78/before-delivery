import type { JSX } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import type { DailyMonth, Leaderboard as Board, LeaderboardRow } from "../../shared/protocol";
import { get } from "../api";
import { announce } from "../announcer";
import { formatClock, longDate } from "../format";
import { useLoad } from "../hooks";
import { LiveSocket } from "../liveSocket";
import { failureSentence } from "../messages";
import { useMe } from "../me";
import { NotFound, Voice } from "./NotFound";

const M45 = "Confirm your email to appear on the leaderboard.";
const M47 = "Live updates are paused. Reload to see new results.";
const M48 = "No one has finished this daily yet.";

export function Leaderboard({ date }: { date?: string }): JSX.Element {
  const today = useLoad(async () => date ?? (await get<DailyMonth>("/api/daily")).today, date ?? "today");
  if (today.status === "loading") return <Heading body={<Voice sentence="The atelier is preparing your page." />} />;
  if (today.status === "failed") return <Heading body={<Voice sentence={failureSentence(today.error)} />} />;
  return <Day date={today.value} />;
}

function Heading({ body }: { body: JSX.Element }): JSX.Element {
  return (
    <section class="leaderboard">
      <h1 class="page-title">Daily leaderboard</h1>
      {body}
    </section>
  );
}

function Day({ date }: { date: string }): JSX.Element {
  const me = useMe();
  const loaded = useLoad(() => get<Board>(`/api/leaderboard/${date}`), date);
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const live = loaded.status === "ready" && loaded.value.live;

  useLayoutEffect(() => {
    if (loaded.status !== "ready") return undefined;
    setRows(loaded.value.rows);
    if (!loaded.value.live) {
      announce(M47);
      return undefined;
    }
    const socket = new LiveSocket((message) => {
      if (message.type === "leaderboard" && message.date === date) {
        setRows(message.rows);
        announce(`${message.latest.display_name} finished at rank ${message.latest.rank}.`);
      }
    });
    socket.send({ type: "leaderboard", date });
    return () => socket.close();
  }, [loaded.status, date]);

  if (loaded.status === "failed") {
    return loaded.error.code === "VALIDATION" ? <NotFound /> : <Heading body={<Voice sentence={failureSentence(loaded.error)} />} />;
  }
  if (loaded.status === "loading" || rows === null) return <Heading body={<Voice sentence="The atelier is preparing your page." />} />;
  const notices = [!live ? M47 : "", me && !me.verified ? M45 : "", rows.length === 0 ? M48 : ""].filter(Boolean);
  return (
    <section class="leaderboard">
      <h1 class="page-title">Daily leaderboard</h1>
      {notices.length > 0 && (
        <p id="leaderboard-notice" class="voice-line">
          {notices.join(" ")}
        </p>
      )}
      <div class="tile table-tile" tabIndex={0} role="region" aria-label="Leaderboard rows">
        <table aria-label={`Daily leaderboard, ${longDate(date)}`} class="rows">
          <thead>
            <tr>
              {["Rank", "Player", "Time", "Score", "Mistakes", "Hints"].map((name) => (
                <th scope="col" key={name}>
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.display_name} data-player={row.display_name} aria-current={me?.display_name === row.display_name ? "true" : undefined}>
                <td>{row.rank}</td>
                <td>{row.display_name}</td>
                <td>{formatClock(row.seconds)}</td>
                <td>{row.score}</td>
                <td>{row.mistakes}</td>
                <td>{row.hints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
