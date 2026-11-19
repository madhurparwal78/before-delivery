import { useState } from "react";
import { failureText, get, post } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { useTopics } from "../../lib/live.js";
import { Link } from "../../lib/router.js";
import { useSession } from "../../lib/session.js";
import { Button, loadingScreen, Page, Rest, StatusBlock, useLoad } from "../../lib/ui.js";

interface RunStep {
  id: string;
  name: string;
  status: string;
  error: string | null;
  simulated?: boolean;
}

interface Run {
  id: number;
  workflow: string;
  version: number;
  record: string | null;
  status: string;
  steps: RunStep[];
}

const STEP_LABELS: Record<string, string> = { waiting: "Waiting", running: "Running", done: "Done", skipped: "Skipped", failed: "Failed", handled: "Handled" };
const RUN_LABELS: Record<string, string> = { running: "Running", waiting: "Waiting", done: "Done", failed: "Failed" };

export function RunView({ id }: { id: string }): JSX.Element {
  const session = useSession();
  const announce = useAnnounce();
  const { state, reload } = useLoad(async () => (await get<{ run: Run }>(`/api/runs/${encodeURIComponent(id)}`)).run, [id, session.workspace, session.accessVersion]);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useTopics([`run:${id}`], () => reload());

  const pending = loadingScreen(state, "run", reload);
  if (pending || state.status !== "ready") return pending ?? <></>;
  const run = state.data;

  const retry = async (step: RunStep): Promise<void> => {
    setRetrying(step.id);
    setFailure(null);
    try {
      await post(`/api/runs/${run.id}/retry`);
      reload();
    } catch (error) {
      const message = failureText(error);
      setFailure(message);
      announce(message);
    }
    setRetrying(null);
  };

  return (
    <Page subject={`${run.workflow} v${run.version}`} wide>
      <Rest>
        <div className="run-meta">
          <StatusBlock>{RUN_LABELS[run.status] ?? run.status}</StatusBlock>
          {run.record ? (
            <p>
              Record <Link to={`/desk/records/${run.record}`}>{run.record}</Link>
            </p>
          ) : null}
        </div>
        {failure ? <p className="form-error">{failure}</p> : null}
        <ul role="list" aria-label="Run steps" className="run-steps">
          {run.steps.map((step) => {
            const label = STEP_LABELS[step.status] ?? step.status;
            return (
              <li key={step.id} aria-label={`${step.name}: ${label}`} className="run-step">
                <div className="run-step-head">
                  <span className="run-step-name">{step.name}</span>
                  <StatusBlock outlined={step.status === "waiting" || step.status === "skipped"}>{label}</StatusBlock>
                  {step.simulated ? <StatusBlock outlined>Simulated</StatusBlock> : null}
                </div>
                {step.error ? <p className="form-error">{step.error}</p> : null}
                {session.isOperator && step.status === "failed" ? (
                  <Button variant="outline" busy={retrying === step.id} disabled={retrying !== null} onClick={() => void retry(step)}>
                    Retry {step.name}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {run.steps.length === 0 ? <p className="muted">This run has not started any step yet.</p> : null}
      </Rest>
    </Page>
  );
}
