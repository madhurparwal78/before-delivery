import { useState, type ReactNode } from "react";
import type { RequestDetail } from "../../shared/api.ts";
import { CONDITION_KINDS, CONDITION_LABELS, type ConditionKind, type Decision } from "../../shared/domain.ts";
import { api, messageOf } from "../lib/api.ts";
import { calendarDate } from "../lib/format.ts";
import { Alert, Button, usePageStatus } from "../ui/index.ts";

type Busy = Decision | "condition" | null;

interface DecisionControlsProps {
  detail: RequestDetail;
  /** Receives the refreshed request after a decision or a condition. */
  onChanged: (detail: RequestDetail, decided: boolean) => void;
  reload: () => Promise<RequestDetail | null>;
}

/** The stage reason, grant preview, comment, the three decisions and the condition picker, in tab order. */
export function DecisionControls({ detail, onChanged, reload }: DecisionControlsProps): ReactNode {
  const say = usePageStatus();
  const [comment, setComment] = useState("");
  const [kind, setKind] = useState<ConditionKind>("clear_space");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = detail.grantPreview;
  const stage = detail.stages.find((s) => s.decision === null);

  async function decide(decision: Decision): Promise<void> {
    setBusy(decision);
    setError(null);
    try {
      const next = await api<RequestDetail>("POST", `/api/requests/${detail.id}/stages/${stage!.n}/decision`, {
        decision,
        comment: comment.trim() === "" ? null : comment,
      });
      say("Decision saved.");
      setComment("");
      onChanged(next, true);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(null);
    }
  }

  async function addCondition(): Promise<void> {
    setBusy("condition");
    setError(null);
    try {
      const needsValue = kind !== "no_recolour" && kind !== "proof_required";
      await api("POST", `/api/requests/${detail.id}/conditions`, { kind, value: needsValue ? value : null });
      say("Condition added.");
      setValue("");
      const next = await reload();
      if (next) onChanged(next, false);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(null);
    }
  }

  const locked = busy !== null || stage === undefined;
  return (
    <div className="stack decision">
      {detail.stageReason ? <p className="decision-reason">{detail.stageReason}</p> : null}
      {preview ? (
        <p className="decision-preview">
          {preview.zeroLength
            ? `This grant would end on ${calendarDate(preview.notAfter)}, before it starts. Approving records the decision but grants nothing.`
            : `Grant will end on ${calendarDate(preview.notAfter)} (${preview.cap})`}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor={`comment-${detail.id}`}>Comment</label>
        <textarea id={`comment-${detail.id}`} value={comment} onChange={(event) => setComment(event.target.value)} />
      </div>
      <div className="row decision-buttons">
        <Button primary pending={busy === "approve" && "save"} disabled={locked} onClick={() => void decide("approve")}>
          Approve
        </Button>
        <Button pending={busy === "reject" && "save"} disabled={locked} onClick={() => void decide("reject")}>
          Reject
        </Button>
        <Button pending={busy === "request_changes" && "save"} disabled={locked} onClick={() => void decide("request_changes")}>
          Request changes
        </Button>
      </div>
      <div className="field">
        <label htmlFor={`condition-${detail.id}`}>Condition</label>
        <select id={`condition-${detail.id}`} value={kind} onChange={(event) => setKind(event.target.value as ConditionKind)}>
          {CONDITION_KINDS.map((item) => (
            <option key={item} value={item}>
              {CONDITION_LABELS[item]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`condition-value-${detail.id}`}>Condition value</label>
        <input id={`condition-value-${detail.id}`} type="text" value={value} onChange={(event) => setValue(event.target.value)} />
      </div>
      <div>
        <Button pending={busy === "condition" && "save"} disabled={locked} onClick={() => void addCondition()}>
          Add condition
        </Button>
      </div>
      <Alert message={error} />
    </div>
  );
}
