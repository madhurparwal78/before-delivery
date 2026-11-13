// The Activity (polite) and Problem (assertive) regions every screen carries, and the shared copy.
import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { type ErrorBody, type Promotion, type WindowDecision, shortDigest } from "../shared/api";
import { clusterTime } from "../shared/zone";
import type { Result } from "./api";

/** What the two regions show; a new line in one clears the other. */
interface Lines { activity: string; problem: string }

/** Pending or success copy for status "Activity". */
export const activity = (text: string): Lines => ({ activity: text, problem: "" });
/** Error copy for alert "Problem". */
export const problem = (text: string): Lines => ({ activity: "", problem: text });

const LinesContext = createContext<Lines>(activity(""));
const SayContext = createContext<Dispatch<SetStateAction<Lines>>>(() => undefined);

export function FeedbackProvider({ children, initialProblem = "" }: { children: ReactNode; initialProblem?: string }) {
  const [lines, setLines] = useState<Lines>(problem(initialProblem));
  return (
    <SayContext.Provider value={setLines}>
      <LinesContext.Provider value={lines}>{children}</LinesContext.Provider>
    </SayContext.Provider>
  );
}

/** Sets the lines shown in the Activity and Problem regions. */
export function useFeedback(): Dispatch<SetStateAction<Lines>> {
  return useContext(SayContext);
}

export function FeedbackRegions() {
  const { activity: activityLine, problem: problemLine } = useContext(LinesContext);
  return (
    <div className="feedback">
      <div role="status" aria-label="Activity" className="feedback-activity">{activityLine}</div>
      <div role="alert" aria-label="Problem" className="feedback-problem">{problemLine}</div>
      {!activityLine && !problemLine && <span className="feedback-idle" aria-hidden="true">No recent activity.</span>}
    </div>
  );
}

export const COPY = {
  network: "Keelson could not reach the server. Your last action was not confirmed.",
  role: "Your role in this project cannot do that.",
  sessionEnded: "Your session ended. Sign in again.",
};

/** The copy for an error the screen has no specific line for (role, session, network, server). */
export function generalError(result: Result<unknown>): string {
  if (result.ok) return "";
  if (result.status === 403 && result.error?.error === "forbidden") return COPY.role;
  if (result.status === 401) return COPY.sessionEnded;
  return COPY.network;
}

function blockReason(p: Promotion, decision: WindowDecision): string {
  return decision.reason === "freeze"
    ? `freeze "${decision.freeze?.name ?? ""}" is in force`
    : `outside the sync window for ${p.cluster} (${p.time_zone})`;
}

/** Success copy for a promotion that has just been requested or started. */
export function outcome(p: Promotion, applying: string): string {
  if (p.state === "awaiting_approval") return `Promotion of ${p.bundle.version} to ${p.stage} is waiting for approval.`;
  if (p.state === "window_blocked" && p.window_decision) {
    return `Promotion of ${p.bundle.version} to ${p.stage} is blocked: ${blockReason(p, p.window_decision)}.`;
  }
  return applying;
}

export function approvalLapsed(p: Promotion): string {
  return `This approval expired at ${clusterTime(p.approval?.expires_at ?? p.approval?.request_expires_at ?? p.requested_at, p.time_zone)}. Request a new promotion.`;
}

export function requestLapsed(p: Promotion): string {
  return `This approval request expired at ${clusterTime(p.approval?.request_expires_at ?? p.requested_at, p.time_zone)}.`;
}

/** The window decision as one line, for the evidence column and the Check an instant form. */
export function verdict(d: WindowDecision, unwindowed: string): string {
  if (d.reason === "freeze") return `Closed: freeze "${d.freeze?.name ?? ""}" (policy version ${d.policy_version})`;
  if (d.reason === "outside_window") return "Closed: outside every sync window";
  return `Open: ${d.window?.label ?? unwindowed}`;
}

export function holderCopy(stage: string, error: ErrorBody): string {
  const holder = error.holder;
  return `${stage} is held by ${holder?.bundle_version ?? ""} (${shortDigest(holder?.bundle_digest ?? "")}). Try again when it finishes.`;
}
