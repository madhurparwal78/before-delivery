import { useState } from "react";
import type { CorrectionEntry } from "../../shared/api.js";
import { localStamp } from "../../shared/time.js";
import { api } from "../api.js";
import { useEvent } from "../components/EventFrame.js";
import { EmptyState, LoadFailed, Skeleton, ScrollBox } from "../components/ui.js";
import { formatValues } from "../format.js";
import { useRefresh } from "../hooks.js";

export function Corrections() {
  const { event } = useEvent();
  const [log, setLog] = useState<CorrectionEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useRefresh(
    async () => {
      try {
        setLog((await api.get<{ corrections: CorrectionEntry[] }>(`/api/events/${event.id}/corrections`)).corrections);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    },
    10,
    [event.id],
  );
  return (
    <>
      <div className="page-head">
        <h1>Corrections</h1>
      </div>
      <p className="muted">Every change to a recorded run, kept as it was made. Entries are never edited or deleted.</p>
      {log === null ? (
        failed ? (
          <LoadFailed retry={reload} />
        ) : (
          <Skeleton />
        )
      ) : log.length === 0 ? (
        <EmptyState next="A run corrected on the timing screen appears here with its reason.">No corrections have been recorded.</EmptyState>
      ) : (
        <ScrollBox label="Correction log scroll area">
          <table aria-label="Correction log" className="log">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Car</th>
                <th scope="col" className="num">Run</th>
                <th scope="col" className="num">Before</th>
                <th scope="col" className="num">After</th>
                <th scope="col">By</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {log.map((c) => (
                <tr key={c.id}>
                  <td className="num">{localStamp(new Date(c.at), event.timeZone)}</td>
                  <td>
                    {c.carNumber} {c.classCode}
                  </td>
                  <td className="num">{c.runNumber}</td>
                  <td className="num">{formatValues(c.before)}</td>
                  <td className="num">{formatValues(c.after)}</td>
                  <td>{c.actor.name}</td>
                  <td>{c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      )}
    </>
  );
}
