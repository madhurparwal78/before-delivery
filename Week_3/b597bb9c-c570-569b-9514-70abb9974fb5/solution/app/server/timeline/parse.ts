import { FIELD_ERRORS } from "../../shared/copy";
import { CURVES, PROPERTIES, PROPERTY_RANGE, type Property } from "../../shared/keyframes";
import { ASPECT_LABELS } from "../../shared/types";
import type { OpBody } from "../../shared/ops";
import { validCueText } from "../../shared/captions";
import { SPEED_MAX, SPEED_MIN } from "../../shared/limits";
import { codePoints } from "../../shared/codepoints";
import { invalid } from "../errors";

export interface OpEnvelope {
  op_id: string;
  base_version: number;
  body: OpBody;
}

type Raw = Record<string, unknown>;

const FRAME_MAX = 10_000_000;

function fail(field: string, message: string = FIELD_ERRORS.other): never {
  throw invalid({ [field]: message });
}

function record(value: unknown): Raw {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail("body");
  return value as Raw;
}

function text(raw: Raw, field: string, min = 1, max = 200): string {
  const value = raw[field];
  if (typeof value !== "string" || codePoints(value) < min || codePoints(value) > max) return fail(field);
  return value;
}

function frame(raw: Raw, field: string): number {
  const value = raw[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > FRAME_MAX) return fail(field);
  return value;
}

function int(raw: Raw, field: string, min: number, max: number): number {
  const value = raw[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return fail(field);
  return value;
}

function bool(raw: Raw, field: string, optional = false): boolean {
  const value = raw[field];
  if (typeof value === "boolean") return value;
  if (optional && value === undefined) return false;
  return fail(field);
}

function cueText(raw: Raw): string {
  const value = raw["text"];
  if (typeof value !== "string" || !validCueText(value)) return fail("text", FIELD_ERRORS.text);
  return value;
}

function oneOf<T extends string>(raw: Raw, field: string, options: readonly T[], message: string = FIELD_ERRORS.other): T {
  const value = raw[field];
  const match = options.find((option) => option === value);
  if (match === undefined) return fail(field, message);
  return match;
}

function layerValue(raw: Raw, property: Property): number | undefined {
  const value = raw[property];
  if (value === undefined) return undefined;
  const [low, high] = PROPERTY_RANGE[property];
  if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high) return fail(property);
  return value;
}

/** The idempotency key every write carries, 1 to 64 characters. */
export function parseOpId(input: unknown): string {
  return text(record(input), "op_id", 1, 64);
}

/** Parses the shared op fields and the typed body. `internal` bodies arrive only through their own routes. */
export function parseEnvelope(input: unknown, allowInternal: boolean): OpEnvelope {
  const raw = record(input);
  const op_id = text(raw, "op_id", 1, 64);
  const base_version = int(raw, "base_version", 0, 2_000_000_000);
  return { op_id, base_version, body: parseBody(raw, allowInternal) };
}

function parseBody(raw: Raw, allowInternal: boolean): OpBody {
  const type = raw["type"];
  switch (type) {
    case "add_clip":
      return { type, row_id: text(raw, "row_id"), media_id: text(raw, "media_id"), start_frame: frame(raw, "start_frame") };
    case "add_text": {
      const start_frame = frame(raw, "start_frame");
      const end_frame = frame(raw, "end_frame");
      if (end_frame <= start_frame) return fail("end_frame");
      return { type, row_id: text(raw, "row_id"), start_frame, end_frame, text: text(raw, "text", 1, 200) };
    }
    case "move":
      return { type, clip_id: text(raw, "clip_id"), start_frame: frame(raw, "start_frame"), row_id: text(raw, "row_id") };
    case "trim":
      return {
        type,
        clip_id: text(raw, "clip_id"),
        edge: oneOf(raw, "edge", ["start", "end"] as const),
        delta_frames: int(raw, "delta_frames", -FRAME_MAX, FRAME_MAX),
        ripple: bool(raw, "ripple", true),
      };
    case "split":
      return { type, clip_id: text(raw, "clip_id"), at_frame: frame(raw, "at_frame") };
    case "remove":
      return { type, clip_id: text(raw, "clip_id"), ripple: bool(raw, "ripple", true) };
    case "set_hidden":
      return { type, clip_id: text(raw, "clip_id"), hidden: bool(raw, "hidden") };
    case "set_speed":
      return { type, clip_id: text(raw, "clip_id"), speed_percent: int(raw, "speed_percent", SPEED_MIN, SPEED_MAX) };
    case "group": {
      const ids = raw["clip_ids"];
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && id.length > 0)) return fail("clip_ids");
      const unique = [...new Set(ids as string[])];
      if (unique.length < 2) return fail("clip_ids");
      return { type, clip_ids: unique };
    }
    case "ungroup":
      return { type, group_id: text(raw, "group_id") };
    case "add_row":
      return { type, name: text(raw, "name", 1, 60), kind: oneOf(raw, "kind", ["video", "audio", "caption"] as const) };
    case "reorder_row":
      return { type, row_id: text(raw, "row_id"), position: int(raw, "position", 1, 1000) };
    case "lock_row":
      return { type, row_id: text(raw, "row_id"), locked: bool(raw, "locked") };
    case "set_keyframe": {
      const property = oneOf(raw, "property", PROPERTIES);
      const value = raw["value"];
      const [low, high] = PROPERTY_RANGE[property];
      if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high) return fail("value");
      return {
        type,
        clip_id: text(raw, "clip_id"),
        property,
        frame: frame(raw, "frame"),
        value,
        curve: oneOf(raw, "curve", CURVES),
      };
    }
    case "remove_keyframe":
      return { type, clip_id: text(raw, "clip_id"), property: oneOf(raw, "property", PROPERTIES), frame: frame(raw, "frame") };
    case "add_marker":
      return { type, frame: frame(raw, "frame"), label: typeof raw["label"] === "string" ? text(raw, "label", 0, 40) : "" };
    case "set_layer": {
      const x = layerValue(raw, "x");
      const y = layerValue(raw, "y");
      const scale = layerValue(raw, "scale");
      if (x === undefined && y === undefined && scale === undefined) return fail("x");
      return {
        type,
        clip_id: text(raw, "clip_id"),
        frame: frame(raw, "frame"),
        ...(x === undefined ? {} : { x }),
        ...(y === undefined ? {} : { y }),
        ...(scale === undefined ? {} : { scale }),
      };
    }
    case "caption_add":
      return {
        type,
        row_id: text(raw, "row_id"),
        start_frame: frame(raw, "start_frame"),
        end_frame: frame(raw, "end_frame"),
        text: cueText(raw),
      };
    case "caption_edit":
      return {
        type,
        caption_id: text(raw, "caption_id"),
        start_frame: frame(raw, "start_frame"),
        end_frame: frame(raw, "end_frame"),
        text: cueText(raw),
      };
    case "caption_remove":
      return { type, caption_id: text(raw, "caption_id") };
    case "apply_kit":
      return { type, kit_id: text(raw, "kit_id") };
    case "set_aspect":
    case "restore_cut":
      if (!allowInternal) return fail("type");
      return type === "set_aspect"
        ? { type, aspect_ratio: oneOf(raw, "aspect_ratio", ASPECT_LABELS, FIELD_ERRORS.aspect_ratio) }
        : { type, cut_id: text(raw, "cut_id") };
    default:
      return fail("type");
  }
}
