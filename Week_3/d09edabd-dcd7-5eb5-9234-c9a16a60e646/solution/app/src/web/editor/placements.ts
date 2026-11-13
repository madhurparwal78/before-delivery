import { ApiFailure, post } from '../api';
import type { Placement, PlacementKind, Prop } from '../../shared/types';
import { acquireLock, heldByOther, holdingCopy, releaseLock } from './locks';
import { drawPlacements, drawSceneOrder, movedInOrder, newOpId, wrapDegrees, type Mode, type PlacementFields } from './model';
import { putPlacement } from './mutate';
import { enqueue, updateChange } from './queue';
import { EDITS_PAUSED } from './copy';
import { editor, openDialog, say, type LockedPrompt } from './state';

const drawn = (): Placement[] => {
  const s = editor.get();
  return drawPlacements(s.placements, s.queue, s.preview);
};

const drawnOrder = (): string[] => {
  const s = editor.get();
  return drawSceneOrder(s.sceneOrder, s.queue);
};

const stored = (id: string): Placement | undefined => editor.get().placements.find((p) => p.id === id);
const shown = (id: string): Placement | undefined => drawn().find((p) => p.id === id);

export function setMode(mode: Mode): void {
  editor.set({ mode });
}

/** Selecting a placement takes its lock; clearing or changing the selection releases it. */
export function selectPlacement(id: string | null): void {
  const previous = editor.get().selectedId;
  if (previous === id) return;
  if (previous) releaseLock('placement', previous);
  editor.set({ selectedId: id });
  if (id) void acquireLock('placement', id);
}

/** `]` and `[`: the next or previous placement in creation order. */
export function stepSelection(delta: 1 | -1): void {
  const { placements, selectedId } = editor.get();
  if (placements.length === 0) return;
  const index = placements.findIndex((p) => p.id === selectedId);
  const next = index < 0 ? (delta === 1 ? 0 : placements.length - 1) : (index + delta + placements.length) % placements.length;
  selectPlacement(placements[next]!.id);
}

/** Queues one change to a placement (a nudge, a finished drag, a rotation, a resize, an Inspector edit or a landing). Returns false when nothing changed or someone else holds it. */
export function changePlacement(id: string, fields: Partial<PlacementFields>): boolean {
  const current = shown(id);
  const base = stored(id);
  if (!current || !base) return false;
  const changed = (Object.keys(fields) as (keyof PlacementFields)[]).some((key) => fields[key] !== current[key]);
  if (!changed) return false;
  const holder = heldByOther('placement', id);
  if (holder) {
    say(holdingCopy('placement', holder));
    return false;
  }
  enqueue(updateChange(base, fields));
  return true;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/** Arrow keys on the selected placement, by mode: move 10 mm (100 with Shift), rotate 15 degrees, scale 10 mm. */
export function nudgeSelected(arrow: Arrow, shift: boolean): void {
  const { selectedId, room, mode } = editor.get();
  const p = selectedId ? shown(selectedId) : undefined;
  if (!p || !room) return;
  const sign = arrow === 'ArrowRight' || arrow === 'ArrowUp' ? 1 : -1;
  const horizontal = arrow === 'ArrowLeft' || arrow === 'ArrowRight';
  let fields: Partial<PlacementFields>;
  if (mode === 'move') {
    const step = shift ? 100 : 10;
    fields = horizontal ? { xMm: clamp(p.xMm + sign * step, 0, room.widthMm) } : { zMm: clamp(p.zMm + sign * step, 0, room.depthMm) };
  } else if (mode === 'rotate') {
    if (!horizontal) return;
    fields = { rotationDeg: wrapDegrees(p.rotationDeg + sign * 15) };
  } else {
    fields = horizontal ? { widthMm: clamp(p.widthMm + sign * 10, 10, room.widthMm) } : { heightMm: clamp(p.heightMm + sign * 10, 10, room.heightMm) };
  }
  changePlacement(p.id, fields);
}

export function deleteSelected(): void {
  const { selectedId } = editor.get();
  const p = selectedId ? shown(selectedId) : undefined;
  const base = selectedId ? stored(selectedId) : undefined;
  if (!p || !base) return;
  const holder = heldByOther('placement', p.id);
  if (holder) return say(holdingCopy('placement', holder));
  releaseLock('placement', p.id);
  editor.set({ selectedId: null });
  enqueue({ opId: newOpId(), kind: 'delete', placementId: p.id, label: p.label, baseVersion: base.version });
}

/** Alt+Arrow on a Scene item: one place up or down, counted from the order as drawn. */
export function moveInScene(id: string, direction: 'up' | 'down'): void {
  const order = drawnOrder();
  const next = movedInOrder(order, id, direction);
  const p = shown(id);
  if (!next || !p) return;
  const passed = shown(order[order.indexOf(id) + (direction === 'up' ? -1 : 1)]!)?.label ?? '';
  enqueue({ opId: newOpId(), kind: 'move', placementId: id, label: p.label, direction });
  say(`Moved ${p.label} ${direction === 'up' ? 'above' : 'below'} ${passed}.`);
}

const PRIMITIVES: Record<Exclude<PlacementKind, 'prop'>, { label: string; w: number; d: number; h: number }> = {
  door: { label: 'Door', w: 900, d: 100, h: 2100 },
  box: { label: 'Box', w: 600, d: 600, h: 600 },
  cylinder: { label: 'Cylinder', w: 500, d: 500, h: 900 },
};

async function createPlacement(body: Record<string, unknown>): Promise<void> {
  const { roomId } = editor.get();
  try {
    const { placement } = await post<{ placement: Placement }>(`/api/rooms/${roomId}/placements`, body);
    putPlacement(placement);
    selectPlacement(placement.id);
  } catch (error) {
    if (error instanceof ApiFailure && error.code === 'playtest_running') say(EDITS_PAUSED);
    else if (error instanceof ApiFailure) say(Object.values(error.fieldErrors)[0] ?? 'That could not be added.');
  }
}

/** Add primitive: a door, box or cylinder at the middle of the floor (a door on the front wall). */
export async function addPrimitive(kind: Exclude<PlacementKind, 'prop'>): Promise<void> {
  const { room, placements } = editor.get();
  if (!room) return;
  const spec = PRIMITIVES[kind];
  const first = kind === 'door' && !placements.some((p) => p.kind === 'door' && p.entry);
  await createPlacement({
    kind, label: spec.label, xMm: Math.round(room.widthMm / 2), yMm: 0, zMm: kind === 'door' ? 0 : Math.round(room.depthMm / 2), rotationDeg: 0,
    widthMm: Math.min(spec.w, room.widthMm), depthMm: Math.min(spec.d, room.depthMm), heightMm: Math.min(spec.h, room.heightMm), ...(first ? { entry: true } : {}),
  });
}

/** Place a prop from the library at the centre of the room floor. */
export async function placeProp(prop: Prop): Promise<void> {
  const { room } = editor.get();
  if (!room) return;
  await createPlacement({ kind: 'prop', propId: prop.id, label: prop.name.slice(0, 60), xMm: Math.round(room.widthMm / 2), yMm: 0, zMm: Math.round(room.depthMm / 2), rotationDeg: 0 });
}

/** The Inspector's Rotation field committed a new value: saved, or the Prop locked dialog when someone else holds the placement. */
export function commitRotation(id: string, degrees: number): void {
  const p = shown(id);
  if (!p) return;
  const value = wrapDegrees(degrees);
  if (value === p.rotationDeg) return;
  const holder = heldByOther('placement', id);
  if (holder) {
    editor.set({ lockedPrompt: { placementId: id, label: p.label, holder, field: { rotationDeg: value } } });
    openDialog('locked');
    return;
  }
  changePlacement(id, { rotationDeg: value });
}

/** Take over the lock from the holder, then save the value that was committed. */
export async function takeOver(prompt: LockedPrompt): Promise<void> {
  const taken = await acquireLock('placement', prompt.placementId, true);
  if (!taken) return;
  say(`You now hold ${prompt.label}.`);
  changePlacement(prompt.placementId, prompt.field);
}

export async function undoOwnChange(): Promise<void> {
  const { roomId } = editor.get();
  try {
    const result = await post<{ undone: { label: string; field: string }; placement: Placement }>(`/api/rooms/${roomId}/undo`);
    putPlacement(result.placement);
    say(`Undid your ${result.undone.field} change on ${result.undone.label}.`);
  } catch (error) {
    if (!(error instanceof ApiFailure)) throw error;
    if (error.code === 'nothing_to_undo') say('Nothing to undo.');
    else if (error.code === 'undo_conflict') say(`Can't undo: ${String(error.body.label)} was deleted by ${(error.body.deletedBy as { displayName: string }).displayName}.`);
    else if (error.code === 'locked') say(`${(error.body.holder as { displayName: string }).displayName} is holding this prop.`);
    else if (error.code === 'playtest_running') say(EDITS_PAUSED);
  }
}

const GRAVITY_NUMERATOR = 109;
const GRAVITY_DENOMINATOR = 320;
const STEPS_PER_SECOND = 120;

/** Height after k fixed steps of the published fall: y0 - 109 * k * (k + 1) / 320 mm. */
const heightAfter = (y0: number, steps: number): number => y0 - (GRAVITY_NUMERATOR * steps * (steps + 1)) / GRAVITY_DENOMINATOR;

/** The first step that would take the height to 0 or below: the fall ends there at exactly 0. */
function landingStep(y0: number): number {
  let steps = 1;
  while (heightAfter(y0, steps) > 0) steps += 1;
  return steps;
}

/** D: drop the selected raised placement to the floor, 120 fixed steps per second of page time, saved once when it lands. */
export function startDrop(): void {
  const { selectedId } = editor.get();
  const p = selectedId ? shown(selectedId) : undefined;
  if (!p || p.kind === 'door' || p.yMm <= 0 || editor.get().drop) return;
  const holder = heldByOther('placement', p.id);
  if (holder) return say(holdingCopy('placement', holder));
  const id = p.id;
  const y0 = p.yMm;
  const last = landingStep(y0);
  const begin = performance.now();
  const frame = (now: number): void => {
    const steps = Math.min(last, Math.floor(((now - begin) * STEPS_PER_SECOND) / 1000));
    if (steps >= last) {
      editor.set((s) => ({ drop: null, preview: null, dropSteps: { ...s.dropSteps, [id]: last } }));
      changePlacement(id, { yMm: 0 });
      return;
    }
    const yMm = heightAfter(y0, steps);
    editor.set((s) => ({ drop: { id, steps, yMm }, preview: { id, fields: { yMm } }, dropSteps: { ...s.dropSteps, [id]: steps } }));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
