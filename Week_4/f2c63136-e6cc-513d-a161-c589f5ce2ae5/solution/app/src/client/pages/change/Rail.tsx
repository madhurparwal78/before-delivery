import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError, refuse } from '../../api.ts';
import { Link } from '../../router.tsx';
import { actionStatus } from '../../store.ts';
import { Button, Field, Icon, StatusWord, Time } from '../../ui.tsx';
import type { ChangeView, RestackResult, RestackResultKind, ReviewView, StackRow } from '../../../shared/types.ts';

const base = (view: ChangeView) => `/api/repos/${view.repo.org}/${view.repo.name}/changes/${view.change.number}`;
const MAX_WALK = 8;

export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function wordOf(result: RestackResultKind, count: number): string {
  if (result === 'kept') return 'Approvals kept';
  if (result === 'dismissed') return `Approvals dismissed (${count})`;
  if (result === 'conflicting') return `Conflicts in ${count} files`;
  return 'Not restacked';
}

type Shown = Record<number, { result: RestackResultKind | null; count: number }>;

const fromRows = (rows: StackRow[]): Shown => Object.fromEntries(rows.map((row) => [row.number, { result: row.restack.result, count: row.restack.dismissed_count }]));

/** The lowest change that needs action (dismissed or conflicting), or null. */
const needsAction = (rows: StackRow[], shown: Shown): number | null => rows.find((row) => ['dismissed', 'conflicting'].includes(shown[row.number]?.result ?? ''))?.number ?? null;

/**
 * The stack rail. A restack event walks up from the row above the updated change: each row expands
 * over half a second (data-anim "walking") and settles with its result word. The walk advances on
 * animationend, never on a timer.
 */
export function StackRail({ org, repo, rows, events }: { org: string; repo: string; rows: StackRow[]; events: RestackResult[][] }) {
  const [shown, setShown] = useState<Shown>(() => fromRows(rows));
  const [walking, setWalking] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(() => needsAction(rows, fromRows(rows)));
  const queue = useRef<RestackResult[][]>([]);
  const consumed = useRef(events.length);
  const active = useRef<{ list: RestackResult[]; index: number } | null>(null);
  const element = useRef<HTMLUListElement>(null);

  const finish = () => {
    active.current = null;
    setWalking(null);
    if (queue.current.length) begin(queue.current.shift()!);
  };

  const settle = (list: RestackResult[], index: number) => {
    const item = list[index];
    setShown((current) => ({ ...current, [item.number]: { result: item.result, count: item.dismissed_count } }));
  };

  const step = (list: RestackResult[], index: number): void => {
    for (let i = index; i < list.length; i += 1) {
      const item = list[i];
      if (prefersReducedMotion() || item.result === 'not_restacked' || i >= MAX_WALK) {
        settle(list, i);
        continue;
      }
      active.current = { list, index: i };
      setExpanded(item.number);
      setWalking(item.number);
      return;
    }
    finish();
  };

  const begin = (list: RestackResult[]) => {
    setShown((current) => {
      const next = { ...current };
      for (const item of list) next[item.number] = { result: null, count: 0 };
      return next;
    });
    step(list, 0);
  };

  useLayoutEffect(() => {
    while (consumed.current < events.length) {
      const event = events[consumed.current];
      consumed.current += 1;
      if (active.current) queue.current.push(event);
      else begin(event);
    }
  }, [events.length]);

  // Rows from the server replace what is shown whenever no walk is running.
  useLayoutEffect(() => {
    if (active.current || queue.current.length) return;
    setShown(fromRows(rows));
  }, [rows]);

  // At rest the rail stays on the lowest change that needs action.
  useLayoutEffect(() => {
    if (active.current || queue.current.length) return;
    setExpanded(needsAction(rows, shown));
  }, [shown, walking, rows]);

  // A walking row that does not animate (no animation support) still moves on.
  useLayoutEffect(() => {
    if (walking === null) return;
    const row = element.current?.querySelector<HTMLElement>(`[data-change-number="${walking}"]`);
    if (row && !row.getAnimations().some((animation) => (animation as CSSAnimation).animationName === 'rail-expand')) onWalked();
  }, [walking]);

  const onWalked = () => {
    const current = active.current;
    if (!current) return;
    settle(current.list, current.index);
    setWalking(null);
    step(current.list, current.index + 1);
  };

  const move = (event: KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const links = [...element.current!.querySelectorAll<HTMLAnchorElement>('a.rail-link')];
    const target = links[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (target) {
      event.preventDefault();
      event.stopPropagation();
      target.focus();
    }
  };

  return (
    <ul className="stack-rail" aria-label="Stack" ref={element}>
      {rows.map((row, index) => {
        const display = shown[row.number];
        const isExpanded = expanded === row.number || walking === row.number;
        return (
          <li
            key={row.number}
            className={`rail-row ${isExpanded ? 'expanded' : ''} ${display?.result ? `result-${display.result}` : ''}`}
            data-change-number={row.number}
            data-stack-position={row.position}
            data-restack={display?.result ?? ''}
            data-anim={walking === row.number ? 'walking' : 'none'}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget && (event as AnimationEvent).animationName === 'rail-expand') onWalked();
            }}
          >
            <Link href={`/${org}/${repo}/changes/${row.number}`} className="rail-link" onKeyDown={(event) => move(event, index)}>
              #{row.number} {row.title}
            </Link>
            <div className="rail-meta">
              <StatusWord state={row.state} />
              {display?.result ? <span className="rail-word">{wordOf(display.result, display.count)}</span> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---- merge box ----

export function MergeBox({ view, refresh }: { view: ChangeView; refresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const { change, repo, viewer } = view;
  const met = change.merge_rules.length === 1 && change.merge_rules[0].rule === 'met';
  const run = async (pending: string, call: () => Promise<string>) => {
    setBusy(pending);
    actionStatus.set('Working...');
    try {
      actionStatus.set(await call());
      refresh();
    } catch (failure) {
      actionStatus.set('');
      if (!refuse(failure)) throw failure;
    } finally {
      setBusy(null);
    }
  };
  const reason = change.state === 'removed' ? change.queue_entry?.reason : null;
  return (
    <section className="merge-box card" aria-label="Merge box">
      {change.state === 'merged' && view.merged_into ? (
        <p className="merge-status">Merged into {view.merged_into.branch} as <code>{view.merged_into.revision}</code></p>
      ) : change.state === 'queued' ? (
        <p className="merge-status">In the merge queue, position {view.queue_position}</p>
      ) : (
        <>
          {reason ? <p className="merge-reason">{reason}</p> : null}
          <ul aria-label="Merge rules" className="rules">
            {change.merge_rules.map((rule) => (
              <li key={rule.rule} data-rule={rule.rule}>{rule.text}</li>
            ))}
          </ul>
          <div className="merge-actions">
            {change.state === 'draft' ? (
              <Button
                busy={busy === 'ready'}
                disabled={!viewer.can_write}
                onClick={() => run('ready', async () => { await api('PUT', `${base(view)}/ready`); return 'Marked ready for review.'; })}
              >
                Mark ready for review
              </Button>
            ) : null}
            {repo.queue ? (
              <Button kind="glow" busy={busy === 'queue'} disabled={!met || !viewer.can_write} onClick={() => run('queue', async () => { const entry = await api<{ position: number | null }>('POST', `${base(view)}/queue`); return `Added to the merge queue at position ${entry.position}.`; })}>
                Add to merge queue
              </Button>
            ) : (
              <Button kind="glow" busy={busy === 'merge'} disabled={!met || !viewer.can_write} onClick={() => run('merge', async () => { await api('POST', `${base(view)}/merge`); return `Change #${change.number} merged.`; })}>
                Merge change
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function ChecksPanel({ view }: { view: ChangeView }) {
  return (
    <section className="cp-checks card raised" aria-labelledby="checks-title">
      <h2 id="checks-title">Checks</h2>
      {view.checks.length ? (
        <ul aria-label="Checks" className="cp-check-list">
          {view.checks.map((check) => (
            <li key={check.name} data-check-name={check.name} data-state={check.state} className={`cp-check-row cp-check-${check.state}`}>
              <span className="cp-check-name mono">{check.name}</span>
              <span className="cp-check-word">
                <Icon name={check.state === 'success' ? 'check' : check.state === 'failure' || check.state === 'timed_out' ? 'x' : check.state === 'in_progress' ? 'spinner' : 'clock'} size={14} />
                {check.word}
              </span>
              {check.summary ? <span className="cp-check-summary">{check.summary}</span> : null}
              {check.timeout_at ? <span className="cp-check-timeout">Times out at <Time value={check.timeout_at} /></span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No checks reported yet.</p>
      )}
    </section>
  );
}

export function Reviewers({ view, refresh }: { view: ChangeView; refresh: () => Promise<ChangeView | null> }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    actionStatus.set('Working...');
    try {
      await api('POST', `${base(view)}/review-requests`, { username });
      const fresh = await refresh();
      const name = fresh?.requested.find((entry) => entry.username === username)?.name ?? username;
      actionStatus.set(`Review requested from ${name}.`);
      setUsername('');
    } catch (failure) {
      actionStatus.set('');
      if (failure instanceof ApiError && failure.status === 404) setError(`${username} was not found`);
      else if (!refuse(failure)) throw failure;
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="reviewers card" aria-labelledby="reviewers-title">
      <h2 id="reviewers-title">Reviewers</h2>
      <ul aria-label="Requested reviewers" className="requested">
        {view.requested.map((entry) => <li key={entry.username}>{entry.name} <span className="muted">@{entry.username}</span></li>)}
      </ul>
      {view.viewer.can_write ? (
        <form onSubmit={submit} className="request-form">
          <Field label="Reviewer username" error={error}>
            <input type="text" value={username} autoComplete="off" onInput={(event) => setUsername(event.currentTarget.value)} />
          </Field>
          <Button type="submit" busy={busy}>Request review</Button>
        </form>
      ) : null}
    </section>
  );
}

export function Reviews({ view, onDismiss }: { view: ChangeView; onDismiss: (review: ReviewView, opener: HTMLElement) => void }) {
  if (!view.reviews.length) return null;
  return (
    <section className="reviews card" aria-labelledby="reviews-title">
      <h2 id="reviews-title">Reviews</h2>
      <ul aria-label="Reviews" className="review-list">
        {view.reviews.map((review) => (
          <li key={review.id} data-review-id={review.id} data-state={review.state} className={`review review-${review.state}`}>
            <div className="review-head">
              <strong>{review.reviewer_name}</strong>
              <span className="review-word">{{ commented: 'Commented', approved: 'Approved', changes_requested: 'Requested changes', dismissed: 'Dismissed' }[review.state]}</span>
              <Time value={review.created_at} />
            </div>
            {review.summary ? <p className="review-summary">{review.summary}</p> : null}
            {review.dismissed_text ? <p className="review-dismissed">{review.dismissed_text}</p> : null}
            {view.viewer.can_maintain && review.type !== 'comment' && review.state !== 'dismissed' ? (
              <Button kind="secondary" onClick={(event) => onDismiss(review, event.currentTarget)}>Dismiss review</Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Notices({ view }: { view: ChangeView }) {
  if (!view.notice) return null;
  return (
    <section aria-label="Change notices" className="notices">
      <ul>
        <li data-notice={view.notice.kind}>{view.notice.text}</li>
      </ul>
    </section>
  );
}
