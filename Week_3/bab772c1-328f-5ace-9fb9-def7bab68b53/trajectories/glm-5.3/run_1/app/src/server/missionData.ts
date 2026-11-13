// The ground track, transcript, speakers and events for a mission, shared by
// the author and share data routes. All reads go through the same loaders so
// a deleted pass is absent from every answer.

import type { PoolClient } from "pg";
import {
  loadEvents,
  loadLandmarks,
  loadLines,
  loadMission,
  loadTrack,
  missionSampleCount,
  activeShareLink,
  computePerilune,
  missionTotalBytes,
  listPasses,
  passApiShape,
  landmarkApiShape,
  referenceApiShape,
  type EventRow,
  type LandmarkRow,
  type MissionRow,
  type Perilune,
  type ShareLinkInfo,
  type TrackSample,
} from "./store.js";
import { epochMsToIso } from "../shared/format.js";

export interface MissionData {
  mission: MissionRow;
  samples: TrackSample[];
  lines: Array<{ id: string; pass_id: string; met: number; met_label: string; speaker: string; text: string }>;
  events: Array<EventRow>;
  landmarks: LandmarkRow[];
  perilune: Perilune | null;
  share: ShareLinkInfo | null;
}

export async function gatherMissionData(
  client: PoolClient,
  missionId: string,
  nowMs: number,
): Promise<MissionData | null> {
  const mission = await loadMission(client, missionId);
  if (!mission) return null;
  const [samples, lines, events, landmarks, perilune, share] = await Promise.all([
    loadTrack(client, missionId),
    loadLines(client, missionId),
    loadEvents(client, missionId),
    loadLandmarks(client, missionId),
    computePerilune(client, missionId),
    activeShareLink(client, missionId, nowMs),
  ]);
  return { mission, samples, lines, events, landmarks, perilune, share };
}

export interface SpeakerSummary {
  name: string;
  lines: number;
}

export function speakerSummaries(
  lines: Array<{ speaker: string }>,
): SpeakerSummary[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const count = counts.get(line.speaker) ?? 0;
    counts.set(line.speaker, count + 1);
  }
  const summaries: SpeakerSummary[] = [];
  for (const [name, lines] of counts) {
    summaries.push({ name, lines });
  }
  summaries.sort((a, b) => {
    if (b.lines !== a.lines) return b.lines - a.lines;
    return codePointCompare(a.name, b.name);
  });
  return summaries;
}

function codePointCompare(a: string, b: string): number {
  const aPoints = Array.from(a);
  const bPoints = Array.from(b);
  const len = Math.min(aPoints.length, bPoints.length);
  for (let i = 0; i < len; i++) {
    const ca = aPoints[i].codePointAt(0) ?? 0;
    const cb = bPoints[i].codePointAt(0) ?? 0;
    if (ca !== cb) return ca - cb;
  }
  return aPoints.length - bPoints.length;
}

export interface ShareMissionBody {
  mission: {
    name: string;
    epoch_utc: string;
    distance_unit: string;
    speed_unit: string;
    sample_count: number;
    perilune: Perilune | null;
    reference: unknown;
    change_version: number;
  };
  passes: Array<{
    id: string;
    filename: string;
    size_bytes: number;
    sha256: string;
    sample_count: number;
    transcript_line_count: number;
  }>;
  landmarks: LandmarkRow[];
  expires_utc: string;
}

export async function shareMissionBody(
  client: PoolClient,
  mission: MissionRow,
  expiresUtc: string,
  nowMs: number,
): Promise<ShareMissionBody> {
  const passes = (await listPasses(client, mission.id, false)).filter((p) => p.state === "parsed");
  const sampleCount = await missionSampleCount(client, mission.id);
  const perilune = await computePerilune(client, mission.id);
  const landmarks = await loadLandmarks(client, mission.id);
  return {
    mission: {
      name: mission.name,
      epoch_utc: mission.epoch_utc,
      distance_unit: mission.distance_unit,
      speed_unit: mission.speed_unit,
      sample_count: sampleCount,
      perilune,
      reference: referenceApiShape(mission),
      change_version: mission.change_version,
    },
    passes: passes.map((p) => ({
      id: p.id,
      filename: p.filename,
      size_bytes: p.size_bytes,
      sha256: p.sha256,
      sample_count: p.sample_count,
      transcript_line_count: p.transcript_line_count,
    })),
    landmarks: landmarks.map(landmarkApiShape),
    expires_utc: expiresUtc,
  };
}

export { epochMsToIso };
