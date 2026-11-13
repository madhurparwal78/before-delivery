import { BLOCKER, FIELD_ERRORS } from "../../shared/copy";
import { interpolate, type Diamond, type Property } from "../../shared/keyframes";
import { frameSize } from "../../shared/layers";
import {
  PNG_CLIP_SECONDS,
  PNG_SOURCE_SECONDS,
} from "../../shared/limits";
import { decimalToFraction, lengthAtSpeed, roundExact, secondsToFrames, sourceAtSpeed } from "../../shared/rational";
import type { Clip, Kit, Marker } from "../../shared/types";
import { ASPECTS } from "../../shared/types";
import { AppError, invalid } from "../errors";
import { newId } from "../ids";
import { edit, type Effect, type PinEffect } from "./effects";
import {
  Draft,
  assertUnlocked,
  blockedBy,
  clipsOnRow,
  findOverlap,
  groupMembers,
  inTheWay,
  overlaps,
  type CaptionRec,
  type MediaInfo,
  type RowRec,
} from "./model";
import type { OpBody, ParsedCue } from "../../shared/ops";

export interface CutSnapshot {
  rows: RowRec[];
  clips: Clip[];
  captions: CaptionRec[];
}

export interface EngineCtx {
  media: Map<string, MediaInfo>;
  kit: Kit | null;
  cut: { name: string; snapshot: CutSnapshot } | null;
}

const DEFAULT_TEXT = { text_colour: "ffffff", box_colour: "000000", font_weight: 600 } as const;
const NAME_MAX = 60;

function sourceLimit(draft: Draft, clip: Clip, ctx: EngineCtx): number {
  if (clip.kind === "text") return Number.POSITIVE_INFINITY;
  if (clip.kind === "png") return secondsToFrames(draft.rate, BigInt(PNG_SOURCE_SECONDS), 1n);
  const media = clip.media_id ? ctx.media.get(clip.media_id) : undefined;
  return media ? secondsToFrames(draft.rate, media.src_num, media.src_den) : clip.source_out;
}

function sourceFramesOf(draft: Draft, media: MediaInfo): number {
  return media.kind === "png"
    ? secondsToFrames(draft.rate, BigInt(PNG_CLIP_SECONDS), 1n)
    : secondsToFrames(draft.rate, media.src_num, media.src_den);
}

function clipLabel(name: string): string {
  return [...name].slice(0, NAME_MAX).join("");
}

function captionName(draft: Draft, caption: CaptionRec): string {
  const ordered = [...draft.captions.values()]
    .filter((candidate) => candidate.row_id === caption.row_id)
    .sort((a, b) => a.start_frame - b.start_frame);
  return `Caption ${ordered.findIndex((candidate) => candidate.id === caption.id) + 1}`;
}

function touchRow(draft: Draft, clip: Clip): void {
  assertUnlocked(draft, clip.row_id);
}

function rowAccepts(row: RowRec, clip: Clip): boolean {
  if (clip.kind === "wav") return row.kind === "audio";
  return row.kind === "video";
}

/** Moves a clip within the ripple rules: every later item on its row, and every member of their groups, shifts. */
function ripple(draft: Draft, source: Clip, editPoint: number, delta: number, ignore: ReadonlySet<string>): PinEffect {
  const shifting = new Map<string, Clip>();
  for (const clip of clipsOnRow(draft, source.row_id)) {
    if (!ignore.has(clip.id) && clip.start_frame >= editPoint) shifting.set(clip.id, clip);
  }
  for (const clip of [...shifting.values()]) {
    if (clip.group_id) for (const member of groupMembers(draft, clip.group_id)) if (!ignore.has(member.id)) shifting.set(member.id, member);
  }
  for (const clip of shifting.values()) assertUnlocked(draft, clip.row_id);
  const moving = new Set([...shifting.keys(), ...ignore]);
  for (const clip of shifting.values()) {
    if (clip.start_frame + delta < 0) throw blockedBy(clip, BLOCKER.timelineStart);
    const hit = findOverlap(draft, clip.row_id, clip.start_frame + delta, clip.end_frame + delta, moving);
    if (hit) throw blockedBy(clip, inTheWay(hit));
  }
  for (const clip of shifting.values()) {
    const live = draft.editClip(clip.id);
    live.start_frame += delta;
    live.end_frame += delta;
  }
  return { kind: "shift", row_id: source.row_id, from_frame: editPoint, delta };
}

function fixGroupAfterRemoval(draft: Draft, groupId: string | null): void {
  if (!groupId) return;
  const rest = groupMembers(draft, groupId);
  if (rest.length === 1 && rest[0]) draft.editClip(rest[0].id).group_id = null;
}

export function applyBody(draft: Draft, body: OpBody, ctx: EngineCtx): Effect {
  switch (body.type) {
    case "add_clip":
      return addClip(draft, body, ctx);
    case "add_text":
      return addText(draft, body);
    case "move":
      return move(draft, body);
    case "trim":
      return trimBody(draft, body, ctx);
    case "split":
      return split(draft, body);
    case "remove":
      return remove(draft, body);
    case "set_hidden": {
      const clip = draft.editClip(body.clip_id);
      touchRow(draft, clip);
      clip.hidden = body.hidden;
      return { ...edit(body.hidden ? "hide" : "show"), summary: { type: body.hidden ? "hide" : "show", clip_name: clip.name } };
    }
    case "set_speed":
      return setSpeed(draft, body);
    case "group":
      return group(draft, body);
    case "ungroup":
      return ungroup(draft, body);
    case "add_row": {
      const position = Math.max(0, ...[...draft.rows.values()].map((row) => row.position)) + 1;
      draft.putRow({ id: newId("r"), name: body.name, kind: body.kind, position, locked: false, srt_eol: "\n", srt_bom: false });
      return edit();
    }
    case "reorder_row":
      return reorderRow(draft, body.row_id, body.position);
    case "lock_row":
      draft.editRow(body.row_id).locked = body.locked;
      return edit();
    case "set_keyframe":
      return setKeyframe(draft, body);
    case "remove_keyframe": {
      const clip = draft.editClip(body.clip_id);
      touchRow(draft, clip);
      const kept = (clip.keyframes[body.property] ?? []).filter((diamond) => diamond.frame !== body.frame);
      if (kept.length === (clip.keyframes[body.property] ?? []).length) throw invalid({ frame: FIELD_ERRORS.other });
      if (kept.length) clip.keyframes[body.property] = kept;
      else delete clip.keyframes[body.property];
      return edit();
    }
    case "add_marker": {
      const markers: Marker[] = draft.markers.filter((marker) => marker.frame !== body.frame);
      markers.push({ frame: body.frame, label: body.label });
      draft.setMarkers(markers.sort((a, b) => a.frame - b.frame));
      return edit();
    }
    case "set_layer":
      return setLayer(draft, body);
    case "caption_add":
      return captionAdd(draft, body);
    case "caption_edit":
      return captionEdit(draft, body);
    case "caption_remove": {
      const caption = draft.editCaption(body.caption_id);
      assertUnlocked(draft, caption.row_id);
      draft.dropCaption(caption.id);
      return edit();
    }
    case "apply_kit": {
      if (!ctx.kit) throw new AppError("not_found");
      for (const clip of draft.clips.values()) {
        if (clip.kind !== "text") continue;
        assertUnlocked(draft, clip.row_id);
        const live = draft.editClip(clip.id);
        live.text_colour = ctx.kit.text_colour;
        live.box_colour = ctx.kit.box_colour;
        live.font_weight = ctx.kit.font_weight;
      }
      return edit();
    }
    case "set_aspect":
      return setAspect(draft, body.aspect_ratio);
    case "restore_cut":
      return restoreCut(draft, ctx);
    case "import_captions":
      return importCaptions(draft, body.row_id, body.cues, body.eol, body.bom);
  }
}

function addClip(draft: Draft, body: Extract<OpBody, { type: "add_clip" }>, ctx: EngineCtx): Effect {
  const media = ctx.media.get(body.media_id);
  if (!media) throw new AppError("not_found");
  const row = draft.row(body.row_id);
  assertUnlocked(draft, row.id);
  const length = sourceFramesOf(draft, media);
  const clip: Clip = {
    id: newId("c"),
    row_id: row.id,
    name: clipLabel(media.name.replace(/\.[^.]+$/, "")),
    kind: media.kind,
    media_id: media.id,
    start_frame: body.start_frame,
    end_frame: body.start_frame + length,
    source_in: 0,
    source_out: length,
    speed_percent: 100,
    hidden: false,
    group_id: null,
    text: null,
    text_colour: null,
    box_colour: null,
    font_weight: null,
    keyframes: {},
    base: {},
  };
  if (!rowAccepts(row, clip)) throw invalid({ row_id: FIELD_ERRORS.other });
  const hit = findOverlap(draft, row.id, clip.start_frame, clip.end_frame, new Set());
  if (hit) throw blockedBy(clip, inTheWay(hit));
  draft.putClip(clip);
  return { ...edit("add"), summary: { type: "add", clip_name: clip.name } };
}

function addText(draft: Draft, body: Extract<OpBody, { type: "add_text" }>): Effect {
  const row = draft.row(body.row_id);
  if (row.kind !== "video") throw invalid({ row_id: FIELD_ERRORS.other });
  assertUnlocked(draft, row.id);
  const clip: Clip = {
    id: newId("c"),
    row_id: row.id,
    name: clipLabel(body.text),
    kind: "text",
    media_id: null,
    start_frame: body.start_frame,
    end_frame: body.end_frame,
    source_in: 0,
    source_out: body.end_frame - body.start_frame,
    speed_percent: 100,
    hidden: false,
    group_id: null,
    text: body.text,
    ...DEFAULT_TEXT,
    keyframes: {},
    base: {},
  };
  const hit = findOverlap(draft, row.id, clip.start_frame, clip.end_frame, new Set());
  if (hit) throw blockedBy(clip, inTheWay(hit));
  draft.putClip(clip);
  return { ...edit("add"), summary: { type: "add", clip_name: clip.name } };
}

function move(draft: Draft, body: Extract<OpBody, { type: "move" }>): Effect {
  const clip = draft.clip(body.clip_id);
  const target = draft.row(body.row_id);
  const length = clip.end_frame - clip.start_frame;
  const from = { start: clip.start_frame, row: clip.row_id };
  if (clip.group_id) {
    if (target.id !== clip.row_id) throw invalid({ row_id: FIELD_ERRORS.other });
    return moveGroup(draft, clip, body.start_frame - clip.start_frame);
  }
  assertUnlocked(draft, clip.row_id);
  if (target.id !== clip.row_id) {
    if (!rowAccepts(target, clip)) throw invalid({ row_id: FIELD_ERRORS.other });
    assertUnlocked(draft, target.id);
    if (findOverlap(draft, target.id, body.start_frame, body.start_frame + length, new Set([clip.id]))) {
      throw blockedBy(clip, BLOCKER.targetRow);
    }
    const live = draft.editClip(clip.id);
    live.row_id = target.id;
    live.start_frame = body.start_frame;
    live.end_frame = body.start_frame + length;
    return moved(clip.name, live.start_frame, from, live, null);
  }
  const requested = body.start_frame;
  if (requested === clip.start_frame) throw invalid({ start_frame: FIELD_ERRORS.other });
  const others = clipsOnRow(draft, clip.row_id).filter((other) => other.id !== clip.id);
  let final = requested;
  let blocker: Clip | null = null;
  if (requested > clip.start_frame) {
    const next = others.find((other) => other.start_frame >= clip.end_frame);
    if (next && requested + length > next.start_frame) {
      final = next.start_frame - length;
      blocker = next;
    }
  } else {
    const previous = [...others].reverse().find((other) => other.end_frame <= clip.start_frame);
    if (previous && requested < previous.end_frame) {
      final = previous.end_frame;
      blocker = previous;
    }
  }
  if (final === clip.start_frame && blocker) throw blockedBy(clip, inTheWay(blocker));
  const live = draft.editClip(clip.id);
  live.start_frame = final;
  live.end_frame = final + length;
  return moved(clip.name, final, from, live, blocker ? { at_frame: final, reason: inTheWay(blocker) } : null);
}

function moved(
  name: string,
  at: number,
  from: { start: number; row: string },
  live: Clip,
  stopped: { at_frame: number; reason: string } | null,
): Effect {
  const delta = live.start_frame - from.start;
  return {
    summary: { type: "move", clip_name: name, at_frame: at },
    stopped,
    steps: {
      forward: { k: "shift", clip_id: live.id, clip_name: name, delta, row_id: live.row_id === from.row ? null : live.row_id },
      inverse: { k: "shift", clip_id: live.id, clip_name: name, delta: -delta, row_id: live.row_id === from.row ? null : from.row },
    },
    pins: [],
    extraTouched: [],
  };
}

function moveGroup(draft: Draft, clip: Clip, delta: number): Effect {
  if (delta === 0) throw invalid({ start_frame: FIELD_ERRORS.other });
  shiftGroup(draft, clip, delta, "group");
  const live = draft.clip(clip.id);
  return moved(clip.name, live.start_frame, { start: clip.start_frame, row: clip.row_id }, live, null);
}

/** Shifts every member of the clip's group by the same frames, or throws naming the first member that cannot go. */
export function shiftGroup(draft: Draft, clip: Clip, delta: number, mode: "group" | "undo"): void {
  const members = clip.group_id ? groupMembers(draft, clip.group_id) : [clip];
  const ids = new Set(members.map((member) => member.id));
  for (const member of members) {
    const row = draft.row(member.row_id);
    const reason = row.locked
      ? BLOCKER.locked(row.name)
      : member.start_frame + delta < 0
        ? BLOCKER.timelineStart
        : (() => {
            const hit = findOverlap(draft, member.row_id, member.start_frame + delta, member.end_frame + delta, ids);
            return hit ? inTheWay(hit) : null;
          })();
    if (reason === null) continue;
    if (mode === "group") throw new AppError("group_blocked", { member: member.name, reason });
    const hit = findOverlap(draft, member.row_id, member.start_frame + delta, member.end_frame + delta, ids);
    if (row.locked) throw new AppError("row_locked", { row: row.name });
    throw new AppError("undo_blocked", { clip: hit?.name ?? member.name, row: row.name });
  }
  for (const member of members) {
    const live = draft.editClip(member.id);
    live.start_frame += delta;
    live.end_frame += delta;
  }
}

interface TrimResult {
  start: number;
  end: number;
  sourceIn: number;
  sourceOut: number;
  reason: string | null;
}

function trimClip(draft: Draft, clip: Clip, edge: "start" | "end", delta: number, ctx: EngineCtx, free: boolean): TrimResult {
  const others = clipsOnRow(draft, clip.row_id).filter((other) => other.id !== clip.id);
  const limit = sourceLimit(draft, clip, ctx);
  let applied = delta;
  let reason: string | null = null;
  const speed = clip.speed_percent;
  const clamp = (value: number, why: string | null): void => {
    if (value !== applied) {
      applied = value;
      reason = why;
    }
  };
  if (edge === "end") {
    if (delta > 0) {
      const next = free ? undefined : others.find((other) => other.start_frame >= clip.end_frame);
      if (next) clamp(Math.min(applied, next.start_frame - clip.end_frame), inTheWay(next));
      const room = limit - clip.source_out;
      if (sourceAtSpeed(applied, speed) > room) clamp(lengthAtSpeed(room, speed), BLOCKER.sourceEnd);
    } else {
      const shortest = 1 - (clip.end_frame - clip.start_frame);
      clamp(Math.max(applied, shortest), BLOCKER.newLength);
    }
    const sourceDelta = sourceAtSpeed(applied, speed);
    return { start: clip.start_frame, end: clip.end_frame + applied, sourceIn: clip.source_in, sourceOut: clip.source_out + sourceDelta, reason };
  }
  if (delta < 0) {
    const previous = [...others].reverse().find((other) => other.end_frame <= clip.start_frame);
    const floor = previous ? previous.end_frame : 0;
    if (clip.start_frame + applied < floor) clamp(floor - clip.start_frame, previous ? inTheWay(previous) : BLOCKER.timelineStart);
    if (clip.source_in + sourceAtSpeed(applied, speed) < 0) clamp(-lengthAtSpeed(clip.source_in, speed), BLOCKER.sourceStart);
  } else {
    clamp(Math.min(applied, clip.end_frame - clip.start_frame - 1), BLOCKER.newLength);
  }
  const sourceDelta = sourceAtSpeed(applied, speed);
  return { start: clip.start_frame + applied, end: clip.end_frame, sourceIn: clip.source_in + sourceDelta, sourceOut: clip.source_out, reason };
}

export function trimBody(draft: Draft, body: Extract<OpBody, { type: "trim" }>, ctx: EngineCtx): Effect {
  const clip = draft.clip(body.clip_id);
  if (body.ripple && body.edge !== "end") throw invalid({ ripple: FIELD_ERRORS.other });
  if (body.ripple && clip.group_id) throw invalid({ ripple: FIELD_ERRORS.other });
  const members = clip.group_id ? groupMembers(draft, clip.group_id) : [clip];
  const results = new Map<string, TrimResult>();
  for (const member of members) {
    const row = draft.row(member.row_id);
    if (row.locked) {
      if (clip.group_id) throw new AppError("group_blocked", { member: member.name, reason: BLOCKER.locked(row.name) });
      throw new AppError("row_locked", { row: row.name });
    }
    const result = trimClip(draft, member, body.edge, body.delta_frames, ctx, body.ripple);
    const changed = result.start !== member.start_frame || result.end !== member.end_frame;
    if (clip.group_id && (result.reason || !changed)) {
      throw new AppError("group_blocked", { member: member.name, reason: result.reason ?? BLOCKER.newLength });
    }
    results.set(member.id, result);
  }
  const own = results.get(clip.id);
  if (!own) throw new AppError("not_found");
  const appliedDelta = body.edge === "end" ? own.end - clip.end_frame : own.start - clip.start_frame;
  if (appliedDelta === 0) throw blockedBy(clip, own.reason ?? BLOCKER.newLength);
  const pins: PinEffect[] = [];
  const editPoint = clip.end_frame;
  for (const member of members) {
    const result = results.get(member.id);
    if (!result) continue;
    const live = draft.editClip(member.id);
    live.start_frame = result.start;
    live.end_frame = result.end;
    live.source_in = result.sourceIn;
    live.source_out = result.sourceOut;
  }
  if (body.ripple) pins.push(ripple(draft, clip, editPoint, appliedDelta, new Set([clip.id])));
  const at = body.edge === "end" ? own.end : own.start;
  const effect: Effect = {
    summary: { type: "trim", clip_name: clip.name, at_frame: at },
    stopped: own.reason ? { at_frame: at, reason: own.reason } : null,
    pins,
    extraTouched: [],
  };
  if (!body.ripple) {
    effect.steps = {
      forward: { k: "trim", clip_id: clip.id, clip_name: clip.name, edge: body.edge, delta: appliedDelta },
      inverse: { k: "trim", clip_id: clip.id, clip_name: clip.name, edge: body.edge, delta: -appliedDelta },
    };
  }
  return effect;
}

/** Re-bases the diamonds of a split: those at or after the cut move to the right part, with the held value at its start. */
function rebase(diamonds: Diamond[] | undefined, offset: number): Diamond[] | undefined {
  if (!diamonds?.length) return undefined;
  const later = diamonds.filter((diamond) => diamond.frame >= offset).map((diamond) => ({ ...diamond, frame: diamond.frame - offset }));
  if (later.some((diamond) => diamond.frame === 0)) return later;
  const held = interpolate(diamonds, offset);
  const before = [...diamonds].sort((a, b) => a.frame - b.frame).filter((diamond) => diamond.frame < offset).pop();
  return held === null ? later : [{ frame: 0, value: held, curve: before?.curve ?? "linear" }, ...later];
}

export function splitClip(draft: Draft, clip: Clip, at: number, rightId: string): Clip {
  const live = draft.editClip(clip.id);
  const sourceSplit = live.source_in + sourceAtSpeed(at - live.start_frame, live.speed_percent);
  const right: Clip = structuredClone(live);
  right.id = rightId;
  right.start_frame = at;
  right.source_in = sourceSplit;
  right.keyframes = {};
  for (const property of Object.keys(live.keyframes) as Property[]) {
    const diamonds = rebase(live.keyframes[property], at - live.start_frame);
    if (diamonds) right.keyframes[property] = diamonds;
  }
  live.end_frame = at;
  live.source_out = sourceSplit;
  draft.putClip(right);
  return right;
}

function split(draft: Draft, body: Extract<OpBody, { type: "split" }>): Effect {
  const clip = draft.clip(body.clip_id);
  touchRow(draft, clip);
  if (body.at_frame <= clip.start_frame || body.at_frame >= clip.end_frame) throw invalid({ at_frame: FIELD_ERRORS.other });
  const rightId = newId("c");
  splitClip(draft, clip, body.at_frame, rightId);
  return {
    summary: { type: "split", clip_name: clip.name, at_frame: body.at_frame },
    stopped: null,
    steps: {
      forward: { k: "resplit", clip_id: clip.id, clip_name: clip.name, at_frame: body.at_frame, right_id: rightId },
      inverse: { k: "join", left_id: clip.id, right_id: rightId, left_name: clip.name },
    },
    pins: [],
    extraTouched: [rightId],
  };
}

function remove(draft: Draft, body: Extract<OpBody, { type: "remove" }>): Effect {
  const clip = draft.clip(body.clip_id);
  touchRow(draft, clip);
  const pins: PinEffect[] = [{ kind: "freeze", clip_id: clip.id, start_frame: clip.start_frame }];
  const length = clip.end_frame - clip.start_frame;
  const groupId = clip.group_id;
  draft.dropClip(clip.id);
  fixGroupAfterRemoval(draft, groupId);
  if (body.ripple) pins.push(ripple(draft, clip, clip.end_frame, -length, new Set([clip.id])));
  return { summary: { type: "remove", clip_name: clip.name }, stopped: null, pins, extraTouched: groupId ? [`g:${groupId}`] : [] };
}

function setSpeed(draft: Draft, body: Extract<OpBody, { type: "set_speed" }>): Effect {
  const clip = draft.clip(body.clip_id);
  if (clip.kind === "text") throw invalid({ clip_id: FIELD_ERRORS.other });
  touchRow(draft, clip);
  const length = Math.max(1, lengthAtSpeed(clip.source_out - clip.source_in, body.speed_percent));
  if (findOverlap(draft, clip.row_id, clip.start_frame, clip.start_frame + length, new Set([clip.id]))) {
    throw blockedBy(clip, BLOCKER.newLength);
  }
  const live = draft.editClip(clip.id);
  live.speed_percent = body.speed_percent;
  live.end_frame = clip.start_frame + length;
  return edit("speed");
}

function group(draft: Draft, body: Extract<OpBody, { type: "group" }>): Effect {
  const chosen = body.clip_ids.map((id) => draft.clip(id));
  const groupIds = new Set(chosen.flatMap((clip) => (clip.group_id ? [clip.group_id] : [])));
  const members = new Map(chosen.map((clip) => [clip.id, clip]));
  for (const id of groupIds) for (const member of groupMembers(draft, id)) members.set(member.id, member);
  for (const member of members.values()) touchRow(draft, member);
  const id = newId("g");
  for (const member of members.values()) draft.editClip(member.id).group_id = id;
  return { ...edit("group"), extraTouched: [...groupIds].map((existing) => `g:${existing}`) };
}

function ungroup(draft: Draft, body: Extract<OpBody, { type: "ungroup" }>): Effect {
  const members = groupMembers(draft, body.group_id);
  if (!members.length) throw new AppError("not_found");
  for (const member of members) touchRow(draft, member);
  for (const member of members) draft.editClip(member.id).group_id = null;
  return { ...edit("ungroup"), extraTouched: [`g:${body.group_id}`] };
}

function reorderRow(draft: Draft, rowId: string, position: number): Effect {
  const ordered = draft.rowsInOrder();
  const row = draft.row(rowId);
  const without = ordered.filter((candidate) => candidate.id !== rowId);
  without.splice(Math.min(position, ordered.length) - 1, 0, row);
  without.forEach((candidate, index) => {
    if (candidate.position !== index + 1) draft.editRow(candidate.id).position = index + 1;
  });
  return edit();
}

function setKeyframe(draft: Draft, body: Extract<OpBody, { type: "set_keyframe" }>): Effect {
  const clip = draft.editClip(body.clip_id);
  touchRow(draft, clip);
  const diamonds = (clip.keyframes[body.property] ?? []).filter((diamond) => diamond.frame !== body.frame);
  diamonds.push({ frame: body.frame, value: body.value, curve: body.curve });
  clip.keyframes[body.property] = diamonds.sort((a, b) => a.frame - b.frame);
  return edit("set_keyframe");
}

function setLayer(draft: Draft, body: Extract<OpBody, { type: "set_layer" }>): Effect {
  const clip = draft.editClip(body.clip_id);
  if (clip.kind === "wav") throw invalid({ clip_id: FIELD_ERRORS.other });
  touchRow(draft, clip);
  if (body.frame >= clip.end_frame - clip.start_frame) throw invalid({ frame: FIELD_ERRORS.other });
  for (const property of ["x", "y", "scale"] as const) {
    const value = body[property];
    if (value === undefined) continue;
    const existing = clip.keyframes[property];
    if (existing?.length) {
      const kept = existing.find((diamond) => diamond.frame === body.frame);
      clip.keyframes[property] = [...existing.filter((diamond) => diamond.frame !== body.frame), { frame: body.frame, value, curve: kept?.curve ?? "linear" }].sort(
        (a, b) => a.frame - b.frame,
      );
    } else {
      clip.base[property] = value;
    }
  }
  return { ...edit("set_layer"), summary: { type: "set_layer", clip_name: clip.name } };
}

function captionRow(draft: Draft, rowId: string): RowRec {
  const row = draft.row(rowId);
  if (row.kind !== "caption") throw invalid({ row_id: FIELD_ERRORS.other });
  assertUnlocked(draft, row.id);
  return row;
}

function assertCaptionFree(draft: Draft, caption: CaptionRec): void {
  for (const other of draft.captions.values()) {
    if (other.id !== caption.id && other.row_id === caption.row_id && overlaps(other.start_frame, other.end_frame, caption.start_frame, caption.end_frame)) {
      throw new AppError("blocked", { clip: captionName(draft, caption), reason: BLOCKER.inTheWay(captionName(draft, other)) });
    }
  }
}

function captionAdd(draft: Draft, body: Extract<OpBody, { type: "caption_add" }>): Effect {
  captionRow(draft, body.row_id);
  if (body.end_frame <= body.start_frame) throw invalid({ end_frame: FIELD_ERRORS.other });
  const caption: CaptionRec = {
    id: newId("cap"),
    row_id: body.row_id,
    start_frame: body.start_frame,
    end_frame: body.end_frame,
    text: body.text,
    orig_start_ms: null,
    orig_end_ms: null,
  };
  draft.putCaption(caption);
  assertCaptionFree(draft, caption);
  return edit();
}

function captionEdit(draft: Draft, body: Extract<OpBody, { type: "caption_edit" }>): Effect {
  const caption = draft.editCaption(body.caption_id);
  captionRow(draft, caption.row_id);
  if (body.end_frame <= body.start_frame) throw invalid({ end_frame: FIELD_ERRORS.other });
  if (caption.start_frame !== body.start_frame || caption.end_frame !== body.end_frame) {
    caption.orig_start_ms = null;
    caption.orig_end_ms = null;
  }
  caption.start_frame = body.start_frame;
  caption.end_frame = body.end_frame;
  caption.text = body.text;
  assertCaptionFree(draft, caption);
  return edit();
}

/** A position scaled by new frame size over old, by the rounding rule on the exact decimal. */
function roundScaled(value: number, num: number, den: number): number {
  const exact = decimalToFraction(value.toFixed(6));
  return roundExact(exact.num * BigInt(num), exact.den * BigInt(den));
}

function setAspect(draft: Draft, aspect: keyof typeof ASPECTS): Effect {
  const from = frameSize(draft.aspect);
  const to = ASPECTS[aspect];
  for (const clip of draft.clips.values()) {
    const live = draft.editClip(clip.id);
    for (const [property, num, den] of [
      ["x", to.width, from.width],
      ["y", to.height, from.height],
    ] as const) {
      const base = live.base[property];
      if (base !== undefined) live.base[property] = roundScaled(base, num, den);
      const diamonds = live.keyframes[property];
      if (diamonds) live.keyframes[property] = diamonds.map((diamond) => ({ ...diamond, value: roundScaled(diamond.value, num, den) }));
    }
  }
  draft.setAspect(aspect);
  return { ...edit("set_aspect"), summary: { type: "set_aspect", aspect_ratio: aspect }, extraTouched: ["project"] };
}

function restoreCut(draft: Draft, ctx: EngineCtx): Effect {
  if (!ctx.cut) throw new AppError("not_found");
  const { snapshot, name } = ctx.cut;
  const wanted = new Map(snapshot.clips.map((clip) => [clip.id, clip]));
  for (const clip of [...draft.clips.values()]) if (!wanted.has(clip.id)) draft.dropClip(clip.id);
  for (const clip of wanted.values()) {
    if (draft.clips.has(clip.id)) draft.editClip(clip.id);
    draft.putClip(structuredClone(clip));
  }
  const wantedCaptions = new Map(snapshot.captions.map((caption) => [caption.id, caption]));
  for (const caption of [...draft.captions.values()]) if (!wantedCaptions.has(caption.id)) draft.dropCaption(caption.id);
  for (const caption of wantedCaptions.values()) {
    if (draft.captions.has(caption.id)) draft.editCaption(caption.id);
    draft.putCaption(structuredClone(caption));
  }
  const diff = draft.diff();
  for (const clip of [...diff.clips, ...[...diff.clipBefore.values()].flatMap((before) => (before ? [before] : []))]) {
    assertUnlocked(draft, clip.row_id);
  }
  for (const caption of [...diff.captions, ...[...diff.captionBefore.values()].flatMap((before) => (before ? [before] : []))]) {
    assertUnlocked(draft, caption.row_id);
  }
  const pins: PinEffect[] = [...diff.clipBefore.entries()]
    .filter(([id, before]) => before && !draft.clips.has(id))
    .map(([id, before]) => ({ kind: "freeze" as const, clip_id: id, start_frame: before?.start_frame ?? 0 }));
  return { summary: { type: "restore_cut", cut_name: name }, stopped: null, pins, extraTouched: ["project"] };
}

function importCaptions(draft: Draft, rowId: string, cues: ParsedCue[], eol: string, bom: boolean): Effect {
  captionRow(draft, rowId);
  for (const caption of [...draft.captions.values()]) if (caption.row_id === rowId) draft.dropCaption(caption.id);
  for (const cue of cues) {
    draft.putCaption({
      id: newId("cap"),
      row_id: rowId,
      start_frame: cue.start_frame,
      end_frame: cue.end_frame,
      text: cue.text,
      orig_start_ms: cue.start_ms,
      orig_end_ms: cue.end_ms,
    });
  }
  const row = draft.editRow(rowId);
  row.srt_eol = eol;
  row.srt_bom = bom;
  return { ...edit("import_captions"), srt: { row_id: rowId } };
}
