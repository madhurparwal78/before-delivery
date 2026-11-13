import type { Curve, Property } from "./keyframes";
import type { AspectRatio, RowKind } from "./types";

export interface ParsedCue {
  start_frame: number;
  end_frame: number;
  text: string;
  start_ms: number;
  end_ms: number;
}

export type OpBody =
  | { type: "add_clip"; row_id: string; media_id: string; start_frame: number }
  | { type: "add_text"; row_id: string; start_frame: number; end_frame: number; text: string }
  | { type: "move"; clip_id: string; start_frame: number; row_id: string }
  | { type: "trim"; clip_id: string; edge: "start" | "end"; delta_frames: number; ripple: boolean }
  | { type: "split"; clip_id: string; at_frame: number }
  | { type: "remove"; clip_id: string; ripple: boolean }
  | { type: "set_hidden"; clip_id: string; hidden: boolean }
  | { type: "set_speed"; clip_id: string; speed_percent: number }
  | { type: "group"; clip_ids: string[] }
  | { type: "ungroup"; group_id: string }
  | { type: "add_row"; name: string; kind: RowKind }
  | { type: "reorder_row"; row_id: string; position: number }
  | { type: "lock_row"; row_id: string; locked: boolean }
  | { type: "set_keyframe"; clip_id: string; property: Property; frame: number; value: number; curve: Curve }
  | { type: "remove_keyframe"; clip_id: string; property: Property; frame: number }
  | { type: "add_marker"; frame: number; label: string }
  | { type: "set_layer"; clip_id: string; frame: number; x?: number; y?: number; scale?: number }
  | { type: "caption_add"; row_id: string; start_frame: number; end_frame: number; text: string }
  | { type: "caption_edit"; caption_id: string; start_frame: number; end_frame: number; text: string }
  | { type: "caption_remove"; caption_id: string }
  | { type: "apply_kit"; kit_id: string }
  | { type: "set_aspect"; aspect_ratio: AspectRatio }
  | { type: "restore_cut"; cut_id: string }
  | { type: "import_captions"; row_id: string; cues: ParsedCue[]; eol: string; bom: boolean };
