import { useState } from "preact/hooks";
import type { HistoryRow } from "../../shared/api.ts";
import { CHIP_NAME, PENDING, STORED } from "../format.ts";
import { DownloadIcon } from "./Icons.tsx";

// The gameweek history table with receipts and snapshot downloads (brief: History, Member history).
export function HistoryTable(props: {
  rows: HistoryRow[];
  playerName: (id: string) => string;
  snapshotUrl: (gameweek: number) => string;
  announce: (text: string, error?: boolean) => void;
}) {
  const [preparing, setPreparing] = useState<number | null>(null);

  const download = async (event: MouseEvent, gameweek: number) => {
    event.preventDefault();
    if (preparing !== null) return;
    setPreparing(gameweek);
    try {
      const response = await fetch(props.snapshotUrl(gameweek), { credentials: "same-origin" });
      if (response.ok) {
        const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? `elevens-gw${gameweek}.json`;
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else if (response.status === 409) {
        props.announce("The receipt is still pending. Try again when it shows as stored.", true);
      } else if (response.status === 503) {
        props.announce("Storage is unreachable. Try the download again in a minute.", true);
      } else {
        props.announce(((await response.json()) as { message: string }).message, true);
      }
    } catch {
      props.announce("Storage is unreachable. Try the download again in a minute.", true);
    } finally {
      setPreparing(null);
    }
  };

  return (
    <div class="table-frame" tabIndex={0} role="region" aria-label="Gameweek history, scrollable">
      <table aria-label="Gameweek history">
        <thead>
          <tr>
            <th scope="col">Gameweek</th>
            <th scope="col" class="num">
              Points
            </th>
            <th scope="col" class="num">
              Hit
            </th>
            <th scope="col" class="num">
              Net
            </th>
            <th scope="col" class="num">
              Total
            </th>
            <th scope="col">Chip</th>
            <th scope="col">Captain</th>
            <th scope="col">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.length === 0 && (
            <tr>
              <td colSpan={8} class="empty-cell">
                <span>No locked gameweeks yet. Your first row appears at the deadline.</span>
              </td>
            </tr>
          )}
          {props.rows.map((row) => (
            <tr key={row.gameweek} class="control-row">
              <th scope="row" class="mono">
                GW {row.gameweek}
                <span class="hint"> {row.status}</span>
              </th>
              <td class="num">{row.points}</td>
              <td class={`num${row.hit_points ? " negative" : ""}`}>{row.hit_points ? `-${row.hit_points}` : "0"}</td>
              <td class="num">{row.net_points}</td>
              <td class="num">{row.running_total ?? "—"}</td>
              <td>{row.chip ? CHIP_NAME[row.chip] : "—"}</td>
              <td>{props.playerName(row.captain)}</td>
              <td>
                {row.receipt === "stored" ? (
                  <span class="rank-cell">
                    {STORED}
                    <a href={props.snapshotUrl(row.gameweek)} aria-busy={preparing === row.gameweek ? "true" : undefined} onClick={(event) => void download(event, row.gameweek)}>
                      <DownloadIcon />
                      {preparing === row.gameweek ? "Preparing…" : "Download"}
                      <span class="sr-only">{` gameweek ${row.gameweek} snapshot`}</span>
                    </a>
                  </span>
                ) : (
                  <span class="hint">{PENDING}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
