// The evidence column for one stage: the shown promotion's paperwork and the actions the role allows.
import { Download, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import type { Bundle, DiffEntry, GraphNode, Promotion, Role, StageHealth } from "../shared/api";
import { clusterTime } from "../shared/zone";
import { download } from "./api";
import { useKeyedSubmit } from "./Dialog";
import { ApproveDialog, BreakFreezeDialog, PromoteDialog, RejectDialog, RollbackDialog } from "./dialogs";
import { activity, approvalLapsed, generalError, outcome, problem, useFeedback, verdict } from "./feedback";
import { PromotionMark, ResourceMark, stateLabel } from "./status";

const DEPLOYERS: readonly Role[] = ["service_developer", "platform_engineer"];

/** Text that may wrap only after a slash, dot or colon, never inside a name. */
function PathBreaks({ text }: { text: string }) {
  return <>{text.split(/(?<=[/.:])/).map((part, i) => <Fragment key={i}>{i > 0 && <wbr />}<span className="path-part">{part}</span></Fragment>)}</>;
}

/** The diff as one row per change; secret values arrive from the server already redacted. */
export function DiffList({ diff }: { diff: DiffEntry[] }) {
  return (
    <ul className="diff" aria-label="Changes">
      {diff.map((entry, i) => (
        <li key={`${entry.resource}-${entry.path}-${i}`} className={`diff-row change-${entry.change}`}>
          <span className="diff-change">{entry.change}</span>
          <span className="diff-target mono"><span><PathBreaks text={entry.resource} /></span>{entry.path && <span className="diff-path"><PathBreaks text={entry.path} /></span>}</span>
          {entry.path && (
            <dl className="diff-values mono">
              <div><dt>before</dt><dd>{JSON.stringify(entry.before)}</dd></div>
              <div><dt>after</dt><dd>{JSON.stringify(entry.after)}</dd></div>
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}

type DialogKind = "promote" | "approve" | "reject" | "break" | "rollback" | null;

export function EvidenceColumn({ project, role, node, shown, history, health, loading, bundles, onShow, onClose, onChanged }: {
  project: string; role: Role; node: GraphNode; shown: Promotion | null; history: Promotion[]; health: StageHealth | null;
  loading: boolean; bundles: Bundle[]; onShow: (id: string) => void; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const say = useFeedback();
  const heading = useRef<HTMLHeadingElement>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const action = useKeyedSubmit();
  useEffect(() => heading.current?.focus(), [node.stage]);

  const zone = node.time_zone;
  const deployer = DEPLOYERS.includes(role);
  const active = node.active_promotion;
  const target = history.find((p) => p.state === "healthy" && p.id !== node.current?.promotion_id);
  const state = shown?.state;
  const closeDialog = () => setDialog(null);
  const finished = async () => {
    await onChanged();
    setDialog(null);
  };

  const run = async (path: "start" | "retry-window", pending: string) => {
    if (!shown) return;
    say(activity(pending));
    await action.submit<Promotion>(`/api/promotions/${shown.id}/${path}`, {}, async (result) => {
      await onChanged();
      if (result.ok) {
        say(activity(outcome(result.data, `Started. Applying ${result.data.bundle.version} to ${result.data.stage}.`)));
      } else if (result.error?.error === "approval_expired" || (result.error?.error === "invalid_transition" && result.error.state === "expired")) {
        say(problem(approvalLapsed(shown)));
      } else {
        say(problem(generalError(result)));
      }
    });
  };

  const fetchEvidence = async () => {
    if (!shown) return;
    say(activity("Preparing evidence…"));
    const result = await download(`/api/promotions/${shown.id}/evidence`);
    if (result.ok) say(activity("Evidence downloaded."));
    else if (result.error?.error === "evidence_pending") say(problem("No evidence snapshot is stored yet. It will be saved when storage returns."));
    else if (result.error?.error === "storage_unavailable") say(problem("Evidence storage is unreachable. Try the download again when it returns."));
    else say(problem(generalError(result)));
  };

  const ownRows = shown?.counter && health?.revision === shown.id;
  const liveCaption = shown && !shown.counter && node.current ? `Live revision ${node.current.short_digest}` : null;

  return (
    <aside className="evidence" aria-label={`Evidence for ${node.stage}`}>
      <div className="evidence-top">
        <button type="button" className="button quiet close" onClick={onClose}>
          <X aria-hidden="true" size={16} /> Close
        </button>
      </div>
      <header className="evidence-header">
        <h2 ref={heading} tabIndex={-1} className="evidence-title">{node.stage}</h2>
        {shown && !loading ? (
          <p className="evidence-meta">
            <span className="mono">{shown.bundle.version}</span>
            <span className="mono">{shown.bundle.short_digest}</span>
            <span className="state-chip"><PromotionMark state={shown.state} /></span>
            <span>{shown.kind === "rollback" ? "Rollback requested by " : "Requested by "}{shown.requested_by.name}</span>
          </p>
        ) : <p className="evidence-meta">{loading ? "Loading…" : "Nothing deployed yet."}</p>}
      </header>

      {/* Nothing below the header is drawn until the column's own data has arrived, so no section is inserted above another. */}
      {!loading && <>
        <div className="evidence-actions">
          {deployer && !active && <button type="button" className="button primary" onClick={() => setDialog("promote")}>Promote</button>}
          {role === "release_manager" && state === "awaiting_approval" && <>
            <button type="button" className="button primary" onClick={() => setDialog("approve")}>Approve</button>
            <button type="button" className="button danger" onClick={() => setDialog("reject")}>Reject</button>
          </>}
          {deployer && state === "approved" && (
            <button type="button" className="button primary" disabled={action.busy} onClick={() => void run("start", "Starting…")}>Start promotion</button>
          )}
          {deployer && state === "window_blocked" && (
            <button type="button" className="button" disabled={action.busy} onClick={() => void run("retry-window", "Checking the window…")}>Re-check window</button>
          )}
          {role === "oncall_sre" && state === "window_blocked" && (
            <button type="button" className="button danger" onClick={() => setDialog("break")}>Break freeze</button>
          )}
          {role === "oncall_sre" && !active && target && (
            <button type="button" className="button danger" onClick={() => setDialog("rollback")}>Roll back</button>
          )}
          {shown && <button type="button" className="button" onClick={() => void fetchEvidence()}>
            <Download aria-hidden="true" size={16} /> Download evidence
          </button>}
        </div>

        {shown && <>
          <section className="evidence-section">
            <h3>Diff</h3>
            {shown.diff.length === 0 ? <p className="muted">No changes against the live revision.</p> : <DiffList diff={shown.diff} />}
          </section>

          <section className="evidence-section">
            <h3>Approvals</h3>
            {!shown.approval ? <p className="muted">{shown.kind === "rollback" ? "Rollbacks need no approval." : "This stage needs no approval."}</p> : (
              <dl className="facts">
                <div><dt>Decision</dt><dd>{stateLabel(shown.approval.state === "pending" ? "awaiting_approval" : shown.approval.state)}</dd></div>
                <div><dt>By</dt><dd>{shown.approval.decided_by?.name ?? "Not decided yet"}</dd></div>
                <div className="fact-time"><dt>When</dt><dd className="mono">{shown.approval.decided_at ? clusterTime(shown.approval.decided_at, zone) : "Pending"}</dd></div>
                <div className="fact-time"><dt>Request expires</dt><dd className="mono">{clusterTime(shown.approval.request_expires_at, zone)}</dd></div>
                {shown.approval.expires_at && <div className="fact-time"><dt>Approval expires</dt><dd className="mono">{clusterTime(shown.approval.expires_at, zone)}</dd></div>}
                {shown.approval.comment && <div><dt>Note</dt><dd>{shown.approval.comment}</dd></div>}
              </dl>
            )}
          </section>

          <section className="evidence-section">
            <h3>Window decision</h3>
            {!shown.window_decision ? (
              <>
                <p>Not checked yet. The window is checked when the promotion starts.</p>
                <p className="mono muted">{`Policy version ${shown.policy_version}`}</p>
              </>
            ) : (
              <dl className="facts">
                <div><dt>Result</dt><dd>{verdict(shown.window_decision, "this cluster has no sync windows")}</dd></div>
                <div className="fact-time"><dt>Local time</dt><dd className="mono">{`${shown.window_decision.local_time} ${zone}`}</dd></div>
                <div><dt>Policy version</dt><dd className="mono">{shown.window_decision.policy_version}</dd></div>
                {shown.freeze_break && (
                  <div><dt>Freeze broken</dt><dd>{`${shown.freeze_break.by}, ${clusterTime(shown.freeze_break.at, zone)}: ${shown.freeze_break.reason}`}</dd></div>
                )}
              </dl>
            )}
          </section>
        </>}

        <section className="evidence-section">
          <h3>Health</h3>
          {!health?.revision ? <p className="muted">Nothing deployed yet.</p> : shown?.counter && !ownRows ? (
            <p className="muted">This promotion is no longer the live revision; its health timeline is in the evidence download.</p>
          ) : (
            <table className="health" aria-label="Resource health">
              {liveCaption && <caption className="mono">{liveCaption}</caption>}
              <thead><tr><th scope="col">Resource</th><th scope="col">Sync</th><th scope="col">Health</th></tr></thead>
              <tbody>
                {health.resources.map((row) => (
                  <tr key={row.ref}>
                    <td className="mono"><PathBreaks text={row.ref} /></td>
                    <td><ResourceMark value={row.sync} /></td>
                    <td><ResourceMark value={row.health} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {shown && (
          <section className="evidence-section">
            <h3>History</h3>
            <ol className="history">
              {shown.history.map((h, i) => (
                <li key={`${h.to}-${i}`}>
                  <span>{h.from ? `${stateLabel(h.from)} to ${stateLabel(h.to).toLowerCase()}` : stateLabel(h.to)}</span>
                  <span className="mono">{clusterTime(h.at, zone)}</span>
                  <span className="muted">{h.by}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="evidence-section">
          <h3>Promotions into {node.stage}</h3>
          <ul className="promotion-list">
            {history.map((p) => (
              <li key={p.id}>
                <button type="button" className={`promotion-item${p.id === shown?.id ? " is-shown" : ""}`} aria-current={p.id === shown?.id ? "true" : undefined}
                  onClick={() => onShow(p.id)}>
                  <span className="mono">{`${p.bundle.version} · ${p.bundle.short_digest}`}</span>
                  <span>{stateLabel(p.state)}{p.kind === "rollback" ? " (rollback)" : ""}</span>
                  <span className="mono muted">{clusterTime(p.requested_at, zone)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </>}

      {dialog === "promote" && <PromoteDialog project={project} node={node} bundles={bundles} onClose={closeDialog} onDone={finished} />}
      {dialog === "approve" && shown && <ApproveDialog project={project} promotion={shown} stage={node.stage}
        title={`Approve ${shown.bundle.version} to ${node.stage}`} onClose={closeDialog} onDone={finished} />}
      {dialog === "reject" && shown && <RejectDialog project={project} promotion={shown} stage={node.stage}
        title={`Reject ${shown.bundle.version} to ${node.stage}`} onClose={closeDialog} onDone={finished} />}
      {dialog === "break" && shown && <BreakFreezeDialog project={project} promotion={shown} stage={node.stage}
        title={`Break freeze on ${node.stage}`} onClose={closeDialog} onDone={finished} />}
      {dialog === "rollback" && target && <RollbackDialog project={project} promotion={null} stage={node.stage}
        restores={{ version: target.bundle.version, short: target.bundle.short_digest }}
        title={`Roll back ${node.stage}`} onClose={closeDialog} onDone={finished} />}
    </aside>
  );
}
