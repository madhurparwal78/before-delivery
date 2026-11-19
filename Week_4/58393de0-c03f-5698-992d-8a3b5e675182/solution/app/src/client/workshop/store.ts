import { copy } from "../../shared/copy";
import type { DesignObject, ObjectMode, ObjectShape, Snapshot3d, Vec3, Workplane } from "../../shared/types";
import type { EditorController } from "../editors/contract";
import { geometryJob, type SolidResult } from "../geometry";
import { nextShapeColor } from "../render";
import { orbit, START_CAMERA, zoom, type Camera } from "./camera";
import {
  EMPTY_HISTORY, GROUND, addShape, align, groupDraft, groupFromBounds, groupProblem, inCreationOrder, membersOf, moveVector,
  record, removeObjects, replaceWithGroup, resize, setMode, setWorkplane, snapFace, stepBack, stepForward, tabTarget, toggleId,
  toggledMode, translate, turn, ungroup, ungroupFits, workplaneOnFace,
  type Axis, type Design, type Entry, type History, type MoveKey, type SizeField,
} from "./model";

/** What the geometry worker reported for a group, which the hidden scene element publishes. */
export interface GroupInfo {
  volume: number;
  triangleCount: number;
}

/** Rotate mode makes the left and right arrows turn the selection; face-pick mode waits for a face for the workplane. */
type Mode = "idle" | "rotate" | "pickFace";

export interface WorkshopState {
  design: Design;
  selected: readonly string[];
  mode: Mode;
  /** True from pressing Group until the worker answers. */
  grouping: boolean;
  groups: ReadonlyMap<string, GroupInfo>;
  camera: Camera;
}

interface Hooks {
  announce: (message: string) => void;
  openAlign: () => void;
  onChange: (snapshot: Snapshot3d) => void;
}

const SHAPE_KEYS: Record<string, ObjectShape> = { b: "box", c: "cylinder", s: "sphere" };
const ARROW_MOVES: Record<string, MoveKey> = { ArrowRight: "right", ArrowLeft: "left", ArrowUp: "up", ArrowDown: "down" };
const PAGE_MOVES: Record<string, MoveKey> = { PageUp: "raise", PageDown: "lower" };
const TYPING = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const DIALOGS = "[role='dialog'], [role='alertdialog']";
const STEP_MM = 1;
const BIG_STEP_MM = 10;
const TURN_DEGREES = 15;
const FINE_TURN_DEGREES = 1;

const snapshotOf = (design: Design): Snapshot3d => ({ kind: "3d", objects: design.objects, workplane: design.workplane });

function allIds(objects: readonly DesignObject[]): string[] {
  return objects.flatMap((object) => [object.id, ...allIds(object.children)]);
}

/** The editable document, its selection, modes, camera and undo history, plus every command that changes them. */
export class WorkshopStore {
  hooks: Hooks;
  readOnly = false;
  /** The focusable canvas (or top view): Tab moves the selection only while it has focus. */
  canvas: Element | null = null;
  readonly controller: EditorController;
  private state: WorkshopState;
  private history: History = EMPTY_HISTORY;
  private readonly listeners = new Set<() => void>();
  private readonly keyResults = new WeakMap<KeyboardEvent, boolean>();
  private readonly resolving = new Set<string>();
  /** Bumped when a snapshot is loaded, so answers for the old document are dropped. */
  private generation = 0;
  private dragBase: Design | null = null;

  constructor(snapshot: Snapshot3d, hooks: Hooks) {
    this.hooks = hooks;
    this.state = this.fresh(snapshot, START_CAMERA);
    this.controller = {
      undo: () => this.undo(),
      redo: () => this.redo(),
      canUndo: () => !this.readOnly && this.history.past.length > 0,
      canRedo: () => !this.readOnly && this.history.future.length > 0,
      subscribe: this.subscribe,
      handleKey: this.handleKey,
      exportSource: () => ({ kind: "design", objects: this.state.design.objects }),
    };
    this.resolveGroups(this.state.design.objects);
  }

  getState = (): WorkshopState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Starts over from `snapshot`: no undo history, no selection; the camera stays where it is. */
  load(snapshot: Snapshot3d): void {
    this.generation += 1;
    this.history = EMPTY_HISTORY;
    this.dragBase = null;
    this.resolving.clear();
    this.state = this.fresh(snapshot, this.state.camera);
    this.emit();
    this.resolveGroups(this.state.design.objects);
  }

  setReadOnly(readOnly: boolean): void {
    if (readOnly === this.readOnly) return;
    this.readOnly = readOnly;
    this.emit();
  }

  /* ---------- selection ---------- */

  select(ids: readonly string[]): void {
    const next = inCreationOrder(this.state.design, ids);
    const current = this.state.selected;
    if (next.length === current.length && next.every((id, i) => id === current[i])) return;
    this.patch({ selected: next });
  }

  selectAll(): void {
    this.select(this.state.design.objects.map((object) => object.id));
  }

  toggleSelected(id: string): void {
    this.select(toggleId(this.state.selected, id));
  }

  /* ---------- edits ---------- */

  addShape(kind: ObjectShape): void {
    if (!this.canEdit()) return;
    const { design } = this.state;
    const id = this.freshId();
    const next = addShape(design, kind, id, nextShapeColor(design.objects.length));
    if (!next) {
      this.hooks.announce(copy.objectLimit);
      return;
    }
    this.commit(next, [id]);
  }

  deleteSelection(): void {
    if (!this.canEdit()) return;
    this.edit(removeObjects(this.state.design, this.state.selected), []);
  }

  setSelectionMode(mode: ObjectMode): void {
    if (!this.canEdit()) return;
    this.edit(setMode(this.state.design, this.state.selected, mode));
  }

  toggleSelectionMode(): void {
    const chosen = membersOf(this.state.design, this.state.selected);
    if (chosen.length > 0) this.setSelectionMode(toggledMode(chosen));
  }

  nudge(key: MoveKey, amount: number): void {
    if (!this.canEdit()) return;
    const { design, selected } = this.state;
    this.edit(translate(design, selected, moveVector(design.workplane, key, amount)));
  }

  turnSelection(degrees: number): void {
    if (!this.canEdit()) return;
    this.edit(turn(this.state.design, this.state.selected, degrees));
  }

  setSize(field: SizeField, value: number): void {
    if (!this.canEdit()) return;
    this.edit(resize(this.state.design, this.state.selected, field, value));
  }

  /** Opens the Align dialog, or says why it cannot be used. */
  requestAlign(): void {
    if (!this.canEdit()) return;
    if (this.state.selected.length < 2) this.hooks.announce(copy.selectTwo);
    else this.hooks.openAlign();
  }

  alignSelection(axis: Axis): void {
    if (!this.canEdit()) return;
    const { design, selected } = this.state;
    this.edit(align(design, selected, axis));
    this.hooks.announce(copy.aligned(selected.length, axis.toUpperCase()));
  }

  /** Groups the selection once the worker has resolved it; the group enters the document with its computed volume. */
  async group(): Promise<void> {
    if (!this.canEdit()) return;
    const { design, selected } = this.state;
    const members = membersOf(design, selected);
    const problem = groupProblem(members);
    if (problem) {
      this.hooks.announce(problem === "select-two" ? copy.selectTwo : copy.groupNeedsSolid);
      return;
    }
    const draft = groupDraft(members, this.freshId());
    const generation = this.generation;
    this.patch({ grouping: true });
    this.hooks.announce(copy.grouping);
    let result: SolidResult | null;
    try {
      result = await geometryJob("resolveObject", draft);
    } finally {
      if (generation === this.generation) this.patch({ grouping: false });
    }
    if (generation !== this.generation || this.readOnly) return;
    if (!result) {
      this.hooks.announce(copy.groupNeedsSolid);
      return;
    }
    const group = groupFromBounds(draft, result.bounds);
    const info: GroupInfo = { volume: result.volume, triangleCount: result.triangleCount };
    this.commit(replaceWithGroup(this.state.design, members, group), [group.id], { groups: new Map(this.state.groups).set(group.id, info) });
    this.hooks.announce(copy.grouped(members.length));
  }

  ungroupSelection(): void {
    if (!this.canEdit()) return;
    const { design, selected } = this.state;
    if (!ungroupFits(design, selected)) {
      this.hooks.announce(copy.objectLimit);
      return;
    }
    const result = ungroup(design, selected);
    if (!result) return;
    this.commit(result.design, result.released.map((object) => object.id));
    this.hooks.announce(copy.ungrouped(result.released.length));
    this.resolveGroups(result.released);
  }

  /* ---------- workplane ---------- */

  beginFacePick(): void {
    if (!this.canEdit()) return;
    this.patch({ mode: "pickFace" });
    this.hooks.announce(copy.workplanePick);
  }

  /** Moves the workplane onto the face of `id` that points along `direction`. */
  pickFace(id: string, direction: Vec3): void {
    const object = this.state.design.objects.find((candidate) => candidate.id === id);
    if (object) this.setPickedWorkplane(workplaneOnFace(object, direction));
  }

  /** Enter in face-pick mode: the top face of the selected object. */
  pickTopOfSelection(): void {
    const chosen = membersOf(this.state.design, this.state.selected);
    const object = chosen[chosen.length - 1];
    if (object) this.setPickedWorkplane(workplaneOnFace(object, GROUND.normal));
  }

  resetWorkplane(): void {
    if (!this.canEdit()) return;
    this.edit(setWorkplane(this.state.design, GROUND));
    this.hooks.announce(copy.workplaneReset);
  }

  /* ---------- modes ---------- */

  enterRotate(): void {
    if (this.canEdit()) this.patch({ mode: "rotate" });
  }

  leaveMode(): void {
    if (this.state.mode !== "idle") this.patch({ mode: "idle" });
  }

  /* ---------- camera ---------- */

  orbitBy(dx: number, dy: number): void {
    this.patch({ camera: orbit(this.state.camera, dx, dy) });
  }

  zoomBy(factor: number): void {
    this.patch({ camera: zoom(this.state.camera, factor) });
  }

  /* ---------- dragging on the workplane ---------- */

  beginMove(): boolean {
    if (!this.canEdit() || this.state.selected.length === 0) return false;
    this.dragBase = this.state.design;
    return true;
  }

  /** Shows the selection moved by `delta` from where the drag began, without adding an undo step yet. */
  moveBy(delta: Vec3): void {
    const base = this.dragBase;
    if (!base) return;
    const moved = delta.every((part) => part === 0) ? base : translate(base, this.state.selected, delta);
    this.patch({ design: moved });
  }

  /** The drag is one undo step, or none when the selection ended where it started. */
  endMove(): void {
    const base = this.dragBase;
    this.dragBase = null;
    if (!base || this.state.design === base) return;
    this.history = record(this.history, { design: base, selected: [...this.state.selected] });
    this.emit();
    this.hooks.onChange(snapshotOf(this.state.design));
  }

  /* ---------- history ---------- */

  undo(): void {
    if (!this.canEdit()) return;
    const step = stepBack(this.history, this.entry());
    if (step) this.restore(step.history, step.restore);
  }

  redo(): void {
    if (!this.canEdit()) return;
    const step = stepForward(this.history, this.entry());
    if (step) this.restore(step.history, step.restore);
  }

  /* ---------- keyboard ---------- */

  /** True when the key was an editor shortcut. A key event is handled once however many listeners pass it here. */
  handleKey = (event: KeyboardEvent): boolean => {
    const known = this.keyResults.get(event);
    if (known !== undefined) return known;
    const handled = this.runKey(event);
    this.keyResults.set(event, handled);
    return handled;
  };

  private runKey(event: KeyboardEvent): boolean {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(TYPING) || target?.closest(DIALOGS) || event.altKey) return false;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (event.ctrlKey || event.metaKey) return this.commandKey(key, event.shiftKey);
    return this.plainKey(key, event, target);
  }

  private commandKey(key: string, shift: boolean): boolean {
    switch (key) {
      case "z":
        if (shift) this.redo();
        else this.undo();
        return true;
      case "y":
        this.redo();
        return true;
      case "a":
        this.selectAll();
        return true;
      case "g":
        if (shift) this.ungroupSelection();
        else void this.group();
        return true;
      default:
        return false;
    }
  }

  private plainKey(key: string, event: KeyboardEvent, target: Element | null): boolean {
    const shape = SHAPE_KEYS[key];
    if (shape) return this.editKey(() => this.addShape(shape));
    const arrow = ARROW_MOVES[key];
    if (arrow) return this.arrowKey(arrow, event.shiftKey);
    const page = PAGE_MOVES[key];
    if (page) return this.editKey(() => this.nudge(page, event.shiftKey ? BIG_STEP_MM : STEP_MM));
    switch (key) {
      case "h": return this.editKey(() => this.toggleSelectionMode());
      case "l": return this.editKey(() => this.requestAlign());
      case "w": return this.editKey(() => this.beginFacePick());
      case "r": return this.editKey(() => this.enterRotate());
      case "Delete":
      case "Backspace": return this.editKey(() => this.deleteSelection());
      case "Escape": return this.escapeKey();
      case "Enter": return this.enterKey(target);
      case "Tab": return this.tabKey(event.shiftKey ? -1 : 1, target);
      default: return false;
    }
  }

  private editKey(run: () => void): boolean {
    if (!this.canEdit()) return false;
    run();
    return true;
  }

  private arrowKey(move: MoveKey, shift: boolean): boolean {
    if (!this.canEdit()) return false;
    if (this.state.mode !== "rotate") {
      this.nudge(move, shift ? BIG_STEP_MM : STEP_MM);
      return true;
    }
    const step = shift ? FINE_TURN_DEGREES : TURN_DEGREES;
    if (move === "right") this.turnSelection(step);
    else if (move === "left") this.turnSelection(-step);
    return true;
  }

  private escapeKey(): boolean {
    if (this.state.mode === "idle") return false;
    this.leaveMode();
    return true;
  }

  private enterKey(target: Element | null): boolean {
    if (target instanceof HTMLButtonElement || this.state.mode === "idle") return false;
    if (this.state.mode === "pickFace") this.pickTopOfSelection();
    else this.leaveMode();
    return true;
  }

  private tabKey(direction: 1 | -1, target: Element | null): boolean {
    if (target === null || target !== this.canvas) return false;
    const id = tabTarget(this.state.design, this.state.selected, direction);
    if (id === null) return false;
    this.select([id]);
    return true;
  }

  /* ---------- internals ---------- */

  private canEdit(): boolean {
    return !this.readOnly && !this.state.grouping;
  }

  private fresh(snapshot: Snapshot3d, camera: Camera): WorkshopState {
    return {
      design: { objects: snapshot.objects, workplane: snapshot.workplane },
      selected: [],
      mode: "idle",
      grouping: false,
      groups: new Map(),
      camera,
    };
  }

  private entry(): Entry {
    return { design: this.state.design, selected: [...this.state.selected] };
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  private patch(change: Partial<WorkshopState>): void {
    this.state = { ...this.state, ...change };
    this.emit();
  }

  /** One undo step: the new document and selection, with the old ones kept for Undo. */
  private commit(design: Design, selected: readonly string[], extra: Partial<WorkshopState> = {}): void {
    this.history = record(this.history, this.entry());
    this.patch({ ...extra, design, selected: inCreationOrder(design, selected) });
    this.hooks.onChange(snapshotOf(design));
  }

  /** Commits `next` as one step unless nothing changed. */
  private edit(next: Design, selected: readonly string[] = this.state.selected): void {
    if (next !== this.state.design) this.commit(next, selected);
  }

  private restore(history: History, entry: Entry): void {
    this.history = history;
    this.patch({ design: entry.design, selected: inCreationOrder(entry.design, entry.selected) });
    this.hooks.onChange(snapshotOf(entry.design));
  }

  private setPickedWorkplane(workplane: Workplane): void {
    this.patch({ mode: "idle" });
    if (!this.canEdit()) return;
    this.edit(setWorkplane(this.state.design, workplane));
    this.hooks.announce(copy.workplaneSet(snapFace(workplane.normal).name));
  }

  private freshId(): string {
    const taken = new Set(allIds(this.state.design.objects));
    for (;;) {
      const id = `s-${Math.random().toString(36).slice(2, 9)}`;
      if (!taken.has(id)) return id;
    }
  }

  /** Groups that arrive with a snapshot publish their volume once the worker has resolved them. */
  private resolveGroups(objects: readonly DesignObject[]): void {
    const generation = this.generation;
    for (const object of objects) {
      if (object.kind !== "group" || this.state.groups.has(object.id) || this.resolving.has(object.id)) continue;
      this.resolving.add(object.id);
      void geometryJob("resolveObject", object).then((result) => {
        if (generation !== this.generation) return;
        this.resolving.delete(object.id);
        if (!result) return;
        const info: GroupInfo = { volume: result.volume, triangleCount: result.triangleCount };
        this.patch({ groups: new Map(this.state.groups).set(object.id, info) });
      });
    }
  }
}
