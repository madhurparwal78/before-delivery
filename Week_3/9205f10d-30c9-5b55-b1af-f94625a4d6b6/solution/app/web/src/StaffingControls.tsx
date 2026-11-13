import { useState } from "react";
import { OFFLINE_COPY, type Result, api } from "./api";
import { STATUS_LABEL } from "./format";
import type { ApiRequest } from "./types";

const REFUSED = "This job can no longer be changed that way. The detail has been refreshed.";

const wholeNumber = (text: string): number | string => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : text);

/** Field error text under a control, linked as its description. */
function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p id={id} className="field-error">
      {message}
    </p>
  ) : null;
}

/** The coordinator's staffing controls: team size, rotation interval, broadcast and completion. */
export function StaffingControls({
  request,
  onUpdated,
  refresh,
}: {
  request: ApiRequest;
  onUpdated: (request: ApiRequest) => void;
  refresh: () => void;
}) {
  const defaultSize = request.duration_minutes > 60 ? 2 : 1;
  const [size, setSize] = useState(request.team_size ?? defaultSize);
  const [rotation, setRotation] = useState(String(request.rotation_minutes ?? 20));
  const [reason, setReason] = useState(request.team_reason ?? "");
  const [actual, setActual] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"staffing" | "broadcast" | "complete" | null>(null);
  const [message, setMessage] = useState("");

  const live = ["submitted", "half-staffed", "staffed"].includes(request.status);
  const broadcastable = ["submitted", "half-staffed"].includes(request.status);
  const completable = ["half-staffed", "staffed"].includes(request.status);

  const settle = <T,>(result: Result<T>, success: (data: T) => string) => {
    setBusy(null);
    if (result.ok) {
      setErrors({});
      setMessage(success(result.data));
      return;
    }
    if (!result.error) {
      setMessage(OFFLINE_COPY);
      return;
    }
    setErrors(result.error.fields ?? {});
    if (result.error.code === "invalid_transition") {
      setMessage(REFUSED);
      refresh();
    } else {
      setMessage(result.error.message);
    }
  };

  const saveStaffing = async () => {
    setBusy("staffing");
    setMessage("Saving staffing…");
    const body: Record<string, unknown> = { team_size: size, rotation_minutes: wholeNumber(rotation) };
    if (size !== defaultSize) body.team_reason = reason;
    const result = await api<ApiRequest>("PATCH", `/api/requests/${request.id}/staffing`, body);
    settle(result, (updated) => {
      onUpdated(updated);
      return "Staffing saved.";
    });
  };

  const broadcast = async () => {
    setBusy("broadcast");
    setMessage("Sending open-seat emails…");
    const result = await api<{ emailed: number }>("POST", `/api/requests/${request.id}/broadcast`, {});
    settle(result, ({ emailed }) => {
      refresh();
      return emailed === 0
        ? "No eligible interpreter is free for this job."
        : `Open-seat email sent to ${emailed} eligible interpreters.`;
    });
  };

  const complete = async () => {
    setBusy("complete");
    setMessage("Marking completed…");
    const result = await api<ApiRequest>("POST", `/api/requests/${request.id}/complete`, { actual_minutes: wholeNumber(actual) });
    settle(result, (updated) => {
      onUpdated(updated);
      return `${updated.reference} marked completed at ${updated.actual_minutes} minutes.`;
    });
  };

  const described = (field: string, id: string) =>
    errors[field] ? { "aria-invalid": true, "aria-describedby": id } : { "aria-invalid": false };

  return (
    <section className="pane-section" aria-labelledby="staffing-heading">
      <h3 id="staffing-heading">Staffing</h3>
      {live && (
        <div className="control-grid">
          <div className="field">
            <label htmlFor="rotation-interval">Rotation interval (minutes)</label>
            <input
              id="rotation-interval"
              className="input num"
              type="number"
              min={20}
              max={30}
              step={1}
              value={rotation}
              onChange={(e) => setRotation(e.target.value)}
              {...described("rotation_minutes", "rotation-error")}
            />
            <FieldError id="rotation-error" message={errors.rotation_minutes} />
          </div>
          <div className="field">
            <span id="team-size-label" className="field-label">
              Team size
            </span>
            <div className="radio-row" role="radiogroup" aria-labelledby="team-size-label">
              {([2, 1] as const).map((option) => (
                <label key={option} className="radio">
                  <input type="radio" name="team-size" checked={size === option} onChange={() => setSize(option)} />
                  {option === 2 ? "Team of two" : "Solo"}
                </label>
              ))}
            </div>
            <FieldError id="team-size-error" message={errors.team_size} />
          </div>
          {size !== defaultSize && (
            <div className="field field--wide">
              <label htmlFor="team-reason">Reason for team change</label>
              <textarea
                id="team-reason"
                className="input"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                {...described("team_reason", "team-reason-error")}
              />
              <FieldError id="team-reason-error" message={errors.team_reason} />
            </div>
          )}
          <div className="button-row field--wide">
            <button type="button" className="button button--primary" disabled={busy !== null} onClick={() => void saveStaffing()}>
              Save staffing
            </button>
            {broadcastable && (
              <button type="button" className="button" disabled={busy !== null} onClick={() => void broadcast()}>
                Broadcast open seats
              </button>
            )}
          </div>
        </div>
      )}
      {completable && (
        <div className="control-grid control-grid--complete">
          <div className="field">
            <label htmlFor="actual-minutes">Actual minutes</label>
            <input
              id="actual-minutes"
              className="input num"
              type="number"
              min={1}
              max={720}
              step={1}
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              {...described("actual_minutes", "actual-error")}
            />
            <FieldError id="actual-error" message={errors.actual_minutes} />
          </div>
          <div className="button-row">
            <button type="button" className="button" disabled={busy !== null} onClick={() => void complete()}>
              Mark completed
            </button>
          </div>
        </div>
      )}
      {!live && !completable && <p className="quiet">{STATUS_LABEL[request.status]}: staffing is settled for this job.</p>}
      <p className="live" role="status" aria-label="Job status">
        {message}
      </p>
    </section>
  );
}
