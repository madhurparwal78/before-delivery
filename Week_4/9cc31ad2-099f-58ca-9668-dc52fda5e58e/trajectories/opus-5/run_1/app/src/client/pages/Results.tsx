import { useCallback, useEffect, useRef, useState } from 'react';
import { formatRaceTime, formatThousands } from '../../shared/format.js';
import { findEvent } from '../../shared/catalogue.js';
import { apiGet } from '../api.js';
import { Page } from '../components/Page.js';
import { copy, payoutCopy, rejectionCopy, verifiedCopy } from '../copy.js';
import { finishPending, onFinishChange } from '../finish.js';
import { useReducedMotion } from '../hooks.js';
import { requestEventFocus } from '../focus-intent.js';
import { Link } from '../router.js';
import { usePush } from '../store.js';
import type { RunBody } from '../types.js';

const COUNT_UP_MS = 800;

function runResultText(run: RunBody): string {
  if (run.mode === 'drift') return `${formatThousands(run.driftScore ?? 0)} pts`;
  if (run.mode === 'time-trial') {
    return formatRaceTime(run.bestLapMs ?? run.raceMs ?? 0);
  }
  return formatRaceTime(run.raceMs ?? 0);
}

export function Results({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunBody | null>(null);
  const [sending, setSending] = useState(() => finishPending(runId));
  const [payout, setPayout] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const reduced = useReducedMotion();

  const load = useCallback(async () => {
    const result = await apiGet<RunBody>(`/v1/runs/${runId}`);
    if (result.kind === 'ok') setRun(result.data);
  }, [runId]);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    void load();
    const stop = onFinishChange(() => setSending(finishPending(runId)));
    return stop;
  }, [load, runId]);

  // The verdict arrives over the live run push; polling covers a dropped socket.
  useEffect(() => {
    if (run !== null && (run.status === 'verified' || run.status === 'rejected')) return;
    const poll = window.setInterval(() => void load(), 1000);
    return () => window.clearInterval(poll);
  }, [load, run?.status]);

  usePush(
    useCallback(
      (push) => {
        if (push.type === 'run' && push.runId === runId) void load();
      },
      [load, runId],
    ),
  );

  const total = run?.payout ?? 0;

  useEffect(() => {
    if (run?.status !== 'verified') return;
    if (reduced) {
      setPayout(total);
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    const tick = () => {
      const progress = Math.min((performance.now() - startedAt) / COUNT_UP_MS, 1);
      setPayout(Math.round(total * progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [run?.status, total, reduced]);

  const statusText = (() => {
    if (run === null || sending) return copy.verifying;
    if (run.status === 'submitted' || run.status === 'verifying') return copy.verifying;
    if (run.status === 'held') return copy.held;
    if (run.status === 'rejected') {
      return rejectionCopy[run.reason ?? 'invalid_inputs'] ?? rejectionCopy.invalid_inputs!;
    }
    if (run.status === 'verified') return verifiedCopy(runResultText(run), total);
    return copy.verifying;
  })();

  const event = run?.eventId === null || run === null ? null : findEvent(run.eventId);

  return (
    <Page gutter={['Result', 'Laps', 'Payout']}>
      <h1 ref={heading} tabIndex={-1}>
        Run result
      </h1>
      <div className="cell" role="status" aria-label="Run result">
        {statusText}
      </div>
      <table aria-label="Laps">
        <thead>
          <tr>
            <th>Lap</th>
            <th className="num">Time</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {(run?.lapResults ?? []).map((lap, index) => (
            <tr key={index}>
              <td className="num">{index + 1}</td>
              <td className="num">{formatRaceTime(lap.lapMs)}</td>
              <td>{lap.valid ? 'Valid' : 'Invalid'}</td>
            </tr>
          ))}
          {run?.mode === 'drift' && (
            <tr>
              <td>Score</td>
              <td className="num">{formatThousands(run.driftScore ?? 0)}</td>
              <td>{run.status === 'verified' ? 'Valid' : ''}</td>
            </tr>
          )}
        </tbody>
      </table>
      <figure aria-label="Payout" className="cell">
        <span className="label">Payout</span>
        <span className="figure gain" style={{ fontSize: '1.6rem' }}>
          {payoutCopy(run?.status === 'verified' ? payout : 0)}
        </span>
      </figure>
      <div className="row">
        <Link to="/garage" className="secondary" id="back-to-garage">
          Back to garage
        </Link>
        {event !== null && event !== undefined && (
          <Link
            to="/championship"
            className="secondary"
            onActivate={() => requestEventFocus(event.eventId)}
          >
            Back to championship
          </Link>
        )}
      </div>
    </Page>
  );
}
