/** What the console's panels may ask of the console. */

import type {
  Landmark,
  MissionEvent,
  Pass,
  Perilune,
  Reference,
  Sample,
  ShareLink,
  SharePass,
  Speaker,
  TranscriptLine,
} from "../shared/model.js";
import type { DistanceUnit, SpeedUnit } from "../shared/units.js";

export type ConsoleMission = {
  name: string;
  epochMs: number;
  distanceUnit: DistanceUnit;
  speedUnit: SpeedUnit;
  sampleCount: number;
  totalBytes: number;
  perilune: Perilune | null;
  reference: Reference | null;
  landmarks: Landmark[];
  passes: Pass[];
  sharePasses: SharePass[];
  share: ShareLink | null;
  changeVersion: number;
  expiresUtc: string | null;
};

export type Host = {
  readonly mode: "author" | "share";
  readonly apiBase: string;
  readonly missionId: string | null;
  readonly token: string | null;
  mission(): ConsoleMission;
  samples(): readonly Sample[];
  lines(): readonly TranscriptLine[];
  speakers(): readonly Speaker[];
  events(): readonly MissionEvent[];
  distanceUnit(): DistanceUnit;
  speedUnit(): SpeedUnit;
  lensIndex(): number;
  consoleStatus(message: string): void;
  uploadStatus(message: string): void;
  downloadStatus(message: string): void;
  reload(): Promise<void>;
  reloadTrack(): Promise<void>;
  goToMet(met: number, writeAddress: boolean): void;
  refreshSearch(): void;
  focusSlider(): void;
};

export type Panel = { element: HTMLElement; update: () => void };
