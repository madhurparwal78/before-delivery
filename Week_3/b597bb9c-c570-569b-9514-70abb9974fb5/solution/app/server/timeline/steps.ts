import type { Clip } from "../../shared/types";
import { AppError } from "../errors";
import { trimBody, shiftGroup, splitClip, type EngineCtx } from "./engine";
import type { Effect, Patch, Step } from "./effects";
import {
  Draft,
  findOverlap,
  groupMembers,
  overlaps,
  type CaptionRec,
  type Diff,
  type RowRec,
} from "./model";
import { assertUnlocked } from "./model";

type Restore = Extract<Step, { k: "restore" }>;

function changedFields<T extends object>(before: T, after: T): (keyof T)[] {
  return (Object.keys(after) as (keyof T)[]).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function patches<T extends { id: string }>(
  originals: Map<string, T | null>,
  current: (id: string) => T | undefined,
): { forward: Record<string, Patch<T>>; inverse: Record<string, Patch<T>> } {
  const forward: Record<string, Patch<T>> = {};
  const inverse: Record<string, Patch<T>> = {};
  for (const [id, before] of originals) {
    const after = current(id) ?? null;
    if (before && after) {
      const keys = changedFields(before, after);
      forward[id] = { mode: "patch", fields: Object.fromEntries(keys.map((key) => [key, after[key]])) as Partial<T> };
      inverse[id] = { mode: "patch", fields: Object.fromEntries(keys.map((key) => [key, before[key]])) as Partial<T> };
    } else if (before) {
      forward[id] = { mode: "drop" };
      inverse[id] = { mode: "put", value: before };
    } else if (after) {
      forward[id] = { mode: "put", value: after };
      inverse[id] = { mode: "drop" };
    }
  }
  return { forward, inverse };
}

/** The default undo and redo of an op: restore exactly the fields it changed. */
export function restoreSteps(diff: Diff, draft: Draft): { forward: Restore; inverse: Restore } {
  const clips = patches(diff.clipBefore, (id) => draft.clips.get(id));
  const captions = patches(diff.captionBefore, (id) => draft.captions.get(id));
  const rows = patches(diff.rowBefore, (id) => draft.rows.get(id));
  const names: Record<string, string> = {};
  for (const [id, clip] of diff.clipBefore) names[id] = (clip ?? draft.clips.get(id))?.name ?? id;
  const make = (side: "forward" | "inverse"): Restore => ({
    k: "restore",
    clips: clips[side],
    captions: captions[side],
    rows: rows[side],
    markers: side === "forward" ? (diff.markersBefore ? draft.markers : null) : diff.markersBefore,
    aspect: side === "forward" ? (diff.aspectBefore ? draft.aspect : null) : diff.aspectBefore,
    pins: [],
    names,
  });
  return { forward: make("forward"), inverse: make("inverse") };
}

function overlapError(draft: Draft, hit: Clip | CaptionRec, rowId: string): AppError {
  const name = "name" in hit ? hit.name : "Caption";
  return new AppError("undo_blocked", { clip: name, row: draft.row(rowId).name });
}

function applyRestore(draft: Draft, step: Restore): Effect {
  const touchedClips = new Set<string>();
  const touchedCaptions = new Set<string>();
  const nameOf = (id: string): string => step.names[id] ?? id;
  for (const [id, patch] of Object.entries(step.clips)) {
    if (patch.mode === "patch") {
      if (!draft.clips.has(id)) throw new AppError("undo_missing", { clip: nameOf(id) });
      Object.assign(draft.editClip(id), patch.fields);
    } else if (patch.mode === "put") {
      if (draft.clips.has(id)) draft.editClip(id);
      draft.putClip(structuredClone(patch.value));
    } else {
      if (!draft.clips.has(id)) throw new AppError("undo_missing", { clip: nameOf(id) });
      draft.dropClip(id);
    }
    touchedClips.add(id);
  }
  for (const [id, patch] of Object.entries(step.captions)) {
    if (patch.mode === "patch") {
      if (!draft.captions.has(id)) throw new AppError("undo_missing", { clip: "a caption" });
      Object.assign(draft.editCaption(id), patch.fields);
    } else if (patch.mode === "put") {
      if (draft.captions.has(id)) draft.editCaption(id);
      draft.putCaption(structuredClone(patch.value));
    } else if (draft.captions.has(id)) {
      draft.dropCaption(id);
    }
    touchedCaptions.add(id);
  }
  for (const [id, patch] of Object.entries(step.rows)) {
    if (patch.mode === "patch") Object.assign(draft.editRow(id), patch.fields);
    else if (patch.mode === "put") draft.putRow(structuredClone(patch.value) as RowRec);
    else {
      if ([...draft.clips.values()].some((clip) => clip.row_id === id)) throw new AppError("undo_blocked", { clip: "a clip", row: draft.row(id).name });
      draft.editRow(id);
      draft.rows.delete(id);
    }
  }
  if (step.markers) draft.setMarkers(structuredClone(step.markers));
  if (step.aspect) draft.setAspect(step.aspect);
  for (const id of touchedClips) {
    const clip = draft.clips.get(id);
    if (!clip) continue;
    assertUnlocked(draft, clip.row_id);
    const hit = findOverlap(draft, clip.row_id, clip.start_frame, clip.end_frame, new Set([id]));
    if (hit) throw overlapError(draft, hit, clip.row_id);
  }
  for (const id of touchedCaptions) {
    const caption = draft.captions.get(id);
    if (!caption) continue;
    assertUnlocked(draft, caption.row_id);
    for (const other of draft.captions.values()) {
      if (other.id !== id && other.row_id === caption.row_id && overlaps(other.start_frame, other.end_frame, caption.start_frame, caption.end_frame)) {
        throw new AppError("undo_blocked", { clip: "a caption", row: draft.row(caption.row_id).name });
      }
    }
  }
  return { summary: restoreSummary(draft, step), stopped: null, pins: [], extraTouched: [] };
}

function restoreSummary(draft: Draft, step: Restore): Effect["summary"] {
  if (step.aspect) return { type: "set_aspect", aspect_ratio: step.aspect };
  const entries = Object.entries(step.clips);
  const only = entries.length === 1 ? entries[0] : undefined;
  if (only) {
    const [id, patch] = only;
    const name = step.names[id] ?? id;
    if (patch.mode === "drop") return { type: "remove", clip_name: name };
    if (patch.mode === "patch" && Object.keys(patch.fields).join() === "hidden") {
      return { type: patch.fields.hidden ? "hide" : "show", clip_name: draft.clips.get(id)?.name ?? name };
    }
  }
  return { type: "edit" };
}

/** Applies a stored undo or redo step to the timeline as it is now, or throws the published refusal. */
export function applyStep(draft: Draft, step: Step, ctx: EngineCtx): Effect {
  switch (step.k) {
    case "restore":
      return applyRestore(draft, step);
    case "shift": {
      const clip = draft.clips.get(step.clip_id);
      if (!clip) throw new AppError("undo_missing", { clip: step.clip_name });
      if (step.row_id && step.row_id !== clip.row_id) {
        const length = clip.end_frame - clip.start_frame;
        assertUnlocked(draft, clip.row_id);
        assertUnlocked(draft, step.row_id);
        const start = clip.start_frame + step.delta;
        const hit = findOverlap(draft, step.row_id, start, start + length, new Set([clip.id]));
        if (start < 0 || hit) throw new AppError("undo_blocked", { clip: hit?.name ?? clip.name, row: draft.row(step.row_id).name });
        const live = draft.editClip(clip.id);
        live.row_id = step.row_id;
        live.start_frame = start;
        live.end_frame = start + length;
      } else {
        shiftGroup(draft, clip, step.delta, "undo");
      }
      return { summary: { type: "move", clip_name: clip.name, at_frame: draft.clip(clip.id).start_frame }, stopped: null, pins: [], extraTouched: [] };
    }
    case "trim": {
      const clip = draft.clips.get(step.clip_id);
      if (!clip) throw new AppError("undo_missing", { clip: step.clip_name });
      try {
        const effect = trimBody(draft, { type: "trim", clip_id: clip.id, edge: step.edge, delta_frames: step.delta, ripple: false }, ctx);
        if (effect.stopped) throw new AppError("undo_blocked", { clip: clip.name, row: draft.row(clip.row_id).name });
        return { ...effect, steps: undefined };
      } catch (error) {
        if (error instanceof AppError && (error.code === "blocked" || error.code === "group_blocked")) {
          throw new AppError("undo_blocked", { clip: clip.name, row: draft.row(clip.row_id).name });
        }
        throw error;
      }
    }
    case "join": {
      const left = draft.clips.get(step.left_id);
      const right = draft.clips.get(step.right_id);
      if (!left) throw new AppError("undo_missing", { clip: step.left_name });
      if (!right) throw new AppError("undo_missing", { clip: step.left_name });
      if (left.row_id !== right.row_id || left.end_frame !== right.start_frame) {
        throw new AppError("undo_blocked", { clip: right.name, row: draft.row(right.row_id).name });
      }
      assertUnlocked(draft, left.row_id);
      const liveLeft = draft.editClip(left.id);
      liveLeft.end_frame = right.end_frame;
      liveLeft.source_out = right.source_out;
      draft.dropClip(right.id);
      if (right.group_id) {
        const rest = groupMembers(draft, right.group_id);
        if (rest.length === 1 && rest[0]) draft.editClip(rest[0].id).group_id = null;
      }
      return { summary: { type: "edit" }, stopped: null, pins: [], extraTouched: [] };
    }
    case "resplit": {
      const clip = draft.clips.get(step.clip_id);
      if (!clip) throw new AppError("undo_missing", { clip: step.clip_name });
      if (step.at_frame <= clip.start_frame || step.at_frame >= clip.end_frame) {
        throw new AppError("undo_blocked", { clip: clip.name, row: draft.row(clip.row_id).name });
      }
      assertUnlocked(draft, clip.row_id);
      splitClip(draft, clip, step.at_frame, step.right_id);
      return { summary: { type: "split", clip_name: clip.name, at_frame: step.at_frame }, stopped: null, pins: [], extraTouched: [step.right_id] };
    }
  }
}
