import { SNAP_FRAMES } from "../../shared/limits";
import { BLOCKER, errorCopy } from "../../shared/copy";
import { shownValue, frameSize } from "../../shared/layers";
import { PROPERTY_RANGE, round2, type Diamond, type Curve, type Property } from "../../shared/keyframes";
import { notify } from "../lib/notices";
import type { ProjectStore } from "./store";
import { rateOfState, timelineOrder, type ProjectState } from "./state";

const currentClip = (state: ProjectState) => state.clips.find((clip) => clip.id === state.current);

/** One second of keyboard movement: the nominal rate in frames. */
export const oneSecond = (state: ProjectState): number => rateOfState(state).nominal;

export function nudge(store: ProjectStore, frames: number): void {
  void store.submit((state) => {
    const clip = currentClip(state);
    if (!clip) return null;
    const target = clip.start_frame + frames;
    if (target < 0) {
      notify(errorCopy("blocked", { clip: clip.name, reason: BLOCKER.timelineStart }));
      return null;
    }
    return { type: "move", clip_id: clip.id, start_frame: target, row_id: clip.row_id };
  });
}

export function splitAtPlayhead(store: ProjectStore): void {
  void store.submit((state) => {
    const clip = currentClip(state);
    if (!clip) return null;
    if (state.playhead <= clip.start_frame || state.playhead >= clip.end_frame) {
      notify(`Move the playhead inside ${clip.name} to split it.`);
      return null;
    }
    return { type: "split", clip_id: clip.id, at_frame: state.playhead };
  });
}

export function toggleHidden(store: ProjectStore): void {
  void store.submit((state) => {
    const clip = currentClip(state);
    return clip ? { type: "set_hidden", clip_id: clip.id, hidden: !clip.hidden } : null;
  });
}

/** After a remove, focus moves to the next clip on the row, else to the previous one. */
export function removeCurrent(store: ProjectStore, ripple: boolean): void {
  const before = store.s;
  const clip = currentClip(before);
  if (!clip) return;
  const row = timelineOrder(before.clips, before.rows).filter((candidate) => candidate.row_id === clip.row_id);
  const at = row.findIndex((candidate) => candidate.id === clip.id);
  const target = row[at + 1] ?? row[at - 1] ?? null;
  void store.submit(() => ({ type: "remove", clip_id: clip.id, ripple })).then((result) => {
    if (!result) return;
    store.setCurrent(target?.id ?? null, "replace");
    if (target) store.requestFocus(target.id);
  });
}

export function groupSelection(store: ProjectStore, ungroup: boolean): void {
  void store.submit((state) => {
    const clip = currentClip(state);
    if (!clip) return null;
    if (ungroup) return clip.group_id ? { type: "ungroup", group_id: clip.group_id } : null;
    const ids = [...new Set([clip.id, ...state.selection])];
    if (ids.length < 2) {
      notify("Select another clip with Enter, then group.");
      return null;
    }
    return { type: "group", clip_ids: ids };
  }).then((result) => {
    if (result) store.clearSelection();
  });
}

export function moveRow(store: ProjectStore, direction: -1 | 1): void {
  void store.submit((state) => {
    const clip = currentClip(state);
    const row = clip && state.rows.find((candidate) => candidate.id === clip.row_id);
    return row ? { type: "reorder_row", row_id: row.id, position: Math.max(1, row.position + direction) } : null;
  });
}

export function addMarker(store: ProjectStore): void {
  void store.submit((state) => ({ type: "add_marker", frame: state.playhead, label: "Marker" }));
}

export function lockRow(store: ProjectStore, rowId: string, locked: boolean): void {
  void store.submit(() => ({ type: "lock_row", row_id: rowId, locked }));
}

/** One `set_layer` op for the clip under the playhead; the frame is counted from the clip's own start. */
export function setLayer(store: ProjectStore, clipId: string, change: { x?: number; y?: number; scale?: number }): Promise<unknown> {
  return store.submit((state) => {
    const clip = state.clips.find((candidate) => candidate.id === clipId);
    if (!clip) return null;
    return { type: "set_layer", clip_id: clipId, frame: state.playhead - clip.start_frame, ...change };
  });
}

/** A layer property shifted by a step from its value at the playhead, clamped to its range. */
export function stepLayer(store: ProjectStore, clipId: string, property: "x" | "y" | "scale", step: number): void {
  void store.submit((state) => {
    const clip = state.clips.find((candidate) => candidate.id === clipId);
    if (!clip) return null;
    const size = frameSize(state.project.aspect_ratio);
    const value = shownValue(clip, property, state.playhead, size) + step;
    const [low, high] = PROPERTY_RANGE[property];
    return { type: "set_layer", clip_id: clipId, frame: state.playhead - clip.start_frame, [property]: Math.min(high, Math.max(low, round2(value))) };
  });
}

export function setKeyframe(store: ProjectStore, clipId: string, property: Property, value: number, curve: Curve): Promise<unknown> {
  return store.submit((state) => {
    const clip = state.clips.find((candidate) => candidate.id === clipId);
    if (!clip) return null;
    return { type: "set_keyframe", clip_id: clipId, property, frame: Math.max(0, state.playhead - clip.start_frame), value, curve };
  });
}

export function removeKeyframe(store: ProjectStore, clipId: string, property: Property): Promise<unknown> {
  return store.submit((state) => {
    const clip = state.clips.find((candidate) => candidate.id === clipId);
    if (!clip) return null;
    const frame = state.playhead - clip.start_frame;
    const diamonds: Diamond[] = clip.keyframes[property] ?? [];
    return diamonds.some((diamond) => diamond.frame === frame) ? { type: "remove_keyframe", clip_id: clipId, property, frame } : null;
  });
}

/** The frame a loupe centre locks to: the nearest clip edge, playhead or marker within the snap distance, the earlier on a tie. */
export function snapFrame(state: ProjectState, raw: number): { frame: number; snapped: boolean } {
  const targets = [...state.clips.flatMap((clip) => [clip.start_frame, clip.end_frame]), state.playhead, ...state.markers.map((marker) => marker.frame)];
  let best: number | null = null;
  for (const target of targets) {
    const distance = Math.abs(target - raw);
    if (distance > SNAP_FRAMES) continue;
    if (best === null || distance < Math.abs(best - raw) || (distance === Math.abs(best - raw) && target < best)) best = target;
  }
  return best === null ? { frame: raw, snapped: false } : { frame: best, snapped: true };
}
