// The workspace's confirm dialogs (brief: Public screens and controls, Feedback states).
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import type { Bundle, GraphNode, Overrides, Promotion } from "../shared/api";
import { clusterTime } from "../shared/zone";
import type { Result } from "./api";
import { Dialog, FieldError, useKeyedSubmit } from "./Dialog";
import { activity, approvalLapsed, generalError, holderCopy, outcome, problem, requestLapsed, useFeedback } from "./feedback";

type Done = () => void;
type Refresh = () => Promise<void>;

function useOutcome(onDone: Refresh) {
  const say = useFeedback();
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  return {
    error, fields,
    begin(text: string) {
      setError("");
      say(activity(text));
    },
    async succeed(text: string) {
      await onDone();
      say(activity(text));
    },
    fail(text: string, fieldErrors: Record<string, string> = {}) {
      setError(text);
      setFields(fieldErrors);
      say(problem(text));
    },
  };
}


export function PromoteDialog({ project, node, bundles, onClose, onDone }: {
  project: string; node: GraphNode; bundles: Bundle[]; onClose: Done; onDone: Refresh;
}) {
  const options = bundles.filter((b) => !node.upstream || b.verified_in.includes(node.upstream));
  const label = (b: Bundle) => `${b.version} · ${b.short_digest}`;
  const [picked, setChoice] = useState("");
  const chosen = options.find((b) => label(b) === picked) ?? options[0];
  const choice = chosen ? label(chosen) : "";
  const { busy, submit } = useKeyedSubmit();
  const state = useOutcome(onDone);
  const fieldId = useId();
  const refs = new Set(chosen?.resources.map((r) => r.ref) ?? []);
  const frozen: Overrides = {
    parameters: node.defaults.parameters,
    replicas: Object.fromEntries(Object.entries(node.defaults.replicas).filter(([ref]) => refs.has(ref))),
  };
  const confirm = async () => {
    if (!chosen) {
      state.fail("Pick a release bundle.", { bundle_version: "Pick a release bundle." });
      return;
    }
    state.begin("Requesting promotion…");
    await submit<Promotion>(`/api/projects/${project}/stages/${node.stage}/promotions`, { bundle_version: chosen.version }, async (result) => {
      if (result.ok) {
        await state.succeed(outcome(result.data, `Promotion of ${result.data.bundle.version} to ${node.stage} started.`));
      } else if (result.error?.error === "stage_busy") {
        state.fail(holderCopy(node.stage, result.error));
      } else if (result.error?.error === "not_verified_upstream") {
        state.fail(`${chosen.version} has not reached Healthy in ${node.upstream ?? ""} yet.`);
      } else if (result.error?.error === "validation") {
        state.fail(Object.values(result.error.fields ?? {}).join(" "), result.error.fields);
      } else {
        state.fail(generalError(result));
      }
    });
  };
  return (
    <Dialog title={`Promote to ${node.stage}`} onClose={onClose} onSubmit={confirm}
      actions={<>
        <button type="submit" className="button primary" disabled={busy}>Request promotion</button>
        <button type="button" className="button" onClick={onClose}>Cancel</button>
      </>}>
      <div className="field">
        <label className="field-inner">
        <span className="field-label">Release bundle</span>
        <span className="select-wrap">
          <select className="select-mono" value={choice} onChange={(event) => setChoice(event.target.value)} aria-describedby={`${fieldId}-error`}
            aria-invalid={state.fields.bundle_version ? true : undefined}>
            {options.length === 0 && <option value="">No bundle is verified in {node.upstream} yet</option>}
            {options.map((b) => <option key={b.id} value={label(b)}>{label(b)}</option>)}
          </select>
          <ChevronDown aria-hidden="true" size={16} />
        </span>
      </label>
        <FieldError id={`${fieldId}-error`} message={state.fields.bundle_version} />
      </div>
      <section className="frozen" aria-labelledby={`${fieldId}-frozen`}>
        <h3 id={`${fieldId}-frozen`} className="frozen-title">Overrides frozen into this promotion</h3>
        <dl className="frozen-list">
          {Object.entries(frozen.parameters).map(([key, value]) => (
            <div key={key}><dt>{key}</dt><dd className="mono">{value}</dd></div>
          ))}
          {Object.entries(frozen.replicas).map(([ref, count]) => (
            <div key={ref}><dt>{`replicas ${ref}`}</dt><dd className="mono">{count}</dd></div>
          ))}
          {Object.keys(frozen.parameters).length + Object.keys(frozen.replicas).length === 0 && <div><dt>No overrides</dt><dd /></div>}
        </dl>
      </section>
      {state.error && <p className="dialog-error">{state.error}</p>}
    </Dialog>
  );
}

function textDialog(kind: "approve" | "reject" | "break" | "rollback") {
  return function TextDialog({ project, promotion, title, restores, stage, onClose, onDone }: {
    project: string; promotion: Promotion | null; title: string; restores?: { version: string; short: string }; stage: string;
    onClose: Done; onDone: Refresh;
  }) {
    const spec = {
      approve: { field: "Comment", key: "comment", confirm: "Approve promotion", pending: "Recording approval…", path: "approve" },
      reject: { field: "Reason", key: "reason", confirm: "Reject promotion", pending: "Recording rejection…", path: "reject" },
      break: { field: "Incident reason", key: "reason", confirm: "Break freeze and start", pending: "Breaking the freeze…", path: "break-freeze" },
      rollback: { field: "Incident reason", key: "reason", confirm: `Roll back to ${restores?.version ?? ""}`, pending: "Starting rollback…", path: "" },
    }[kind];
    const [text, setText] = useState("");
    const { busy, submit } = useKeyedSubmit();
    const state = useOutcome(onDone);
    const fieldId = useId();
    const confirm = async () => {
      state.begin(spec.pending);
      const path = kind === "rollback"
        ? `/api/projects/${project}/stages/${stage}/rollback`
        : `/api/promotions/${promotion?.id ?? ""}/${spec.path}`;
      await submit<Promotion>(path, kind === "approve" && !text ? {} : { [spec.key]: text }, settle);
    };
    const settle = async (result: Result<Promotion>) => {
      if (result.ok) {
        const p = result.data;
        if (kind === "approve") await state.succeed(`Approved until ${clusterTime(p.approval?.expires_at ?? "", p.time_zone)}. The requester will be notified.`);
        if (kind === "reject") await state.succeed("Rejected. The requester will be notified.");
        if (kind === "break") await state.succeed(`Freeze broken. Applying ${p.bundle.version} to ${p.stage}. Release managers will be notified.`);
        if (kind === "rollback") await state.succeed(outcome(p, `Rolling ${p.stage} back to ${p.bundle.version} (${p.bundle.short_digest}).`));
        return;
      }
      const code = result.error?.error;
      if (code === "validation") {
        state.fail(Object.values(result.error?.fields ?? {}).join(" "), result.error?.fields);
      } else if ((code === "approval_expired" || (code === "invalid_transition" && result.error?.state === "expired")) && promotion) {
        state.fail(kind === "break" ? approvalLapsed(promotion) : requestLapsed(promotion));
      } else if (code === "evidence_pending") {
        state.fail("The evidence bundle is still being stored. You can approve once it is saved.");
      } else if (code === "storage_unavailable" && kind === "approve") {
        state.fail("Evidence storage is unreachable, so the approval was not recorded. Try again when it returns.");
      } else if (code === "storage_unavailable" && kind === "rollback") {
        state.fail("Evidence storage is unreachable, so the rollback could not read the last healthy bundle. Nothing was changed.");
      } else if (code === "no_healthy_revision") {
        state.fail(`${stage} has no earlier healthy revision to roll back to.`);
      } else if (code === "stage_busy" && result.error) {
        state.fail(holderCopy(stage, result.error));
      } else if (code === "invalid_transition") {
        state.fail(`This promotion is now ${String(result.error?.state ?? "").replace(/_/g, " ")}.`);
      } else {
        state.fail(generalError(result));
      }
    };
    return (
      <Dialog title={title} onClose={onClose} onSubmit={confirm}
        actions={<>
          <button type="submit" className={`button ${kind === "approve" ? "primary" : "danger"}`} disabled={busy}>{spec.confirm}</button>
          <button type="button" className="button" onClick={onClose}>Cancel</button>
        </>}>
        {restores && <p className="dialog-lead mono">{`Restores ${restores.version} (${restores.short})`}</p>}
        <div className="field">
          <label className="field-inner">
          <span className="field-label">{spec.field}</span>
          <textarea value={text} rows={3} onChange={(event) => setText(event.target.value)} aria-describedby={`${fieldId}-error`}
            aria-invalid={state.fields[spec.key] ? true : undefined} />
        </label>
          <FieldError id={`${fieldId}-error`} message={state.fields[spec.key]} />
        </div>
        {state.error && !state.fields[spec.key] && <p className="dialog-error">{state.error}</p>}
      </Dialog>
    );
  };
}

export const ApproveDialog = textDialog("approve");
export const RejectDialog = textDialog("reject");
export const BreakFreezeDialog = textDialog("break");
export const RollbackDialog = textDialog("rollback");
