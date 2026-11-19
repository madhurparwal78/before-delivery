import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError, openLive, refuse } from '../api.ts';
import { Link, navigate } from '../router.tsx';
import { Button, Icon, Loading, NotFound, ReviewUpdates, Screen, Time, TwoPane } from '../ui.tsx';
import type { CheckRow, LiveEvent, QueueEntryView, QueueView } from '../../shared/types.ts';
import './queue.css';

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function Checks({ checks }: { checks: CheckRow[] }) {
  return (
    <ul className="checks" aria-label="Checks">
      {checks.map((check) => (
        <li key={check.name} data-check-name={check.name} data-state={check.state} className={`check-row check-${check.state}`}>
          <Icon name={check.state === 'success' ? 'check' : check.state === 'failure' || check.state === 'timed_out' ? 'x' : check.state === 'in_progress' ? 'spinner' : 'clock'} size={14} />
          <span className="check-name">{check.name}</span>
          <span className="check-word">{check.word}</span>
          {check.summary ? <span className="check-summary">{check.summary}</span> : null}
          {check.timeout_at ? <span className="check-timeout">Times out at {check.timeout_at.shown}</span> : null}
        </li>
      ))}
    </ul>
  );
}

const STATE_WORD: Record<string, string> = { waiting: 'Waiting for checks', checking: 'Checking', merged: 'Merged', removed: 'Removed' };

export function QueuePage({ org, repo }: { org: string; repo: string }) {
  const base = `/api/repos/${org}/${repo}`;
  const [view, setView] = useState<QueueView | null>(null);
  const [rules, setRules] = useState<{ required_approvals: number; required_checks: string[] } | null>(null);
  const [lines, setLines] = useState<{ id: number; text: string }[]>([]);
  const [missing, setMissing] = useState(false);
  const counter = useRef(0);
  const loaded = useRef(false);
  const refocus = useRef<number | null>(null);
  const rects = useRef(new Map<number, number>());
  const animations = useRef(new WeakMap<Element, Animation>());
  const listRef = useRef<HTMLUListElement>(null);

  const load = async (): Promise<void> => {
    try {
      const [next, settings] = await Promise.all([
        api<QueueView>('GET', `${base}/queue/view`),
        api<{ settings: { required_approvals: number; required_checks: string[] } }>('GET', `/api/repos/${org}/${repo}`),
      ]);
      loaded.current = true;
      setRules(settings.settings);
      setView(next);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) navigate('/login', true);
      else if (error instanceof ApiError && error.status === 404) setMissing(true);
      else if (!refuse(error)) throw error;
    }
  };

  // The live stream opens first and the first load follows its open event, so no update is missed.
  useLayoutEffect(() => {
    const source = openLive(org, repo);
    source.onopen = () => void load();
    source.onclose = () => {
      if (!loaded.current) void load();
    };
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveEvent;
      const spoken = event.announce.filter((line) => line.on !== 'change');
      if (spoken.length) setLines((all) => [...all, ...spoken.map((line) => ({ id: ++counter.current, text: line.text }))]);
      if (event.queue) void load();
    };
    return () => source.close();
  }, [org, repo]);

  // After each render: keep focus on a moved entry and slide entries to their new places.
  useLayoutEffect(() => {
    const list = listRef.current;
    const now = new Map<number, number>();
    for (const item of list?.querySelectorAll<HTMLElement>('[data-queue-entry-id]') ?? []) now.set(Number(item.dataset.queueEntryId), item.offsetTop);
    if (list && !reduced()) {
      for (const item of list.querySelectorAll<HTMLElement>('[data-queue-entry-id]')) {
        const before = rects.current.get(Number(item.dataset.queueEntryId));
        const shift = before === undefined ? 0 : before - item.offsetTop;
        if (Math.abs(shift) < 1) continue;
        animations.current.get(item)?.cancel();
        const run = item.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
        animations.current.set(item, run);
        item.dataset.anim = 'moving';
        const done = () => {
          if (animations.current.get(item) === run) item.dataset.anim = 'none';
        };
        run.onfinish = done;
        run.oncancel = done;
      }
    }
    rects.current = now;
    if (refocus.current !== null) {
      const item = list?.querySelector<HTMLElement>(`[data-queue-entry-id="${refocus.current}"]`);
      if (item && document.activeElement !== item) item.focus();
      refocus.current = null;
    }
  }, [view]);

  const move = async (entry: QueueEntryView, delta: number): Promise<void> => {
    try {
      await api('PUT', `${base}/queue/${entry.id}/position`, { position: (entry.position ?? 1) + delta });
      refocus.current = entry.id;
      await load();
    } catch (error) {
      if (!refuse(error)) throw error;
    }
  };

  if (missing) return <NotFound />;
  const home = `/${org}/${repo}`;
  const entries = view?.entries ?? [];
  const stage = !view ? (
    <Loading />
  ) : (
    <div className="queue-stage">
      {entries.length ? (
        <ul className="queue-entries" aria-label="Queue entries" ref={listRef}>
          {entries.map((entry, index) => (
            <li
              key={entry.id}
              className="queue-entry"
              tabIndex={0}
              data-queue-entry-id={entry.id}
              data-state={entry.state}
              data-position={entry.position ?? ''}
              data-change-number={entry.change}
              data-anim="none"
              onKeyDown={(event) => {
                if (!view.can_reorder || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                event.preventDefault();
                const delta = event.key === 'ArrowUp' ? -1 : 1;
                if (index + delta >= 0 && index + delta < entries.length) void move(entry, delta);
              }}
            >
              <div className="entry-head">
                <Link href={`${home}/changes/${entry.change}`} className="entry-title">#{entry.change} {entry.title}</Link>
                <span className="entry-state">{STATE_WORD[entry.state]}</span>
              </div>
              <p className="entry-facts">
                <span>Position {entry.position}</span>
                <span>Queue revision <code className="mono">{entry.revision}</code></span>
              </p>
              <Checks checks={entry.checks} />
              {view.can_reorder ? (
                <div className="entry-actions">
                  <Button disabled={index === 0} onClick={() => void move(entry, -1)}>Move up</Button>
                  <Button disabled={index === entries.length - 1} onClick={() => void move(entry, 1)}>Move down</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty"><p>The merge queue is empty.</p><Link href={`${home}/changes`} className="plain-arrow">Back to changes →</Link></div>
      )}
      <h2 className="section-title">History</h2>
      <table className="history" aria-label="Queue history">
        <thead>
          <tr><th scope="col">Change</th><th scope="col">Result</th><th scope="col">Time</th><th scope="col">Reason</th></tr>
        </thead>
        <tbody>
          {view.history.map((entry) => (
            <tr key={entry.id} data-queue-entry-id={entry.id} data-state={entry.state} data-position="" data-change-number={entry.change} data-anim="none">
              <td><Link href={`${home}/changes/${entry.change}`}>#{entry.change} {entry.title}</Link></td>
              <td>{STATE_WORD[entry.state]}</td>
              <td>{entry.finished_at ? <Time value={entry.finished_at} /> : null}</td>
              <td>{entry.reason ?? ''}</td>
            </tr>
          ))}
          {view.history.length === 0 ? <tr><td colSpan={4} className="muted">Merged and removed entries appear here.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
  const rail = (
    <div className="bento">
      <h2>Merge rules</h2>
      <p className="muted">Each entry is checked on its own queue revision: the base head, the entries ahead of it, and itself.</p>
      {rules ? (
        <ul className="chips">
          <li className="chip">Approvals: {rules.required_approvals} required</li>
          <li className="chip">Required checks: {rules.required_checks.length ? rules.required_checks.join(', ') : 'none'}</li>
        </ul>
      ) : null}
      <p className="card-links"><Link href={`${home}/settings`} className="arrow-link">Settings</Link></p>
    </div>
  );
  return (
    <Screen>
      <header className="repo-head">
        <p className="crumbs"><Link href={home}>{org}/{repo}</Link></p>
        <h1 className="page-title">Merge queue</h1>
      </header>
      <TwoPane stage={stage} rail={rail} />
      <ReviewUpdates lines={lines} />
    </Screen>
  );
}
