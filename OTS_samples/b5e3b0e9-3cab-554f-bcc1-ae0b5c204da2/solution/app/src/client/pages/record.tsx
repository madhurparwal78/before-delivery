import { useLayoutEffect, useState } from "preact/hooks";
import { api, ApiFailure } from "../api.ts";
import { Link } from "../router.tsx";
import { Loading, NotFound } from "./shared.tsx";

interface RecordBody {
  name: string;
  assignments: { id: string; scenario: string; dueOn: string; attempts: number; bestScore: number | null; status: string }[];
  attempts: { sessionId: string; scenario: string; finished: string; position: string; score: number; result: string; timing: string }[];
}

export function RecordPage({ id }: { id: string }) {
  const [body, setBody] = useState<RecordBody | "loading" | "missing">("loading");
  useLayoutEffect(() => {
    api<RecordBody>("GET", `/api/records/${id}`)
      .then(setBody)
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        setBody("missing");
      });
  }, [id]);
  if (body === "loading") return <Loading />;
  if (body === "missing") return <NotFound />;
  return (
    <div class="page">
      <h1>Record: {body.name}</h1>
      <section class="cell">
        <h2>Assignments</h2>
        <ul aria-label="Assignment results" class="results">
          {body.assignments.map((assignment) => (
            <li key={assignment.id}>
              <h3>{assignment.scenario}</h3>
              <p>Due on {assignment.dueOn}</p>
              <p>{`Attempts: ${assignment.attempts}`}</p>
              <p>{`Best score: ${assignment.bestScore ?? "none"}`}</p>
              <p>{`Status: ${assignment.status}`}</p>
            </li>
          ))}
        </ul>
        {body.assignments.length === 0 && <p class="empty">No assignments yet.</p>}
      </section>
      <section class="cell">
        <h2>Attempts</h2>
        <table aria-label="Attempts" role="table" class="table reflow">
          <thead role="rowgroup">
            <tr role="row">
              {["Scenario", "Finished", "Position", "Score", "Result", "Timing", "Debrief"].map((head) => (
                <th role="columnheader" key={head}>
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {body.attempts.map((attempt) => (
              <tr role="row" key={attempt.sessionId}>
                <td role="cell" data-label="Scenario">{attempt.scenario}</td>
                <td role="cell" data-label="Finished" class="tabular">{attempt.finished}</td>
                <td role="cell" data-label="Position">{attempt.position}</td>
                <td role="cell" data-label="Score" class="tabular">{attempt.score}</td>
                <td role="cell" data-label="Result">{attempt.result}</td>
                <td role="cell" data-label="Timing">{attempt.timing}</td>
                <td role="cell" data-label="Debrief">
                  <Link href={`/sessions/${attempt.sessionId}/debrief`}>Open debrief</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {body.attempts.length === 0 && <p class="empty">No finished exercises yet.</p>}
      </section>
    </div>
  );
}
