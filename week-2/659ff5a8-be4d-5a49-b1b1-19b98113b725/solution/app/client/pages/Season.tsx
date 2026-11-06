import { useState } from "react";
import type { Season as SeasonData } from "../../shared/api.js";
import { api, fetchBlob } from "../api.js";
import { EmptyState, LoadFailed, Skeleton, StatusRegion, ScrollBox } from "../components/ui.js";
import { useRefresh } from "../hooks.js";

export function Season() {
  const [season, setSeason] = useState<SeasonData | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("");
  const reload = useRefresh(
    async () => {
      try {
        setSeason(await api.get<SeasonData>("/api/season"));
        setFailed(false);
      } catch {
        setFailed(true);
      }
    },
    10,
    [],
  );

  const exportCsv = async (): Promise<void> => {
    if (!season) return;
    setMessage("Preparing CSV");
    let blob: Blob;
    try {
      blob = await fetchBlob(`/api/season.csv?year=${season.year}`);
    } catch {
      setMessage("Could not prepare the CSV. Try again.");
      return;
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `season-standings-${season.year}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    setMessage("Standings CSV downloaded.");
  };

  return (
    <>
      <div className="page-head">
        <h1>{season ? `Season standings ${season.year}` : "Season standings"}</h1>
        <button type="button" className="btn btn-primary" disabled={!season} onClick={() => void exportCsv()}>
          Export standings CSV
        </button>
      </div>
      <StatusRegion name="Season updates">{message}</StatusRegion>
      {season === null ? (
        failed ? (
          <LoadFailed retry={reload} />
        ) : (
          <Skeleton />
        )
      ) : season.rows.length === 0 ? (
        <EmptyState next="Points appear here once the chair publishes an event's final results.">No event has been published this year.</EmptyState>
      ) : (
        <ScrollBox label="Season standings scroll area">
          <table aria-label="Season standings">
            <thead>
              <tr>
                <th scope="col" className="num">Position</th>
                <th scope="col">Driver</th>
                <th scope="col">Car</th>
                <th scope="col">Class</th>
                <th scope="col" className="num">Events</th>
                <th scope="col" className="num">Points</th>
              </tr>
            </thead>
            <tbody>
              {season.rows.map((row) => (
                <tr key={row.driverId}>
                  <td className="num">{row.position}</td>
                  <td>{row.driverName}</td>
                  <td>{row.carDescription}</td>
                  <td>{row.classCode}</td>
                  <td className="num">{row.events}</td>
                  <td className="num">{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      )}
    </>
  );
}
