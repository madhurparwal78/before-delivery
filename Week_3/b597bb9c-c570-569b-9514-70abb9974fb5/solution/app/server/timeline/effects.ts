import type { AspectRatio, Clip, Marker, OpSummary, Stopped } from "../../shared/types";
import type { CaptionRec, RowRec } from "./model";

export type Patch<T> = { mode: "patch"; fields: Partial<T> } | { mode: "put"; value: T } | { mode: "drop" };

/** What an undo or a redo applies, stored with the op. Relative steps are recomputed against the timeline as it is now. */
export type Step =
  | { k: "shift"; clip_id: string; clip_name: string; delta: number; row_id: string | null }
  | { k: "trim"; clip_id: string; clip_name: string; edge: "start" | "end"; delta: number }
  | { k: "join"; left_id: string; right_id: string; left_name: string }
  | { k: "resplit"; clip_id: string; clip_name: string; at_frame: number; right_id: string }
  | {
      k: "restore";
      clips: Record<string, Patch<Clip>>;
      captions: Record<string, Patch<CaptionRec>>;
      rows: Record<string, Patch<RowRec>>;
      markers: Marker[] | null;
      aspect: AspectRatio | null;
      pins: { id: string; frame: number }[];
      names: Record<string, string>;
    };

/** A change to the stored frames of notes pinned to rows or clips. */
export type PinEffect =
  | { kind: "shift"; row_id: string; from_frame: number; delta: number }
  | { kind: "freeze"; clip_id: string; start_frame: number };

export interface Effect {
  summary: OpSummary;
  stopped: Stopped | null;
  /** Explicit steps for relative ops; absent means "restore the changed fields". */
  steps?: { forward: Step; inverse: Step };
  pins: PinEffect[];
  extraTouched: string[];
  srt?: { row_id: string };
}

export const edit = (type = "edit"): Effect => ({ summary: { type }, stopped: null, pins: [], extraTouched: [] });
