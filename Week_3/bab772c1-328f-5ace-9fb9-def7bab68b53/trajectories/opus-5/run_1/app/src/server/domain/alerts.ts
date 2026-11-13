/** One push alert per parse outcome, published after the settling transaction commits. */

import { config } from "../config.js";
import { publishAlert } from "../services/push.js";
import { reasonText } from "../../shared/reasons.js";
import type { RejectionReason } from "../../shared/model.js";
import type { MissionRow } from "./missionRead.js";

export type ParseAlertOutcome =
  | { kind: "parsed"; sampleCount: number; lineCount: number; firstSampleMet: number }
  | { kind: "rejected"; line: number | null; reason: RejectionReason };

function plural(value: number, singular: string, many: string): string {
  return value === 1 ? `1 ${singular}` : `${value} ${many}`;
}

export async function sendParseAlert(
  mission: MissionRow,
  pass: { filename: string },
  outcome: ParseAlertOutcome,
): Promise<void> {
  const topic = `perilune-${mission.id}`;
  const base = config.publicUrl;
  if (outcome.kind === "parsed") {
    await publishAlert({
      topic,
      title: `${mission.name}: pass parsed`,
      message: `${pass.filename}: ${plural(outcome.sampleCount, "sample", "samples")}, ${plural(
        outcome.lineCount,
        "transcript line",
        "transcript lines",
      )}.`,
      priority: 3,
      tags: ["white_check_mark"],
      ...(base
        ? { click: `${base}/missions/${mission.id}?t=${outcome.firstSampleMet}` }
        : {}),
    });
    return;
  }
  const failed = outcome.reason === "parser_failed";
  await publishAlert({
    topic,
    title: `${mission.name}: pass rejected`,
    message: failed
      ? `${pass.filename}: ${reasonText(outcome.reason)}.`
      : `${pass.filename}: line ${outcome.line}, ${reasonText(outcome.reason)}.`,
    priority: failed ? 5 : 4,
    tags: failed ? ["rotating_light"] : ["warning"],
    ...(base ? { click: `${base}/missions/${mission.id}` } : {}),
  });
}
