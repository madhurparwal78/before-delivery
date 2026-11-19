import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { RequestDetail } from "../../shared/api.ts";
import { ESCALATION_LABELS, OPEN_REQUEST_STATES } from "../../shared/domain.ts";
import { ApiFailure, api, get, messageOf } from "../lib/api.ts";
import { calendarDate, stampOf } from "../lib/format.ts";
import { useHeadingFocus, useTitle } from "../lib/focus.ts";
import { useLive } from "../lib/live.ts";
import { useDesktop } from "../lib/motion.ts";
import { Link } from "../lib/router.tsx";
import { useSession } from "../lib/session.tsx";
import { DecisionControls } from "../requests/DecisionControls.tsx";
import { Proofs } from "../requests/Proofs.tsx";
import { Alert, Button, Chip, Dialog, Loading, usePageStatus } from "../ui/index.ts";
import { NotFound } from "./NotFound.tsx";
import "../requests/requests.css";


export function RequestPage({ params }: { params: string[] }): ReactNode {
  const [id] = params;
  useTitle(id);
  const { me } = useSession();
  const say = usePageStatus();
  const desktop = useDesktop();
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"withdraw" | "resubmit" | null>(null);
  const [update, setUpdate] = useState("");
  const [sheet, setSheet] = useState(false);
  const seenState = useRef<string | null>(null);
  const decideButton = useRef<HTMLButtonElement>(null);

  /** Fetches the request; a state change after the first load is announced in `Request updates`. */
  const load = useCallback(async (): Promise<RequestDetail | null> => {
    try {
      const next = await get<RequestDetail>(`/api/requests/${id}`);
      if (seenState.current !== null && seenState.current !== next.state) setUpdate(`${id} is now ${next.stateLabel}.`);
      seenState.current = next.state;
      setDetail(next);
      setError(null);
      return next;
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 404) setMissing(true);
      else setError(messageOf(failure));
      return null;
    }
  }, [id]);
  useEffect(() => void load(), [load]);
  useLive(["request.updated", "grant.updated"], (message) => {
    if (message.type === "request.updated" && message.requestId !== id) return;
    void load();
  });
  useHeadingFocus(detail !== null);

  if (missing) return <NotFound />;
  if (detail === null) return error ? <Alert message={error} /> : <Loading />;

  const principal = me!.principal;
  const isRequester = detail.requester.id === principal.id;
  const isReviewer = principal.role === "owner" || principal.role === "brand_reviewer" || principal.role === "legal_reviewer";
  const canDecide = detail.state === "under_review" && detail.stageReason !== undefined;

  async function act(action: "withdraw" | "resubmit"): Promise<void> {
    setBusy(action);
    setActionError(null);
    try {
      setDetail(await api<RequestDetail>("POST", `/api/requests/${id}/${action}`, action === "resubmit" ? {} : undefined));
      say(action === "withdraw" ? `${id} withdrawn.` : `${id} resubmitted.`);
    } catch (failure) {
      setActionError(messageOf(failure));
    } finally {
      setBusy(null);
    }
  }

  const afterChange = (next: RequestDetail, decided: boolean): void => {
    setDetail(next);
    if (decided) setSheet(false);
  };
  const decision = canDecide ? <DecisionControls key={detail.stages.filter((s) => s.decision).length} detail={detail} onChanged={afterChange} reload={load} /> : null;

  return (
    <div className="request-layout">
      <div className="request-main">
        <section className="cell cell-pad request-head" data-frame>
          <h1>{detail.id}</h1>
          <div className="row">
            <span role="status" aria-label="Request state" className="state-chip">
              {detail.stateLabel}
            </span>
          </div>
          <p>{`Held by ${detail.holder.displayName}`}</p>
          {detail.deadline ? <p>{`Due ${stampOf(detail.deadline)}`}</p> : null}
          {detail.escalation ? <p className="escalation">{ESCALATION_LABELS[detail.escalation]}</p> : null}
          {isRequester && OPEN_REQUEST_STATES.includes(detail.state) ? (
            <div className="row">
              {detail.state === "changes_requested" ? (
                <Button primary pending={busy === "resubmit" && "save"} disabled={busy !== null} onClick={() => void act("resubmit")}>
                  Resubmit request
                </Button>
              ) : null}
              <Button pending={busy === "withdraw" && "save"} disabled={busy !== null} onClick={() => void act("withdraw")}>
                Withdraw request
              </Button>
            </div>
          ) : null}
          <Alert message={actionError} />
        </section>

        <section className="cell cell-pad" aria-label="Details" data-frame>
          <span className="cell-label">Details</span>
          <dl className="facts">
            <dt>Asset</dt>
            <dd>{detail.cardName}</dd>
            <dt>Application</dt>
            <dd>{detail.applicationLabel}</dd>
            <dt>Requester</dt>
            <dd>{`${detail.requester.displayName}, ${detail.requester.organisationName}`}</dd>
            <dt>Territories</dt>
            <dd>{detail.territories.join(", ")}</dd>
            <dt>Campaign</dt>
            <dd>{`${calendarDate(detail.campaignStartsOn)} to ${calendarDate(detail.campaignEndsOn)}`}</dd>
            {detail.note ? (
              <>
                <dt>Note</dt>
                <dd>{detail.note}</dd>
              </>
            ) : null}
          </dl>
        </section>

        <section className="cell cell-pad" aria-label="Rules" data-frame>
          <span className="cell-label">Cited rules</span>
          <ul aria-label="Cited rules" className="plain-list">
            {detail.citedRules.map((rule) => (
              <li key={rule.identifier}>
                <Link to={`/rules/${rule.identifier}`} className="row-link">
                  {rule.identifier}
                </Link>
                {rule.status === "withdrawn" ? <span className="muted"> withdrawn</span> : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="cell cell-pad" aria-label="Stages" data-frame>
          <span className="cell-label">Stages</span>
          <ol className="stages">
            {detail.stages.map((stage) => (
              <li key={stage.n}>
                <strong>{stage.label}</strong>
                <span>{stage.assigneeName ?? "Not yet assigned"}</span>
                {stage.decisionLabel ? (
                  <span>
                    {`${stage.decisionLabel}${stage.decidedByName ? ` by ${stage.decidedByName}` : ""}${stage.decidedAt ? `, ${stampOf(stage.decidedAt)}` : ""}`}
                  </span>
                ) : (
                  <span className="muted">Open</span>
                )}
                {stage.comment ? <span className="muted">{stage.comment}</span> : null}
              </li>
            ))}
          </ol>
        </section>

        {detail.conditions.length > 0 ? (
          <section className="cell cell-pad" aria-label="Conditions" data-frame>
            <span className="cell-label">Conditions</span>
            <ul className="plain-list">
              {detail.conditions.map((condition) => (
                <li key={condition.id}>{condition.text}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {detail.grant ? (
          <section className="cell cell-pad stack" aria-label="Grant" data-frame>
            <span className="cell-label">Grant</span>
            <p>
              <strong>{detail.grant.id}</strong> <Chip tone={detail.grant.status === "active" ? "meadow" : "saffron"}>{detail.grant.statusLabel}</Chip>
            </p>
            <p>{`Ends ${calendarDate(detail.grant.notAfter)}`}</p>
            {detail.grant.conditions.length > 0 ? (
              <ul className="plain-list">
                {detail.grant.conditions.map((condition) => (
                  <li key={condition.text}>{condition.text}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        <Proofs detail={detail} isRequester={isRequester} isReviewer={isReviewer} reload={load} />
      </div>

      {decision && desktop ? (
        <section className="cell cell-pad request-decision" aria-label="Decision" data-frame>
          <span className="cell-label">Decision</span>
          {decision}
        </section>
      ) : null}

      {decision && !desktop ? (
        <>
          <div className="decide-bar">
            <button ref={decideButton} type="button" className="btn btn-primary" onClick={() => setSheet(true)}>
              Decide
            </button>
          </div>
          {sheet ? (
            <Dialog
              name={`Decide ${detail.id}`}
              sheet
              onClose={() => {
                setSheet(false);
                queueMicrotask(() => decideButton.current?.focus());
              }}
            >
              <h2>{`Decide ${detail.id}`}</h2>
              {decision}
            </Dialog>
          ) : null}
        </>
      ) : null}

      <div role="region" aria-live="assertive" aria-label="Request updates" className="visually-hidden">
        {update}
      </div>
    </div>
  );
}
