// The command line as a pure state machine: (state, input, environment) -> (state, effects).
// It never touches the DOM or the network; the editor store runs the effects it returns.
import { ALIASES, COMMAND_NAMES, IDLE_PROMPT, PROMPTS, type CommandName } from '../../../shared/commands.ts';
import { COPY, objectsCount } from '../../../shared/copy.ts';
import { unitsToMm } from '../../../shared/format.ts';
import { angle6, directionOf, distance } from '../../../shared/geometry.ts';
import type { Access, BlockName, Point, Units } from '../../../shared/types.ts';
import { parseHandle, parseNumber, parsePoint, roundPoint } from './parse.ts';

/** A typed point selects the nearest object within this distance of model space. */
const TYPED_PICK_MM = 10;
/** Default MTEXT height. */
const DEFAULT_TEXT_HEIGHT_MM = 250;

/** An object the user can act on: `inTrace` is true for the objects of the active trace. */
export interface Target {
  handle: string;
  inTrace: boolean;
  /** A point on the object, used when it is named by handle but the command needs a pick point. */
  hint: Point;
}

export interface Env {
  units: Units;
  access: Access;
  trialEnded: boolean;
  /** The person's own trace is active: drawing commands go to it. */
  trace: boolean;
  lookup(handle: string): Target | null;
  pick(point: Point, toleranceMm: number): Target | null;
}

export interface InsertPresets { block: BlockName; scale: number; rotation: number }

type Value =
  | { t: 'point'; point: Point }
  | { t: 'number'; number: number }
  | { t: 'handles'; handles: string[] }
  | { t: 'object'; handle: string; at: Point }
  | { t: 'flag'; flag: boolean }
  | { t: 'text'; text: string };

interface Running {
  command: CommandName;
  step: number;
  values: Value[];
  /** LINE, PLINE and SPLINE: the points so far. */
  points: Point[];
  /** The `Select objects:` set being built. */
  handles: string[];
  /** The last point accepted by this command (ORTHO, POLAR and OTRACK measure from it). */
  anchor: Point | null;
  target: 'base' | 'trace';
  presets: InsertPresets | null;
}

export interface MachineState {
  running: Running | null;
  last: CommandName | null;
  /** Relative coordinates are measured from here, across commands. */
  lastPoint: Point;
}

export const initialMachine: MachineState = { running: null, last: null, lastPoint: [0, 0] };

export type Input =
  | { kind: 'line'; text: string }
  /** A point picked on the canvas (already snapped and constrained); `tolerance` is the pick distance in millimetres. */
  | { kind: 'point'; point: Point; tolerance: number }
  | { kind: 'escape' };

export type Effect =
  | { type: 'history'; line: string }
  | { type: 'send'; target: 'base' | 'trace'; command: string; args: Record<string, unknown> }
  | { type: 'measure'; first: Point; second: Point }
  | { type: 'select'; handles: string[] }
  | { type: 'panel'; panel: 'layers' | 'blocks' }
  | { type: 'zoom'; mode: 'extents' | 'in' | 'out' };

export interface Step { state: MachineState; effects: Effect[] }

type StepKind =
  | { kind: 'point' } | { kind: 'radius' } | { kind: 'angle'; about: number }
  | { kind: 'distance' } | { kind: 'reach' } | { kind: 'factor' } | { kind: 'sides' }
  | { kind: 'objects' } | { kind: 'object' } | { kind: 'text' } | { kind: 'choice' } | { kind: 'zoom' };

const POINT: StepKind = { kind: 'point' };
const OBJECT: StepKind = { kind: 'object' };
const OBJECTS: StepKind = { kind: 'objects' };
const RADIUS: StepKind = { kind: 'radius' };

const SEQUENCES: Record<Exclude<CommandName, 'LINE' | 'PLINE' | 'SPLINE' | 'LAYER' | 'UNDO' | 'REDO' | 'OFFSET' | 'TRIM' | 'EXTEND'>, readonly StepKind[]> = {
  RECTANG: [POINT, POINT],
  CIRCLE: [POINT, RADIUS],
  ARC: [POINT, RADIUS, { kind: 'angle', about: 0 }, { kind: 'angle', about: 0 }],
  POLYGON: [{ kind: 'sides' }, POINT, RADIUS],
  MOVE: [OBJECTS, POINT, POINT],
  COPY: [OBJECTS, POINT, POINT],
  ROTATE: [OBJECTS, POINT, { kind: 'angle', about: 1 }],
  SCALE: [OBJECTS, POINT, { kind: 'factor' }],
  MIRROR: [OBJECTS, POINT, POINT, { kind: 'choice' }],
  ERASE: [OBJECTS],
  FILLET: [{ kind: 'reach' }, OBJECT, OBJECT],
  INSERT: [POINT],
  DIMLINEAR: [POINT, POINT, POINT],
  DIMALIGNED: [POINT, POINT, POINT],
  DIMRADIUS: [OBJECT, POINT],
  DIMANGULAR: [OBJECT, OBJECT, POINT],
  MTEXT: [POINT, POINT, { kind: 'text' }],
  DIST: [POINT, POINT],
  REVCLOUD: [POINT, POINT],
  ZOOM: [{ kind: 'zoom' }],
};

/** OFFSET, TRIM and EXTEND repeat from `loopAt` after each pick until Enter. */
const LOOPS = {
  OFFSET: { steps: [{ kind: 'distance' }, OBJECT, POINT] as const satisfies readonly StepKind[], loopAt: 1 },
  TRIM: { steps: [OBJECT] as const satisfies readonly StepKind[], loopAt: 0 },
  EXTEND: { steps: [OBJECT] as const satisfies readonly StepKind[], loopAt: 0 },
};

const POINT_LISTS = ['LINE', 'PLINE', 'SPLINE'] as const;
type PointList = (typeof POINT_LISTS)[number];
const isPointList = (command: CommandName): command is PointList => (POINT_LISTS as readonly string[]).includes(command);

/** The commands a trace accepts; everything else only ever edits base geometry. */
const TRACE_COMMANDS: readonly CommandName[] = ['LINE', 'PLINE', 'CIRCLE', 'MTEXT', 'ERASE', 'REVCLOUD'];
/** Commands that run for every access level. */
const OPEN_COMMANDS: readonly CommandName[] = ['DIST', 'ZOOM', 'LAYER'];

const unknownCommand = (text: string): string => `Unknown command "${text}". Press F1 for the command reference.`;

function resolveCommand(text: string): CommandName | null {
  const word = text.toUpperCase();
  const alias = ALIASES[word];
  if (alias) return alias;
  return COMMAND_NAMES.find((name) => name === word) ?? null;
}

const stepsOf = (command: CommandName): readonly StepKind[] => {
  if (command === 'OFFSET' || command === 'TRIM' || command === 'EXTEND') return LOOPS[command].steps;
  if (isPointList(command) || command === 'LAYER' || command === 'UNDO' || command === 'REDO') return [];
  return SEQUENCES[command];
};

/** The prompt shown in `status "Command prompt"`. */
export function promptOf(state: MachineState): string {
  const running = state.running;
  if (!running) return IDLE_PROMPT;
  const prompts = PROMPTS[running.command];
  if (running.command === 'LINE') return prompts[Math.min(running.points.length, 2)] ?? IDLE_PROMPT;
  if (isPointList(running.command)) return prompts[Math.min(running.points.length, 1)] ?? IDLE_PROMPT;
  return prompts[running.step] ?? IDLE_PROMPT;
}

/** The running command is waiting for a line of text, where Space is a character. */
export const awaitsText = (state: MachineState): boolean => state.running !== null && currentKind(state.running)?.kind === 'text';

/** What a canvas click means now: nothing is running, a point, an object, or nothing at all. */
type Expectation = 'idle' | 'point' | 'object' | 'none';

export function expects(state: MachineState): Expectation {
  const running = state.running;
  if (!running) return 'idle';
  if (isPointList(running.command)) return 'point';
  const step = stepsOf(running.command)[running.step];
  if (!step) return 'none';
  switch (step.kind) {
    case 'point': case 'radius': case 'angle': return 'point';
    case 'object': case 'objects': return 'object';
    default: return 'none';
  }
}

/** The point ORTHO, POLAR and OTRACK measure from, once the running command has one. */
export const anchorOf = (state: MachineState): Point | null => state.running?.anchor ?? null;

/** Objects picked so far at a `Select objects:` prompt. */
export const pendingOf = (state: MachineState): string[] => state.running?.handles ?? [];

export type Shape =
  | { kind: 'polyline'; points: Point[] }
  | { kind: 'rect'; a: Point; b: Point }
  | { kind: 'circle'; center: Point; radius: number };

/** The rubber band of the running command towards `cursor`. */
export function rubberBand(state: MachineState, cursor: Point): Shape[] {
  const running = state.running;
  if (!running) return [];
  if (isPointList(running.command)) return running.points.length > 0 ? [{ kind: 'polyline', points: [...running.points, cursor] }] : [];
  const step = stepsOf(running.command)[running.step];
  const from = running.anchor;
  if (!step || !from) return [];
  switch (running.command) {
    case 'RECTANG': case 'MTEXT': case 'REVCLOUD': return step.kind === 'point' ? [{ kind: 'rect', a: from, b: cursor }] : [];
    case 'CIRCLE': case 'ARC': case 'POLYGON': return step.kind === 'radius' ? [{ kind: 'circle', center: from, radius: distance(from, cursor) }] : [];
    case 'OFFSET': case 'TRIM': case 'EXTEND': case 'LAYER': case 'UNDO': case 'REDO': case 'ZOOM': return [];
    default: return step.kind === 'point' || step.kind === 'angle' ? [{ kind: 'polyline', points: [from, cursor] }] : [];
  }
}

// ---- Access ----

/** The history line that refuses `command` before it starts, or null when it may run. */
function refusal(command: CommandName, env: Env): string | null {
  if (OPEN_COMMANDS.includes(command)) return null;
  if (env.access === 'view') return COPY.viewOnly;
  if (env.trace && TRACE_COMMANDS.includes(command)) return null;
  if (env.access === 'markup') return COPY.markupOnly;
  return env.trialEnded ? COPY.trialEnded : null;
}

// ---- Starting ----

const history = (line: string): Effect => ({ type: 'history', line });

export function startCommand(state: MachineState, command: CommandName, env: Env, presets: InsertPresets | null = null): Step {
  if (command === 'REVCLOUD' && !env.trace) {
    return { state, effects: [history(env.access === 'markup' ? COPY.markupOnly : unknownCommand('REVCLOUD'))] };
  }
  const refused = refusal(command, env);
  if (refused) return { state, effects: [history(refused)] };
  const echo = history(`Command: ${command}`);
  const next: MachineState = { ...state, last: command };
  switch (command) {
    case 'LAYER': return { state: { ...next, running: null }, effects: [echo, { type: 'panel', panel: 'layers' }] };
    case 'INSERT':
      if (!presets) return { state: { ...next, running: null }, effects: [echo, { type: 'panel', panel: 'blocks' }] };
      break;
    case 'UNDO': case 'REDO':
      return { state: { ...next, running: null }, effects: [echo, { type: 'send', target: 'base', command, args: {} }] };
    default:
  }
  const running: Running = {
    command, step: 0, values: [], points: [], handles: [], anchor: null, presets,
    target: env.trace && TRACE_COMMANDS.includes(command) ? 'trace' : 'base',
  };
  const started = { ...next, running };
  return { state: started, effects: [echo, history(promptOf(started))] };
}

// ---- Stepping ----

export function step(state: MachineState, input: Input, env: Env): Step {
  if (input.kind === 'escape') {
    return state.running
      ? { state: { ...state, running: null }, effects: [history(COPY.cancelled)] }
      : { state, effects: [{ type: 'select', handles: [] }] };
  }
  if (!state.running) return input.kind === 'line' ? idleLine(state, input.text.trim(), env) : { state, effects: [] };
  return input.kind === 'line' ? runningLine(state, state.running, input.text, env) : runningPoint(state, state.running, input.point, input.tolerance, env);
}

function idleLine(state: MachineState, text: string, env: Env): Step {
  if (text === '') return state.last ? startCommand(state, state.last, env) : { state, effects: [] };
  const command = resolveCommand(text);
  if (command) return startCommand(state, command, env);
  const handle = parseHandle(text);
  const point = handle ? null : parsePoint(text, state.lastPoint, env.units);
  if (!handle && !point) return { state, effects: [history(unknownCommand(text))] };
  const target = handle ? env.lookup(handle) : point ? env.pick(point, TYPED_PICK_MM) : null;
  if (!target) return { state, effects: [history(COPY.noObjectFound)] };
  if (env.trace && !target.inTrace) return { state, effects: [history(COPY.baseObjectInTrace)] };
  return selected(state, [target.handle]);
}

function selected(state: MachineState, handles: string[]): Step {
  return { state, effects: [{ type: 'select', handles }, history(`${objectsCount(handles.length)} selected.`)] };
}

const cancel = (state: MachineState): Step => ({ state: { ...state, running: null }, effects: [history(COPY.cancelled)] });

/** Stays on the same step after a refusal and says the prompt again. */
function retry(state: MachineState, line: string): Step {
  return { state, effects: [history(line), history(promptOf(state))] };
}

function runningLine(state: MachineState, running: Running, raw: string, env: Env): Step {
  const kind = currentKind(running);
  const text = raw.trim();
  if (isPointList(running.command)) return pointListLine(state, running, text, env);
  if (!kind) return cancel(state);
  if (text === '') return enterAt(state, running, kind);
  switch (kind.kind) {
    case 'point': return typedPoint(state, running, text, env);
    case 'radius': return typedRadius(state, running, text, env);
    case 'angle': return typedAngle(state, running, kind.about, text, env);
    case 'distance': case 'reach': case 'factor': case 'sides': return typedNumber(state, running, kind.kind, text, env);
    case 'objects': case 'object': return typedPick(state, running, kind.kind, text, env);
    case 'choice': return typedChoice(state, running, text);
    case 'zoom': return typedZoom(state, text);
    case 'text': return acceptText(state, running, text);
  }
}

function currentKind(running: Running): StepKind | undefined {
  return stepsOf(running.command)[running.step];
}

/** Enter on an empty line: finishes a selection or a repeating pick, cancels anything else. */
function enterAt(state: MachineState, running: Running, kind: StepKind): Step {
  if (kind.kind === 'objects') return running.handles.length > 0 ? advance(state, running, { t: 'handles', handles: running.handles }) : cancel(state);
  if (kind.kind === 'object' && isLoop(running.command)) return { state: { ...state, running: null }, effects: [] };
  if (kind.kind === 'choice') return advance(state, running, { t: 'flag', flag: false });
  return cancel(state);
}

const isLoop = (command: CommandName): command is keyof typeof LOOPS => command in LOOPS;

function pointListLine(state: MachineState, running: Running, text: string, env: Env): Step {
  const command = running.command as PointList;
  const word = text.toUpperCase();
  const count = running.points.length;
  if (text === '') return count >= 2 ? sendPointList(state, running) : { state: { ...state, running: null }, effects: [] };
  if (word === 'U' || word === 'UNDO') {
    if (count === 0) return retry(state, COPY.invalidPoint);
    const points = running.points.slice(0, -1);
    const anchor = points[points.length - 1] ?? null;
    const next = { ...state, running: { ...running, points, anchor } };
    return { state: next, effects: [history(promptOf(next))] };
  }
  if (word === 'C' && command !== 'SPLINE' && count >= 2) return sendPointList(state, running, true);
  const point = parsePoint(text, state.lastPoint, env.units);
  return point ? addListPoint(state, running, point) : retry(state, COPY.invalidPoint);
}

function addListPoint(state: MachineState, running: Running, point: Point): Step {
  const next: MachineState = { ...state, lastPoint: point, running: { ...running, points: [...running.points, point], anchor: point } };
  return { state: next, effects: [history(promptOf(next))] };
}

function sendPointList(state: MachineState, running: Running, close = false): Step {
  const points = running.points;
  const args: Record<string, unknown> =
    running.command === 'LINE' ? { points, close }
      : running.command === 'PLINE' ? { points, closed: close }
        : { fit_points: points };
  return { state: { ...state, running: null }, effects: [{ type: 'send', target: running.target, command: running.command, args }] };
}

function typedPoint(state: MachineState, running: Running, text: string, env: Env): Step {
  const point = parsePoint(text, state.lastPoint, env.units);
  return point ? acceptPoint(state, running, point) : retry(state, COPY.invalidPoint);
}

function acceptPoint(state: MachineState, running: Running, point: Point): Step {
  return advance({ ...state, lastPoint: point }, { ...running, anchor: point }, { t: 'point', point });
}

function acceptRadius(state: MachineState, running: Running, radius: number): Step {
  return advance(state, running, { t: 'number', number: radius });
}

function centreOf(running: Running): Point {
  const first = running.values.find((value) => value.t === 'point');
  return first && first.t === 'point' ? first.point : [0, 0];
}

function typedRadius(state: MachineState, running: Running, text: string, env: Env): Step {
  const number = parseNumber(text);
  if (number !== null) return number > 0 ? acceptRadius(state, running, unitsToMm(number, env.units)) : retry(state, COPY.positiveNumber);
  const point = parsePoint(text, state.lastPoint, env.units);
  const radius = point ? distance(centreOf(running), point) : 0;
  return radius > 0 ? acceptRadius({ ...state, lastPoint: point ?? state.lastPoint }, running, radius) : retry(state, COPY.positiveNumber);
}

function angleAbout(running: Running, about: number): Point {
  const value = running.values[about];
  return value && value.t === 'point' ? value.point : [0, 0];
}

function typedAngle(state: MachineState, running: Running, about: number, text: string, env: Env): Step {
  const number = parseNumber(text);
  if (number !== null) return advance(state, running, { t: 'number', number: angle6(number) });
  const point = parsePoint(text, state.lastPoint, env.units);
  return point
    ? advance({ ...state, lastPoint: point }, running, { t: 'number', number: angle6(directionOf(angleAbout(running, about), point)) })
    : retry(state, COPY.invalidPoint);
}

function typedNumber(state: MachineState, running: Running, kind: 'distance' | 'reach' | 'factor' | 'sides', text: string, env: Env): Step {
  const number = parseNumber(text);
  const allowed = number !== null && (kind === 'reach' ? number >= 0 : number > 0);
  if (!allowed) return retry(state, COPY.positiveNumber);
  const value = kind === 'distance' || kind === 'reach' ? unitsToMm(number, env.units) : number;
  return advance(state, running, { t: 'number', number: value });
}

function pickFrom(point: Point, tolerance: number, env: Env): { target: Target | null; line: string | null } {
  const target = env.pick(point, tolerance);
  if (!target) return { target: null, line: COPY.noObjectFound };
  if (env.trace && !target.inTrace) return { target: null, line: COPY.baseObjectInTrace };
  return { target, line: null };
}

function typedPick(state: MachineState, running: Running, kind: 'object' | 'objects', text: string, env: Env): Step {
  const handle = parseHandle(text);
  if (handle) {
    const target = env.lookup(handle);
    if (!target) return retry(state, COPY.noObjectFound);
    if (env.trace && !target.inTrace) return retry(state, COPY.baseObjectInTrace);
    return acceptPick(state, running, kind, target, target.hint);
  }
  const point = parsePoint(text, state.lastPoint, env.units);
  if (!point) return retry(state, COPY.invalidPoint);
  const found = pickFrom(point, TYPED_PICK_MM, env);
  return found.target ? acceptPick(state, running, kind, found.target, point) : retry(state, found.line ?? COPY.noObjectFound);
}

function acceptPick(state: MachineState, running: Running, kind: 'object' | 'objects', target: Target, at: Point): Step {
  if (kind === 'objects') {
    const handles = running.handles.includes(target.handle) ? running.handles : [...running.handles, target.handle];
    const next = { ...state, running: { ...running, handles } };
    return { state: next, effects: [history(`${objectsCount(handles.length)} selected.`)] };
  }
  const value: Value = { t: 'object', handle: target.handle, at };
  if (running.command === 'TRIM' || running.command === 'EXTEND') {
    return {
      state: { ...state, running: { ...running, step: 0, values: [] } },
      effects: [{ type: 'send', target: running.target, command: running.command, args: { handle: target.handle, pick: roundPoint(at) } }, history(promptOf(state))],
    };
  }
  return advance(state, running, value);
}

function typedChoice(state: MachineState, running: Running, text: string): Step {
  const word = text.toUpperCase();
  if (word === 'Y' || word === 'YES') return advance(state, running, { t: 'flag', flag: true });
  if (word === 'N' || word === 'NO') return advance(state, running, { t: 'flag', flag: false });
  return retry(state, unknownCommand(text));
}

function typedZoom(state: MachineState, text: string): Step {
  const done = { ...state, running: null };
  if (text.toUpperCase() === 'E') return { state: done, effects: [{ type: 'zoom', mode: 'extents' }] };
  if (text === '+') return { state: done, effects: [{ type: 'zoom', mode: 'in' }] };
  if (text === '-') return { state: done, effects: [{ type: 'zoom', mode: 'out' }] };
  return retry(state, unknownCommand(text));
}

function acceptText(state: MachineState, running: Running, text: string): Step {
  return text === '' ? cancel(state) : advance(state, running, { t: 'text', text });
}

function runningPoint(state: MachineState, running: Running, point: Point, tolerance: number, env: Env): Step {
  const rounded = roundPoint(point);
  if (isPointList(running.command)) return addListPoint(state, running, rounded);
  const kind = currentKind(running);
  if (!kind) return { state, effects: [] };
  switch (kind.kind) {
    case 'point': return acceptPoint(state, running, rounded);
    case 'radius': {
      const radius = distance(centreOf(running), rounded);
      return radius > 0 ? acceptRadius({ ...state, lastPoint: rounded }, running, radius) : retry(state, COPY.positiveNumber);
    }
    case 'angle':
      return advance({ ...state, lastPoint: rounded }, running, { t: 'number', number: angle6(directionOf(angleAbout(running, kind.about), rounded)) });
    case 'distance': case 'reach': case 'factor': case 'sides': return retry(state, COPY.positiveNumber);
    case 'objects': case 'object': {
      const found = pickFrom(rounded, tolerance, env);
      return found.target ? acceptPick(state, running, kind.kind, found.target, rounded) : retry(state, found.line ?? COPY.noObjectFound);
    }
    case 'choice': case 'text': case 'zoom': return { state, effects: [] };
  }
}

/** Stores the step's value, then moves to the next prompt or sends the finished command. */
function advance(state: MachineState, running: Running, value: Value): Step {
  const values = [...running.values, value];
  const steps = stepsOf(running.command);
  const nextIndex = running.step + 1;
  const stored: Running = { ...running, values, step: nextIndex };
  if (nextIndex < steps.length) {
    const next = { ...state, running: stored };
    return { state: next, effects: [history(promptOf(next))] };
  }
  const effect = finished(stored);
  if (isLoop(running.command)) {
    const again: Running = { ...stored, step: LOOPS[running.command].loopAt, values: values.slice(0, LOOPS[running.command].loopAt) };
    const next = { ...state, running: again };
    return { state: next, effects: [...effect, history(promptOf(next))] };
  }
  return { state: { ...state, running: null }, effects: effect };
}

// ---- Finished commands ----

function bad(): never {
  throw new Error('command step out of order');
}
const pointAt = (values: Value[], index: number): Point => {
  const value = values[index];
  return value && value.t === 'point' ? value.point : bad();
};
const numberAt = (values: Value[], index: number): number => {
  const value = values[index];
  return value && value.t === 'number' ? value.number : bad();
};
const handlesAt = (values: Value[], index: number): string[] => {
  const value = values[index];
  return value && value.t === 'handles' ? value.handles : bad();
};
const objectAt = (values: Value[], index: number): string => {
  const value = values[index];
  return value && value.t === 'object' ? value.handle : bad();
};
const flagAt = (values: Value[], index: number): boolean => {
  const value = values[index];
  return value && value.t === 'flag' ? value.flag : bad();
};
const textAt = (values: Value[], index: number): string => {
  const value = values[index];
  return value && value.t === 'text' ? value.text : bad();
};

function send(running: Running, args: Record<string, unknown>): Effect[] {
  return [{ type: 'send', target: running.target, command: running.command, args }];
}

function finished(running: Running): Effect[] {
  const v = running.values;
  switch (running.command) {
    case 'RECTANG': return send(running, { first: pointAt(v, 0), other: pointAt(v, 1) });
    case 'CIRCLE': return send(running, { center: pointAt(v, 0), radius: numberAt(v, 1) });
    case 'ARC': return send(running, { center: pointAt(v, 0), radius: numberAt(v, 1), start_angle: numberAt(v, 2), end_angle: numberAt(v, 3) });
    case 'POLYGON': return send(running, { center: pointAt(v, 1), sides: numberAt(v, 0), radius: numberAt(v, 2) });
    case 'MOVE': case 'COPY': return send(running, { handles: handlesAt(v, 0), from: pointAt(v, 1), to: pointAt(v, 2) });
    case 'ROTATE': return send(running, { handles: handlesAt(v, 0), base: pointAt(v, 1), angle: numberAt(v, 2) });
    case 'SCALE': return send(running, { handles: handlesAt(v, 0), base: pointAt(v, 1), factor: numberAt(v, 2) });
    case 'MIRROR': return send(running, { handles: handlesAt(v, 0), first: pointAt(v, 1), second: pointAt(v, 2), erase_source: flagAt(v, 3) });
    case 'ERASE': return send(running, { handles: handlesAt(v, 0) });
    case 'FILLET': return send(running, { handles: [objectAt(v, 1), objectAt(v, 2)], radius: numberAt(v, 0) });
    case 'INSERT': {
      const presets = running.presets ?? bad();
      return send(running, { block: presets.block, position: pointAt(v, 0), scale: presets.scale, rotation: presets.rotation });
    }
    case 'DIMLINEAR': case 'DIMALIGNED': return send(running, { first: pointAt(v, 0), second: pointAt(v, 1), location: pointAt(v, 2) });
    case 'DIMRADIUS': return send(running, { handle: objectAt(v, 0), location: pointAt(v, 1) });
    case 'DIMANGULAR': return send(running, { first_handle: objectAt(v, 0), second_handle: objectAt(v, 1), location: pointAt(v, 2) });
    case 'MTEXT': {
      const first = pointAt(v, 0);
      const other = pointAt(v, 1);
      return send(running, {
        position: [Math.min(first[0], other[0]), Math.min(first[1], other[1])],
        width: Math.abs(other[0] - first[0]),
        height: DEFAULT_TEXT_HEIGHT_MM,
        contents: textAt(v, 2),
      });
    }
    case 'DIST': return [{ type: 'measure', first: pointAt(v, 0), second: pointAt(v, 1) }];
    case 'REVCLOUD': return send(running, { first: pointAt(v, 0), opposite: pointAt(v, 1) });
    case 'OFFSET': return send(running, { handle: objectAt(v, 1), distance: numberAt(v, 0), side: pointAt(v, 2) });
    default: return bad();
  }
}
