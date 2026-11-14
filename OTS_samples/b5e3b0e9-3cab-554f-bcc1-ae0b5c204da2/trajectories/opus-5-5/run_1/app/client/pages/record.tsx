import { useLayoutEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { Loading, NotFound } from '../components/shell.js';

interface RecordView {
  name: string;
  assignments: { id: string; scenario: string; className: string; dueOn: string; attempts: number; bestScore: number | null; status: string }[];
  attempts: { sessionId: string; scenario: string; finished: string; position: string; score: number; result: string; timing: string }[];
}

export function RecordPage({ id }: { id: string }) {
  const [record, setRecord] = useState<RecordView | null>(null);
  const [missing, setMissing] = useState(false);
  useLayoutEffect(() => {
    api<RecordView>('GET', `/api/records/${encodeURIComponent(id)}`)
      .then(setRecord)
      .catch(() => setMissing(true));
  }, [id]);
  if (missing) return <NotFound />;
  if (!record) return <Loading />;
  return (
    <div class="grid-page">
      <section class="cell span-all">
        <h1>Record: {record.name}</h1>
        <ul aria-label="Assignment results" class="result-list">
          {record.assignments.map((assignment) => (
            <li key={assignment.id} class="result">
              <h2>{assignment.scenario}</h2>
              <p class="muted">
                {assignment.className}, due {assignment.dueOn}
              </p>
              <p class="score-numeral" aria-hidden="true">
                {assignment.bestScore ?? '-'}
              </p>
              <p>Attempts: {assignment.attempts}</p>
              <p>Best score: {assignment.bestScore ?? 'none'}</p>
              <p>Status: {assignment.status}</p>
            </li>
          ))}
        </ul>
        {record.assignments.length === 0 ? <p class="empty">No assignments yet.</p> : null}
      </section>
      <section class="cell span-all">
        <h2>Attempts</h2>
        <table aria-label="Attempts" class="data-table reflow" role="table">
          <thead role="rowgroup">
            <tr role="row">
              {['Scenario', 'Finished', 'Position', 'Score', 'Result', 'Timing', 'Debrief'].map((heading) => (
                <th key={heading} scope="col" role="columnheader">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {record.attempts.map((attempt) => (
              <tr key={attempt.sessionId} role="row">
                <td role="cell" data-label="Scenario">{attempt.scenario}</td>
                <td role="cell" data-label="Finished">{attempt.finished}</td>
                <td role="cell" data-label="Position">{attempt.position}</td>
                <td role="cell" data-label="Score" class="num">{attempt.score}</td>
                <td role="cell" data-label="Result">{attempt.result}</td>
                <td role="cell" data-label="Timing">{attempt.timing}</td>
                <td role="cell" data-label="Debrief">
                  <a href={`/sessions/${attempt.sessionId}/debrief`}>Open debrief</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {record.attempts.length === 0 ? <p class="empty">No attempts yet.</p> : null}
      </section>
    </div>
  );
}
