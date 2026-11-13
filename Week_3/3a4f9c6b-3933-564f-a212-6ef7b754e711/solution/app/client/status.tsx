// Every status shows its own outline glyph and its word, so it reads without colour.
import { ArrowRightLeft, CircleCheck, CircleDashed, CircleSlash, GitFork, Link2, TriangleAlert, type LucideIcon } from "lucide-react";
import type { HealthValue, PromotionState, StageStatus, SyncValue } from "../shared/api";

type Mark = { word: string; Icon: LucideIcon; tone: string };

const STAGE: Record<StageStatus, Mark> = {
  healthy: { word: "Healthy", Icon: CircleCheck, tone: "healthy" },
  progressing: { word: "Progressing", Icon: ArrowRightLeft, tone: "progressing" },
  degraded: { word: "Degraded", Icon: TriangleAlert, tone: "degraded" },
  out_of_sync: { word: "Out-of-sync", Icon: GitFork, tone: "out-of-sync" },
  not_deployed: { word: "Not deployed", Icon: CircleSlash, tone: "not-deployed" },
};

const RESOURCE: Record<SyncValue | HealthValue, Mark> = {
  Synced: { word: "Synced", Icon: Link2, tone: "healthy" },
  OutOfSync: { word: "OutOfSync", Icon: GitFork, tone: "out-of-sync" },
  Healthy: { word: "Healthy", Icon: CircleCheck, tone: "healthy" },
  Progressing: { word: "Progressing", Icon: ArrowRightLeft, tone: "progressing" },
  Degraded: { word: "Degraded", Icon: TriangleAlert, tone: "degraded" },
  Missing: { word: "Missing", Icon: CircleDashed, tone: "not-deployed" },
};

// A promotion's state wears the glyph of the stage status it shows as while it holds the stage.
const PROMOTION: Record<PromotionState, Mark> = {
  requested: STAGE.out_of_sync, awaiting_approval: STAGE.out_of_sync, approved: STAGE.out_of_sync, queued: STAGE.out_of_sync,
  window_blocked: STAGE.out_of_sync, applying: STAGE.progressing, health_wait: STAGE.progressing, healthy: STAGE.healthy,
  degraded: STAGE.degraded, rolled_back: STAGE.degraded, rejected: STAGE.not_deployed, expired: STAGE.not_deployed,
};

export const stateLabel = (state: PromotionState) => {
  const words = state.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function MarkView({ mark }: { mark: Mark }) {
  const { Icon } = mark;
  return (
    <span className={`mark tone-${mark.tone}`}>
      <Icon aria-hidden="true" size={16} strokeWidth={2} />
      <span>{mark.word}</span>
    </span>
  );
}

export function StageMark({ status }: { status: StageStatus }) {
  return <MarkView mark={STAGE[status]} />;
}

export function PromotionMark({ state }: { state: PromotionState }) {
  return <MarkView mark={{ ...PROMOTION[state], word: stateLabel(state) }} />;
}

export function ResourceMark({ value }: { value: SyncValue | HealthValue }) {
  return <MarkView mark={RESOURCE[value]} />;
}
