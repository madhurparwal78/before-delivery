import { ZOOM_PX_PER_FRAME } from "../../shared/limits";
import { rateOf, type FrameRate } from "../../shared/rational";
import type { Caption, Clip, Comment, Cut, ExportRecord, Kit, Marker, Member, MediaDims, Project, Role, Row } from "../../shared/types";
import type { Panel } from "./address";

export interface LoupeState {
  /** Pointer position in the window while skimming; null while pinned by keyboard. */
  pointer: { x: number; y: number } | null;
  frame: number;
  snapped: boolean;
  pinned: boolean;
  returnTo: string | null;
}

export interface ProjectState {
  status: "loading" | "ready" | "removed" | "missing";
  project: Project;
  rows: Row[];
  clips: Clip[];
  captions: Caption[];
  markers: Marker[];
  members: Member[];
  media: Record<string, MediaDims>;
  comments: Comment[];
  cuts: Cut[];
  exports: ExportRecord[];
  kits: Kit[];
  version: number;
  role: Role;
  pending: Record<string, true>;
  winners: Record<string, string>;
  gliding: Record<string, true>;
  remotePlayheads: Record<string, number>;
  activity: { id: number; text: string }[];
  playhead: number;
  zoom: number;
  first: number;
  canvasWidth: number;
  current: string | null;
  selection: string[];
  panel: Panel;
  skim: LoupeState | null;
  playing: boolean;
  range: { in: number | null; out: number | null };
  focusRequest: { clip: string; seq: number } | null;
}

export const ppf = (zoom: number): number => ZOOM_PX_PER_FRAME[zoom] ?? 1;

export const rateOfState = (state: ProjectState): FrameRate => rateOf(state.project.frame_rate);

function totalFrames(state: Pick<ProjectState, "clips" | "captions">): number {
  return Math.max(0, ...state.clips.map((clip) => clip.end_frame), ...state.captions.map((caption) => caption.end_frame));
}

export const lastFrame = (state: Pick<ProjectState, "clips" | "captions">): number => Math.max(0, totalFrames(state) - 1);

export function visibleFrames(state: Pick<ProjectState, "zoom" | "canvasWidth">): number {
  return Math.floor(state.canvasWidth / ppf(state.zoom));
}

/** Zoom holds the playhead frame: the first drawn frame sits half a canvas before it. */
export function firstForZoom(state: Pick<ProjectState, "zoom" | "canvasWidth" | "playhead">): number {
  return Math.max(0, state.playhead - Math.floor(visibleFrames(state) / 2));
}

export function timelineOrder(clips: readonly Clip[], rows: readonly Row[]): Clip[] {
  const position = new Map(rows.map((row) => [row.id, row.position]));
  return [...clips].sort((a, b) => a.start_frame - b.start_frame || (position.get(a.row_id) ?? 0) - (position.get(b.row_id) ?? 0) || (a.id < b.id ? -1 : 1));
}

export const canEdit = (role: Role): boolean => role === "owner" || role === "editor";
export const canApprove = (role: Role): boolean => role === "owner" || role === "commenter";

export function emptyState(project: Project): ProjectState {
  return {
    status: "loading",
    project,
    rows: [],
    clips: [],
    captions: [],
    markers: [],
    members: [],
    media: {},
    comments: [],
    cuts: [],
    exports: [],
    kits: [],
    version: 0,
    role: project.role,
    pending: {},
    winners: {},
    gliding: {},
    remotePlayheads: {},
    activity: [],
    playhead: 0,
    zoom: 2,
    first: 0,
    canvasWidth: 1000,
    current: null,
    selection: [],
    panel: "none",
    skim: null,
    playing: false,
    range: { in: null, out: null },
    focusRequest: null,
  };
}
