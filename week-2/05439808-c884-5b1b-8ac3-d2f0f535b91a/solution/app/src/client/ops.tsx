// Operations: the studio operator's service status, raid re-run and ledger check.
import { useEffect, useState } from 'preact/hooks';
import { api } from './api';
import { fmt } from './copy';
import { Button, Field, useBusy } from './ui';

interface OpsStatus {
  database: 'up' | 'down';
  mail: 'up' | 'down';
  queuedMail: number;
}

interface Rerun {
  seed: number;
  finalTick: number;
  match: boolean;
  firstMismatchTick: number | null;
}

export function OpsScreen() {
  const [status, setStatus] = useState<OpsStatus | null>(null);
  const [raidId, setRaidId] = useState('');
  const [rerunning, rerun] = useBusy();
  const [checking, check] = useBusy();
  useEffect(() => {
    const load = (): void => {
      if (document.hidden) return;
      void api.get<OpsStatus>('/api/ops/status').then(setStatus).catch(() => setStatus((s) => (s ? { ...s, database: 'down' } : s)));
    };
    load();
    const timer = window.setInterval(load, 1000);
    return () => clearInterval(timer);
  }, []);
  const submit = (e: Event): void => {
    e.preventDefault();
    const id = raidId.trim();
    void rerun({
      pending: 'Re-running seed…',
      run: () => api.post<Rerun>(`/api/ops/raids/${encodeURIComponent(id || '0')}/rerun`),
      success: (r) =>
        r.match ? `Seed ${r.seed} re-run matches every tick (0–${r.finalTick}).` : `Seed ${r.seed} re-run differs from tick ${r.firstMismatchTick ?? 0}.`,
      errors: { not_found: 'No raid has that ID.', raid_not_resolved: 'That raid has no result to re-run.' },
    });
  };
  const checkLedger = (): void => {
    void check({
      pending: 'Checking…',
      run: () => api.get<{ pairs: number; unbalancedPairs: number; overCap: number }>('/api/ops/ledger/check'),
      success: (r) =>
        r.unbalancedPairs === 0 && r.overCap === 0
          ? `Ledger balanced: ${fmt(r.pairs)} pairs.`
          : `Ledger unbalanced: ${fmt(r.unbalancedPairs)} pairs, ${fmt(r.overCap)} balances over cap.`,
    });
  };
  return (
    <main class="ops">
      <div class="column">
        <h1>Operations</h1>
        <section role="region" aria-label="Service status">
          <h2>Service status</h2>
          {status ? (
            <>
              <p class="status-line">
                <span class={status.database === 'up' ? 'dot' : 'dot down'} aria-hidden="true" />
                Database: {status.database}
              </p>
              <p class="status-line">
                <span class={status.mail === 'up' ? 'dot' : 'dot down'} aria-hidden="true" />
                {status.mail === 'up' ? 'Mail: delivering' : 'Mail: queued, Mailpit unreachable'}
              </p>
              <p class="status-line">
                Queued mail: <span class="num">{fmt(status.queuedMail)}</span>
              </p>
            </>
          ) : (
            <div class="skeleton" />
          )}
        </section>
        <section>
          <h2>Re-run a raid</h2>
          <p class="hint">Recomputes every tick from the stored seed, layout, deploys and resolution lootable amounts and compares each state hash.</p>
          <form onSubmit={submit} noValidate>
            <Field id="ops-raid" label="Raid ID">
              <input id="ops-raid" type="text" inputMode="numeric" value={raidId} onInput={(e) => setRaidId(e.currentTarget.value)} />
            </Field>
            <Button type="submit" variant="primary" busy={rerunning}>
              Re-run raid
            </Button>
          </form>
        </section>
        <section>
          <h2>Ledger</h2>
          <p class="hint">Every movement is a pair of rows summing to zero, and no balance may exceed its cap.</p>
          <Button busy={checking} onClick={checkLedger}>
            Check ledger
          </Button>
        </section>
      </div>
    </main>
  );
}
