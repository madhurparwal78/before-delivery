import { useEffect, useMemo, useRef, useState } from 'react';
import { api, w } from '../api';
import { formatTime } from '../format';
import { Link, useSearch, useTitle } from '../router';
import { useShell } from '../shell';
import { Chip, EmptyState, Skeleton, useWide } from '../ui';
import type { AutomationItem, RunItem, StreamEvent, WorkspaceInfo } from '../types';
import '../build/styles/runs.css';

const STATUSES = ['queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled'] as const;
const LIMIT = 100;

interface Filters {
  status: string;
  automation: string;
  test: boolean;
}

function matches(run: RunItem, filters: Filters): boolean {
  return (filters.status === '' || run.status === filters.status) && (filters.automation === '' || run.automation_id === filters.automation) && (filters.test || !run.test);
}

/** Newest first: by start time, then run number. */
function newestFirst(a: RunItem, b: RunItem): number {
  return b.started_at.localeCompare(a.started_at) || b.number - a.number;
}

function upsert(list: RunItem[], run: RunItem, filters: Filters): RunItem[] {
  const rest = list.filter((entry) => entry.id !== run.id);
  return matches(run, filters) ? [...rest, run].sort(newestFirst).slice(0, LIMIT) : rest;
}

function query(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.automation) params.set('automation', filters.automation);
  if (filters.test) params.set('test', 'true');
  return params.toString();
}

export function Runs({ workspace }: { workspace: WorkspaceInfo }) {
  useTitle('Runs');
  const { subscribe, epoch, seedRuns } = useShell();
  const wide = useWide();
  const search = useSearch();
  const [filters, setFilters] = useState<Filters>(() => {
    const params = new URLSearchParams(search);
    return { status: params.get('status') ?? '', automation: params.get('automation') ?? '', test: params.get('test') === 'true' };
  });
  const [runs, setRuns] = useState<RunItem[] | null>(null);
  const [automations, setAutomations] = useState<AutomationItem[]>([]);
  const loading = useRef(false);
  const buffered = useRef<RunItem[]>([]);
  const current = useRef(filters);
  current.current = filters;

  useEffect(() => {
    void api.get<{ automations: AutomationItem[] }>(w(workspace.id, '/automations')).then((found) => setAutomations(found.automations));
  }, [workspace.id, epoch]);

  useEffect(() => {
    let live = true;
    loading.current = true;
    buffered.current = [];
    const text = query(filters);
    window.history.replaceState(null, '', text === '' ? window.location.pathname : `?${text}`);
    void api.get<{ runs: RunItem[] }>(`${w(workspace.id, '/runs')}${text === '' ? '' : `?${text}`}`).then((found) => {
      if (!live) return;
      seedRuns(found.runs);
      loading.current = false;
      setRuns(buffered.current.reduce((list, run) => upsert(list, run, filters), found.runs));
    });
    return () => {
      live = false;
    };
  }, [workspace.id, filters, epoch, seedRuns]);

  useEffect(
    () =>
      subscribe((event: StreamEvent) => {
        if (event.type !== 'run') return;
        if (loading.current) buffered.current.push(event.run);
        else setRuns((list) => (list === null ? list : upsert(list, event.run, current.current)));
      }),
    [subscribe],
  );

  const names = useMemo(() => new Map(automations.map((automation) => [automation.id, automation.name])), [automations]);
  const shown = runs?.length ?? 0;

  return (
    <>
      <div className="page-head">
        <h1>Runs</h1>
      </div>
      <div className={`filter-row${wide ? '' : ' stacked'}`}>
        <div className="field">
          <label htmlFor="filter-status">Status</label>
          <select id="filter-status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="">All</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-automation">Automation</label>
          <select id="filter-automation" value={filters.automation} onChange={(event) => setFilters({ ...filters, automation: event.target.value })}>
            <option value="">All automations</option>
            {automations.map((automation) => (
              <option key={automation.id} value={automation.id}>
                {automation.name}
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={filters.test} onChange={(event) => setFilters({ ...filters, test: event.target.checked })} />
          Show test runs
        </label>
      </div>
      <div role="status" aria-label="Run list results" className="results-line">
        {runs === null ? '' : `Runs shown: ${shown}`}
      </div>
      {runs === null ? (
        <Skeleton rows={4} />
      ) : runs.length === 0 ? (
        <EmptyState>No runs match these filters yet.</EmptyState>
      ) : (
        <ul aria-label="Runs" className="run-list">
          {runs.map((run) => (
            <li
              key={run.id}
              className="run-row"
              data-run-id={run.id}
              data-status={run.status}
              data-test={run.test ? 'true' : 'false'}
              data-version={run.version ?? ''}
              data-replay-of={run.replay_of ?? undefined}
            >
              <Link className="run-link" to={`/w/${workspace.id}/runs/${run.id}`}>
                Run #{run.number} of {run.automation_name || names.get(run.automation_id)}
              </Link>
              <div className="run-meta">
                <Chip status={run.status} />
                {run.test ? <Chip status="test">Test</Chip> : null}
                <span>Started {formatTime(run.started_at)}</span>
                <span>{run.version === null ? 'Draft' : `Version ${run.version}`}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
