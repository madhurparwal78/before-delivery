// The results screen: verifying, then the verdict with laps and a counted-up payout.
import { useEffect, useRef, useState, type JSX } from 'react';
import { api, type RunSummary } from './api';
import { useApp, usePush } from './appState';
import { navigate, prefersReducedMotion } from './ui';
import { fmtTime, fmtCoins, fmtScore, fmtDelta } from './formats';

export default function ResultsScreen({ runId, backToChampionshipEvent }: { runId: string; backToChampionshipEvent?: string }): JSX.Element {
  const { outage } = useApp();
  const [run, setRun] = useState<RunSummary | null>(null);
  const [missing, setMissing] = useState(false);
  const [payoutShown, setPayoutShown] = useState(0);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const load = async (): Promise<void> => {
    try {
      setRun(await api.run(runId));
    } catch {
      setMissing(true);
    }
  };

  useEffect(() => { void load(); headingRef.current?.focus(); }, [runId]);

  // Run pushes update the screen within 2 seconds without a reload.
  usePush((msg) => {
    if (msg.type === 'run' && msg.runId === runId && msg.status) {
      void load();
    }
  });

  // Poll while not final, in case the push misses.
  useEffect(() => {
    if (run && (run.status === 'verified' || run.status === 'rejected')) return;
    const t = setInterval(() => void load(), 1000);
    return () => clearInterval(t);
  }, [run]);

  // The payout count-up: zero to payout over about 0.8s, or at once under reduced motion.
  useEffect(() => {
    if (!run || run.status !== 'verified') return;
    const total = run.payout ?? 0;
    if (prefersReducedMotion() || total === 0) {
      setPayoutShown(total);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number): void => {
      const t = Math.min(1, (now - t0) / 800);
      const eased = 1 - Math.pow(1 - t, 2);
      setPayoutShown(Math.round(total * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run]);

  const copy = (r: RunSummary): string => {
    if (r.status === 'submitted' || r.status === 'verifying') return 'Verifying run…';
    if (r.status === 'held') return 'Held for verification';
    if (r.status === 'started') return 'Verifying run…';
    if (r.status === 'rejected') {
      if (r.reason === 'did_not_finish') return 'Rejected: the replay did not reach the finish.';
      if (r.reason === 'seed_mismatch') return 'Rejected: the run\'s seed did not match.';
      return 'Rejected: the inputs could not be read.';
    }
    // Verified: the result and the total payout.
    const result = r.mode === 'drift'
      ? `${fmtScore(r.driftScore ?? 0)} pts`
      : fmtTime(r.mode === 'time-trial' ? (r.bestLapMs ?? r.raceMs) : r.raceMs);
    return `Verified: ${result}, +${fmtCoins(r.payout ?? 0)} coins`;
  };

  const backToGarage = (): void => navigate('/garage', 'a[href="/garage"]');
  const backToChampionship = (): void =>
    navigate('/championship', `[data-event="${backToChampionshipEvent ?? ''}"] button[data-enter]`);

  return (
    <main className="page" style={{ paddingTop: 24, maxWidth: 720 }}>
      <h1 ref={headingRef} tabIndex={-1} data-focus="run-result">Run result</h1>
      {outage && (
        <div className="alert" role="alert">
          Replay storage is unavailable. Runs are held and will verify when it returns.
        </div>
      )}
      <div className="status" role="status" aria-live="polite">
        {missing ? 'Run not found.' : (run ? copy(run) : 'Verifying run…')}
      </div>
      {run && run.status === 'verified' && (
        <>
          <table className="table" aria-label="Laps" style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th scope="col">Lap</th>
                <th scope="col" className="num">Time</th>
                <th scope="col">Status</th>
                {run.mode === 'drift' && <th scope="col" className="num">Score</th>}
              </tr>
            </thead>
            <tbody>
              {run.lapResults.map((l, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td className="num">{fmtTime(l.lapMs)}</td>
                  <td>{l.valid ? 'Valid' : 'Invalid'}</td>
                  {run.mode === 'drift' && <td className="num">{i === 0 ? fmtScore(run.driftScore ?? 0) : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <figure aria-label="Payout" style={{ margin: '16px 0' }}>
            <figcaption className="label">Payout</figcaption>
            <span className="mono gain" style={{ fontSize: '1.4em' }}>+{fmtCoins(payoutShown)} coins</span>
          </figure>
        </>
      )}
      <p>
        <a href="/garage" onClick={e => { e.preventDefault(); backToGarage(); }}>Back to garage</a>
        {run?.eventId && run.eventId !== 'guided-first-race' && (
          <> {' · '}
            <a href="/championship" onClick={e => { e.preventDefault(); backToChampionship(); }}>Back to championship</a>
          </>
        )}
      </p>
    </main>
  );
}
