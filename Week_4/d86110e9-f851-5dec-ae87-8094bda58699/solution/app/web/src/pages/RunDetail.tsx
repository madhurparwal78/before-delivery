import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiFailure, w } from '../api';
import { formatTime } from '../format';
import { Link, navigate, useTitle } from '../router';
import { useShell } from '../shell';
import { Button, Chip, Skeleton, useAccess, useWide } from '../ui';
import type { RunDetailView, RunStep, StreamEvent, WorkspaceInfo } from '../types';
import { Canvas, type CanvasNode } from '../studio/Canvas';
import { loopBodyIds } from '../studio/replay';
import { LogDialog } from '../studio/LogDialog';
import { StepList, type ListItem } from '../studio/StepList';
import { NotFound } from './NotFound';
import '../build/styles/studio.css';

const CANCELLABLE = ['queued', 'running', 'waiting'];

export function RunDetail({ workspace, runId }: { workspace: WorkspaceInfo; runId: string }) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const wide = useWide();
  const access = useAccess();
  const ws = workspace.id;
  const [run, setRun] = useState<RunDetailView | null>(null);
  const [missing, setMissing] = useState(false);
  const [log, setLog] = useState<{ id: string; opener: HTMLElement | null } | null>(null);
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState<'cancel' | 'replay' | null>(null);
  const [original, setOriginal] = useState<number | null>(null);
  const latest = useRef(0);
  const regionRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);

  useTitle(run ? `Run #${run.number} of ${run.automation_name}` : 'Run');

  const load = useCallback(async () => {
    const turn = ++latest.current;
    try {
      const next = await api.get<RunDetailView>(w(ws, `/runs/${runId}`));
      if (turn !== latest.current) return;
      shellRef.current.seedRuns([next]);
      setRun(next);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) setMissing(true);
      else throw error;
    }
  }, [ws, runId]);

  useEffect(() => {
    void load();
  }, [load, shell.epoch]);

  const { subscribe } = shell;
  useEffect(
    () =>
      subscribe((event: StreamEvent) => {
        if (event.type === 'run' && event.run.id === runId) void load();
      }),
    [subscribe, runId, load],
  );

  const replayOf = run?.replay_of ?? null;
  useEffect(() => {
    if (replayOf === null) return;
    void api.get<RunDetailView>(w(ws, `/runs/${replayOf}`)).then((found) => setOriginal(found.number));
  }, [ws, replayOf]);

  const replayable = useMemo(() => {
    if (!run || run.status !== 'failed') return [];
    const inLoop = loopBodyIds(run.edges, run.steps);
    const failedAt = run.steps.findIndex((step) => step.id === run.failed_step);
    return run.steps.filter((step, index) => {
      if (step.id === 'trigger') return true;
      if (inLoop.has(step.id)) return false;
      const executed = step.status !== 'skipped' && step.status !== 'pending';
      return executed && (failedAt === -1 || index <= failedAt);
    });
  }, [run]);

  useEffect(() => {
    if (replayable.length > 0 && !replayable.some((step) => step.id === from)) {
      setFrom(replayable.find((step) => step.id === run?.failed_step)?.id ?? 'trigger');
    }
  }, [replayable, from, run?.failed_step]);

  if (missing) return <NotFound />;
  if (!run) return <Skeleton rows={5} />;

  const cancel = async (): Promise<void> => {
    setBusy('cancel');
    try {
      setRun(await api.post<RunDetailView>(w(ws, `/runs/${runId}/cancel`)));
    } catch (error) {
      if (error instanceof ApiFailure) shell.say(error.message);
      else throw error;
    } finally {
      setBusy(null);
    }
  };

  const replay = async (): Promise<void> => {
    setBusy('replay');
    const here = `/w/${ws}/runs/${runId}`;
    window.history.replaceState(window.history.state, '', `${here}?replaying=1`);
    try {
      const result = await api.post<{ run_id: string }>(w(ws, `/runs/${runId}/replay`), { from_step: from });
      window.history.replaceState(window.history.state, '', here);
      navigate(`/w/${ws}/runs/${result.run_id}`);
    } catch (error) {
      window.history.replaceState(window.history.state, '', here);
      if (error instanceof ApiFailure) shell.say(error.message);
      else throw error;
    } finally {
      setBusy(null);
    }
  };

  const nodes: CanvasNode[] = run.steps.map((step) => ({ id: step.id, kind: step.kind, name: step.name, col: step.col, row: step.row, status: step.status, reused: step.reused }));
  const items: ListItem[] = nodes.map((node) => ({ ...node }));
  const open = (id: string, opener: HTMLElement | null): void => setLog({ id, opener });
  const shown: RunStep | undefined = log ? run.steps.find((step) => step.id === log.id) : undefined;
  const lock = access.locked();

  return (
    <div className="run-layout">
      <section
        aria-label="Run summary"
        className="run-summary panel-light"
        data-run-id={run.id}
        data-status={run.status}
        data-test={run.test ? 'true' : 'false'}
        data-version={run.version ?? ''}
        {...(run.replay_of ? { 'data-replay-of': run.replay_of } : {})}
      >
        <h1>{`Run #${run.number} of ${run.automation_name}`}</h1>
        <div className="summary-chips">
          <Chip status={run.status} />
          <span className="chip" data-chip="quiet">{run.version === null ? 'Draft' : `Version ${run.version}`}</span>
          {run.test ? <span className="chip" data-chip="quiet">Test</span> : null}
        </div>
        <p className="summary-time">{`Started ${formatTime(run.started_at)}`}</p>
        {run.finished_at ? <p className="summary-time">{`Finished ${formatTime(run.finished_at)}`}</p> : null}
        {run.message ? <p className="summary-message">{run.message}</p> : null}
        {run.replay_of ? (
          <p>
            <Link to={`/w/${ws}/runs/${run.replay_of}`}>{original === null ? 'Original run' : `Replay of run #${original}`}</Link>
          </p>
        ) : null}
        <div className="summary-actions">
          <Button variant="secondary" busy={busy === 'cancel'} disabled={!CANCELLABLE.includes(run.status) || lock.disabled} aria-describedby={lock['aria-describedby']} onClick={() => void cancel()}>
            Cancel run
          </Button>
          {run.status === 'failed' ? (
            <div className="replay">
              <label className="field">
                <span>Replay from</span>
                <select aria-label="Replay from" value={from} onChange={(event) => setFrom(event.target.value)} {...(lock.disabled ? { disabled: true, 'aria-describedby': lock['aria-describedby'] } : {})}>
                  {replayable.map((step) => (
                    <option key={step.id} value={step.id}>
                      {step.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button busy={busy === 'replay'} {...lock} onClick={() => void replay()}>
                Replay
              </Button>
            </div>
          ) : null}
        </div>
      </section>
      <div className="run-graph">
        {wide ? (
          <Canvas
            mode="run"
            nodes={nodes}
            edges={run.edges}
            regionRef={regionRef}
            worldRef={worldRef}
            onNodeClick={(node, element) => {
              element.focus();
              open(node.id, element);
            }}
          />
        ) : (
          <StepList items={items} onOpen={(item, element) => open(item.id, element)} />
        )}
      </div>
      {log && shown ? <LogDialog step={shown} returnTo={log.opener} onClose={() => setLog(null)} /> : null}
    </div>
  );
}
