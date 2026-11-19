import { useCallback, useEffect, useState } from "react";
import type { ApprovalCard, Risk, StepJson } from "../../../server/changes.js";
import { ApiFailure, failureText, get, post } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { useTopics } from "../../lib/live.js";
import { Button, StatusBlock } from "../../lib/ui.js";
import { formatLocalIso } from "../../../shared/tz.js";
import { STEP_STATUS_LABELS, tallyText } from "./tally.js";

interface Steps {
  steps: StepJson[];
  mine: ApprovalCard[];
}

interface Props {
  number: string;
  /** Changes whenever the record was loaded again, so risk and steps are read again. */
  version: unknown;
  /** True once the change has an item and a planned window, which the risk score needs. */
  scored: boolean;
  username: string;
  operator: boolean;
  zone: string;
}

const decisionWord = (decision: string | null): string => (decision === "approve" ? "approved" : "rejected");

/** The change's risk and approval steps; both follow the server, and the steps follow the vote topic live. */
export function ChangePanels({ number, version, scored, username, operator, zone }: Props): JSX.Element {
  const announce = useAnnounce();
  const [risk, setRisk] = useState<Risk | null>(null);
  const [approvals, setApprovals] = useState<Steps>({ steps: [], mine: [] });
  const [error, setError] = useState<{ step: number; message: string } | null>(null);

  const loadSteps = useCallback((): void => {
    void Promise.all([get<{ steps: StepJson[] }>(`/api/records/${number}/approvals`), get<{ approvals: ApprovalCard[] }>("/api/approvals")]).then(
      ([loaded, cards]) => setApprovals({ steps: loaded.steps, mine: cards.approvals.filter((c) => c.kind === "change_step" && c.record === number) }),
      () => undefined,
    );
  }, [number]);

  useEffect(() => {
    let current = true;
    if (scored)
      get<Risk>(`/api/records/${number}/risk`).then(
        (loaded) => current && setRisk(loaded),
        () => undefined,
      );
    loadSteps();
    return () => {
      current = false;
    };
  }, [number, version, scored, loadSteps]);

  useTopics([`votes:${number}`, "approvals"], loadSteps);

  const mayVote = (step: StepJson): boolean => step.status === "open" && approvals.mine.some((c) => c.step?.step === step.step);

  const vote = async (step: StepJson, decision: "approve" | "reject"): Promise<void> => {
    setError(null);
    const ownTurn = step.voters.some((v) => v.username === username && v.decision === null);
    const members = ownTurn ? [null] : step.voters.filter((v) => v.decision === null).map((v) => v.username);
    for (const [index, member] of members.entries()) {
      try {
        await post(`/api/records/${number}/steps/${step.step}/votes`, { decision, comment: "", on_behalf_of: member });
        announce(`Vote recorded: ${decision} on ${number}.`);
        loadSteps();
        return;
      } catch (failure) {
        if (failure instanceof ApiFailure && failure.code === "not_a_voter" && index < members.length - 1) continue;
        setError({ step: step.step, message: failureText(failure) });
        announce(failureText(failure));
        return;
      }
    }
  };

  const close = (step: StepJson): void => {
    setError(null);
    post(`/api/records/${number}/steps/${step.step}/close`).then(loadSteps, (failure: unknown) => setError({ step: step.step, message: failureText(failure) }));
  };

  return (
    <>
      {risk ? (
        <section className="rf-section" aria-label="Risk">
          <p className="rf-risk">
            Risk {risk.score}, {risk.band}
          </p>
        </section>
      ) : null}
      {approvals.steps.length > 0 ? (
        <section className="rf-section" aria-label="Approvals">
          <h3>Approvals</h3>
          {approvals.steps.map((step) => {
            const tally = tallyText(step);
            const canVote = mayVote(step);
            const canClose = operator && step.status === "open";
            return (
              <div key={step.step} role="group" aria-label={step.name} className="rf-step">
                <h4>
                  {step.name} <StatusBlock outlined={step.status === "not_started" || step.status === "open"}>{STEP_STATUS_LABELS[step.status]}</StatusBlock>
                </h4>
                {step.closes_at && step.status === "open" ? <p className="muted">Vote closes {formatLocalIso(step.closes_at, zone)}</p> : null}
                <ul className="rf-voters">
                  {step.voters
                    .filter((v) => v.decision !== null)
                    .map((v) => (
                    <li key={v.username}>
                      {v.username}: {decisionWord(v.decision)}
                      {v.voted_by && v.voted_by !== v.username ? ` (by ${v.voted_by})` : ""}
                    </li>
                  ))}
                </ul>
                <section aria-label="Tally" className="rf-tally">
                  <p>
                    {tally.counts}
                    {tally.closed ? " " : null}
                    {tally.closed ? <strong>{tally.closed}</strong> : null}
                  </p>
                </section>
                {canVote || canClose ? (
                  <div className="row">
                    {canVote ? <Button onClick={() => void vote(step, "approve")}>Approve</Button> : null}
                    {canVote ? (
                      <Button variant="outline" onClick={() => void vote(step, "reject")}>
                        Reject
                      </Button>
                    ) : null}
                    {canClose ? (
                      <Button variant="outline" onClick={() => close(step)}>
                        Close vote
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {error && error.step === step.step ? <p className="form-error">{error.message}</p> : null}
              </div>
            );
          })}
        </section>
      ) : null}
    </>
  );
}
