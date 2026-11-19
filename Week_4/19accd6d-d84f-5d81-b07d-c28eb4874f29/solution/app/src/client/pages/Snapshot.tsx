import { Download } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Snapshot } from "../../shared/api";
import { failureLine } from "../../shared/bake-protocol";
import type { BakeMessage, StartBake } from "../../shared/bake-protocol";
import { operationDefinition } from "../../shared/operations/catalogue";
import { decodeUtf8Lenient } from "../../shared/bytes";
import { api, apiBytes } from "../api";
import { downloadBytes } from "../download";
import { BADGES, snapshotLine } from "../snapshotLine";
import { IconButton, TitleBar } from "../ui/Pane";

const POLL_MS = 60_000;

/** Bakes the stored steps over the stored input in the page's own worker. */
function useStoredOutput(snapshot: Snapshot | null, input: Uint8Array | null): string | null {
  const [output, setOutput] = useState<string | null>(null);
  useEffect(() => {
    if (!snapshot?.recipe || !input) return;
    const steps = snapshot.recipe.steps;
    const worker = new Worker("/assets/bake-worker.js");
    worker.onmessage = (event: MessageEvent<BakeMessage>) => {
      if (event.data.kind !== "result") return;
      const { outcome } = event.data;
      setOutput(outcome.failure ? failureLine(outcome.failure, steps) : decodeUtf8Lenient(outcome.output));
      worker.terminate();
    };
    const start: StartBake = { kind: "start", id: 1, input, steps: steps.map((step) => ({ ...step, breakpoint: false })), mode: "run" };
    worker.postMessage(start);
    return () => worker.terminate();
  }, [snapshot?.recipe, input]);
  return output;
}

export function SnapshotPage({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [missing, setMissing] = useState(false);
  const [input, setInput] = useState<Uint8Array | null>(null);
  const loaded = useRef(false);

  const refresh = useCallback(async (): Promise<Snapshot | null> => {
    try {
      const answer = await api<{ snapshot: Snapshot }>("GET", `/api/snapshots/${token}`);
      setSnapshot(answer.snapshot);
      return answer.snapshot;
    } catch {
      setMissing(true);
      return null;
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(poll);
  }, [refresh]);

  const active = snapshot?.status === "active";
  useEffect(() => {
    if (!active || loaded.current) return;
    loaded.current = true;
    void apiBytes(`/api/snapshots/${token}/input`).then((file) => setInput(file.bytes), () => { loaded.current = false; });
  }, [active, token]);

  const output = useStoredOutput(snapshot, input);
  const inputText = useMemo(() => (input ? decodeUtf8Lenient(input) : ""), [input]);

  const download = async (part: "input" | "output"): Promise<void> => {
    const current = await refresh();
    if (current?.status !== "active") return;
    const file = await apiBytes(`/api/snapshots/${token}/${part}`);
    downloadBytes(file.bytes, file.filename);
  };

  return (
    <main className="screen snapshot-screen">
      <header className="snapshot-head">
        <h1 className="screen-heading">Shared snapshot</h1>
        <div role="status" aria-label="Snapshot status" aria-live="polite" className="snapshot-status">
          {snapshot ? (
            <>
              <span className="badge" data-status={snapshot.status}>{BADGES[snapshot.status]}</span> <span>{snapshotLine(snapshot)}</span>
            </>
          ) : missing ? (
            "This snapshot does not exist."
          ) : (
            ""
          )}
        </div>
      </header>
      <div className="snapshot-panes">
        <section role="region" aria-label="Recipe" className="pane">
          <TitleBar title="Recipe" />
          <div className="pane-body">
            <ul role="list" aria-label="Recipe steps" className="steps readonly">
              {(snapshot?.recipe?.steps ?? []).map((step, index) => (
                <li key={index} className="step" aria-label={`Step ${index + 1}: ${step.op}`} data-disabled={step.disabled}>
                  <div className="step-head">
                    <span className="step-number" aria-hidden="true">{index + 1}</span>
                    <span className="step-name">{step.op}</span>
                  </div>
                  {operationDefinition(step.op).args.length > 0 && (
                    <p className="row-meta mono">
                      {operationDefinition(step.op).args.map((arg) => `${arg.label}: ${String(step.args[arg.key])}`).join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section role="region" aria-label="Input pane" className="pane">
          <TitleBar title="Input">
            <IconButton label="Download input" disabled={!active} onClick={() => void download("input")}>
              <Download size={22} aria-hidden="true" />
            </IconButton>
          </TitleBar>
          <div className="editor">
            <textarea aria-label="Input" className="mono" readOnly value={inputText} />
          </div>
          <div className="status-strip">{snapshot ? `${snapshot.inputBytes} bytes` : ""}</div>
        </section>
        <section role="region" aria-label="Output pane" className="pane">
          <TitleBar title="Output">
            <IconButton label="Download output" disabled={!active} onClick={() => void download("output")}>
              <Download size={22} aria-hidden="true" />
            </IconButton>
          </TitleBar>
          <div className="editor">
            <textarea aria-label="Output" className="mono" readOnly value={output ?? ""} />
          </div>
          <div className="status-strip">{snapshot ? `${snapshot.outputBytes} bytes` : ""}</div>
        </section>
      </div>
    </main>
  );
}
