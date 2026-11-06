import { useEffect, useState } from "react";
import { request } from "../api.ts";
import { SESSION_ENDED_CANCELLED, UNEXPECTED } from "../copy.ts";
import { navigate } from "../router.ts";
import { useStaff } from "./session.ts";
import { mayCreate } from "../../shared/restatementRules.ts";
import type { RestatementView } from "../../shared/domain.ts";
import { isoWallClock, isoWallDate } from "../../shared/newyork.ts";

function when(restatement: RestatementView): string {
  const instant = restatement.published_at ?? restatement.release_at;
  return instant ? `${isoWallDate(instant)} ${isoWallClock(instant, true)} ET` : "—";
}

export function RestatementList() {
  const { user } = useStaff();
  const [restatements, setRestatements] = useState<RestatementView[]>([]);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const analyst = mayCreate(user);

  useEffect(() => {
    void request<{ restatements: RestatementView[] }>("GET", "/api/restatements").then((answer) => {
      if (answer.kind === "ok") {
        setRestatements(answer.body.restatements);
        setLoaded(true);
      }
      else setMessage(answer.kind === "refused" && answer.status === 401 ? SESSION_ENDED_CANCELLED : UNEXPECTED);
    });
  }, []);

  const create = async (body: Record<string, string>): Promise<void> => {
    const answer = await request<{ restatement: RestatementView }>("POST", "/api/restatements", { body });
    if (answer.kind === "ok") navigate(`/staff/restatements/${answer.body.restatement.id}`);
    else setMessage(answer.kind === "refused" && answer.status === 401 ? SESSION_ENDED_CANCELLED : UNEXPECTED);
  };

  const latestPublished = restatements.filter((candidate) => candidate.state === "published").sort((a, b) => b.week_ending.localeCompare(a.week_ending))[0];

  return (
    <>
      <h1>Restatements</h1>
      {analyst && (
        <div className="actions">
          <button type="button" className="primary" onClick={() => void create({})}>New weekly draft</button>
          <button type="button" disabled={!latestPublished} onClick={() => latestPublished && void create({ supersedes: latestPublished.id })}>Start correction</button>
        </div>
      )}
      <p className="staff-updates" role="status" aria-label="Staff updates">{message}</p>
      <div className="table-scroll">
        <table className="list" aria-label="Restatements">
          <thead>
            <tr>
              <th scope="col">Week ending</th>
              <th scope="col">State</th>
              <th scope="col">Preparer</th>
              <th scope="col">Correction</th>
              <th scope="col">Release or publication time</th>
            </tr>
          </thead>
          <tbody>
            {restatements.map((restatement) => (
              <tr key={restatement.id}>
                <td>
                  <a href={`/staff/restatements/${restatement.id}`} onClick={(event) => { event.preventDefault(); navigate(`/staff/restatements/${restatement.id}`); }}>
                    {restatement.week_ending}
                  </a>
                </td>
                <td>{restatement.state}</td>
                <td>{restatement.prepared_by.name}</td>
                <td>{restatement.supersedes ? "Correction" : "Weekly"}</td>
                <td className="mono">{when(restatement)}</td>
              </tr>
            ))}
            {loaded && restatements.length === 0 && (
              <tr>
                <td colSpan={5}>No restatements yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
