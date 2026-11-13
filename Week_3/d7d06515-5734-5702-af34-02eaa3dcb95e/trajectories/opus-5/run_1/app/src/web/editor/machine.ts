import type { AccessLevel, CommandResult, Drawing, MeasureResult, Point } from '../../shared/api';
import { PROMPTS, resolveCommand } from '../../shared/commands';
import { copy } from '../../shared/copy';
import { formatLength, lengthToMillimetres, type Units } from '../../shared/format';
import { parseHandleReference, parseNumber, parseTypedPoint, resolveTypedPoint } from './coords';
import { PICK_MILLIMETRES, pickObject, selectableObjects } from './snap';

export type SlotType = 'point' | 'distance' | 'angle' | 'factor' | 'int' | 'select' | 'selectSet' | 'text' | 'yesno';

export interface Slot {
  type: SlotType;
  prompt: string;
}

const FIXED_PLANS: Record<string, Slot[]> = {
  RECTANG: [
    { type: 'point', prompt: PROMPTS.rectFirst },
    { type: 'point', prompt: PROMPTS.rectOther },
  ],
  CIRCLE: [
    { type: 'point', prompt: PROMPTS.circleCenter },
    { type: 'distance', prompt: PROMPTS.circleRadius },
  ],
  ARC: [
    { type: 'point', prompt: PROMPTS.arcCenter },
    { type: 'distance', prompt: PROMPTS.arcRadius },
    { type: 'angle', prompt: PROMPTS.arcStart },
    { type: 'angle', prompt: PROMPTS.arcEnd },
  ],
  POLYGON: [
    { type: 'int', prompt: PROMPTS.polygonSides },
    { type: 'point', prompt: PROMPTS.polygonCenter },
    { type: 'distance', prompt: PROMPTS.polygonRadius },
  ],
  MOVE: [
    { type: 'selectSet', prompt: PROMPTS.selectObjects },
    { type: 'point', prompt: PROMPTS.basePoint },
    { type: 'point', prompt: PROMPTS.secondPoint },
  ],
  COPY: [
    { type: 'selectSet', prompt: PROMPTS.selectObjects },
    { type: 'point', prompt: PROMPTS.basePoint },
    { type: 'point', prompt: PROMPTS.secondPoint },
  ],
  ROTATE: [
    { type: 'selectSet', prompt: PROMPTS.selectObjects },
    { type: 'point', prompt: PROMPTS.basePoint },
    { type: 'angle', prompt: PROMPTS.rotationAngle },
  ],
  SCALE: [
    { type: 'selectSet', prompt: PROMPTS.selectObjects },
    { type: 'point', prompt: PROMPTS.basePoint },
    { type: 'factor', prompt: PROMPTS.scaleFactor },
  ],
  MIRROR: [
    { type: 'selectSet', prompt: PROMPTS.selectObjects },
    { type: 'point', prompt: PROMPTS.mirrorFirst },
    { type: 'point', prompt: PROMPTS.mirrorSecond },
    { type: 'yesno', prompt: PROMPTS.mirrorErase },
  ],
  ERASE: [{ type: 'selectSet', prompt: PROMPTS.selectObjects }],
  FILLET: [
    { type: 'distance', prompt: PROMPTS.filletRadius },
    { type: 'select', prompt: PROMPTS.filletFirst },
    { type: 'select', prompt: PROMPTS.filletSecond },
  ],
  INSERT: [{ type: 'point', prompt: PROMPTS.insertPoint }],
  DIMLINEAR: [
    { type: 'point', prompt: PROMPTS.dimFirstOrigin },
    { type: 'point', prompt: PROMPTS.dimSecondOrigin },
    { type: 'point', prompt: PROMPTS.dimLocation },
  ],
  DIMALIGNED: [
    { type: 'point', prompt: PROMPTS.dimFirstOrigin },
    { type: 'point', prompt: PROMPTS.dimSecondOrigin },
    { type: 'point', prompt: PROMPTS.dimLocation },
  ],
  DIMRADIUS: [
    { type: 'select', prompt: PROMPTS.dimRadiusSelect },
    { type: 'point', prompt: PROMPTS.dimLocation },
  ],
  DIMANGULAR: [
    { type: 'select', prompt: PROMPTS.dimAngularFirst },
    { type: 'select', prompt: PROMPTS.dimAngularSecond },
    { type: 'point', prompt: PROMPTS.dimAngularLocation },
  ],
  MTEXT: [
    { type: 'point', prompt: PROMPTS.mtextFirst },
    { type: 'point', prompt: PROMPTS.mtextOpposite },
    { type: 'text', prompt: PROMPTS.mtextEnter },
  ],
  DIST: [
    { type: 'point', prompt: PROMPTS.distFirst },
    { type: 'point', prompt: PROMPTS.distSecond },
  ],
  REVCLOUD: [
    { type: 'point', prompt: PROMPTS.revcloudFirst },
    { type: 'point', prompt: PROMPTS.revcloudOpposite },
  ],
};

const BASE_COMMANDS = new Set([
  ...Object.keys(FIXED_PLANS).filter((name) => name !== 'DIST'),
  'LINE',
  'PLINE',
  'SPLINE',
  'OFFSET',
  'TRIM',
  'EXTEND',
  'UNDO',
  'REDO',
]);

const TRACE_ALLOWED = new Set(['LINE', 'PLINE', 'CIRCLE', 'MTEXT', 'ERASE', 'REVCLOUD']);
const VIEW_ALLOWED = new Set(['DIST', 'ZOOM', 'LAYER']);

export interface MachineHost {
  drawing: () => Drawing;
  units: () => Units;
  history: (line: string) => void;
  announce: (text: string) => void;
  refresh: () => void;
  runBase: (command: string, args: Record<string, unknown>) => Promise<CommandResult | null>;
  runTrace: (command: string, args: Record<string, unknown>) => Promise<boolean>;
  measure: (first: Point, second: Point) => Promise<MeasureResult>;
  setSelection: (handles: string[]) => void;
  getSelection: () => string[];
  zoomExtents: () => void;
  zoomBy: (factor: number) => void;
  openPanel: (tab: string) => void;
  activeTrace: () => { id: string } | null;
  insertDefaults: () => { block: string; scale: number; rotation: number };
  access: () => AccessLevel;
  trialEnded: () => boolean;
}

interface Pending {
  command: string;
  slots: Slot[];
  values: unknown[];
  points: Point[];
  selection: string[];
  loop: { distance?: number; handle?: string } | null;
}

export class CommandMachine {
  private pending: Pending | null = null;
  private lastCommand: string | null = null;
  private lastPoint: Point | null = null;

  constructor(private readonly host: MachineHost) {}

  get prompt(): string {
    if (this.pending === null) return PROMPTS.idle;
    const slot = this.currentSlot();
    return slot?.prompt ?? PROMPTS.idle;
  }

  get awaitingPoint(): boolean {
    if (this.pending === null) return false;
    if (this.isPointLoop()) return true;
    return this.currentSlot()?.type === 'point';
  }

  get awaitingSelection(): boolean {
    const type = this.currentSlot()?.type;
    return type === 'select' || type === 'selectSet';
  }

  get awaitingText(): boolean {
    return this.currentSlot()?.type === 'text';
  }

  get activeCommand(): string | null {
    return this.pending?.command ?? null;
  }

  get referencePoint(): Point | null {
    return this.lastPoint;
  }

  private currentSlot(): Slot | null {
    const pending = this.pending;
    if (pending === null) return null;
    return pending.slots[pending.values.length] ?? null;
  }

  private refuseByAccess(command: string): boolean {
    const access = this.host.access();
    const trace = this.host.activeTrace();
    if (access === 'view' && !VIEW_ALLOWED.has(command)) {
      this.host.history(copy.history.viewOnly);
      this.host.announce(copy.history.viewOnly);
      return true;
    }
    if (access === 'markup') {
      if (trace === null && !VIEW_ALLOWED.has(command)) {
        this.host.history(copy.history.markupOnly);
        this.host.announce(copy.history.markupOnly);
        return true;
      }
      if (trace !== null && !TRACE_ALLOWED.has(command) && !VIEW_ALLOWED.has(command)) {
        this.host.history(copy.history.markupOnly);
        return true;
      }
    }
    if (trace !== null && BASE_COMMANDS.has(command) && !TRACE_ALLOWED.has(command)) {
      this.host.history(copy.history.baseInTrace);
      return true;
    }
    if (
      this.host.trialEnded() &&
      BASE_COMMANDS.has(command) &&
      trace === null
    ) {
      this.host.history(copy.trial.endedBanner);
      this.host.announce(copy.trial.endedBanner);
      return true;
    }
    return false;
  }

  start(command: string): void {
    if (this.refuseByAccess(command)) return;
    this.host.history(copy.history.started(command));
    this.lastCommand = command;

    if (command === 'LAYER') {
      this.host.openPanel('Layers');
      this.pending = null;
      this.host.refresh();
      return;
    }
    if (command === 'INSERT' && this.host.activeTrace() === null) {
      this.host.openPanel('Blocks');
    }
    if (command === 'UNDO' || command === 'REDO') {
      void this.host.runBase(command, {});
      this.pending = null;
      this.host.refresh();
      return;
    }
    if (command === 'ZOOM') {
      this.pending = { command, slots: [{ type: 'text', prompt: PROMPTS.zoom }], values: [], points: [], selection: [], loop: null };
      this.host.refresh();
      return;
    }
    if (command === 'LINE' || command === 'PLINE' || command === 'SPLINE') {
      this.pending = { command, slots: [], values: [], points: [], selection: [], loop: null };
      this.host.refresh();
      return;
    }
    if (command === 'OFFSET') {
      this.pending = {
        command,
        slots: [{ type: 'distance', prompt: PROMPTS.offsetDistance }],
        values: [],
        points: [],
        selection: [],
        loop: null,
      };
      this.host.refresh();
      return;
    }
    if (command === 'TRIM' || command === 'EXTEND') {
      this.pending = {
        command,
        slots: [{ type: 'select', prompt: command === 'TRIM' ? PROMPTS.trimSelect : PROMPTS.extendSelect }],
        values: [],
        points: [],
        selection: [],
        loop: null,
      };
      this.host.refresh();
      return;
    }
    const plan = FIXED_PLANS[command];
    if (plan === undefined) {
      this.pending = null;
      this.host.refresh();
      return;
    }
    const preselected = this.host.getSelection();
    const pending: Pending = {
      command,
      slots: plan,
      values: [],
      points: [],
      selection: [],
      loop: null,
    };
    if (plan[0]?.type === 'selectSet' && preselected.length > 0) {
      pending.selection = [...preselected];
    }
    this.pending = pending;
    this.host.refresh();
  }

  cancel(): void {
    if (this.pending === null) return;
    this.pending = null;
    this.lastPoint = null;
    this.host.history(copy.history.cancelled);
    this.host.refresh();
  }

  /** The `LINE` prompt depends on how many points are already in. */
  pointLoopPrompt(): string {
    const pending = this.pending;
    if (pending === null) return PROMPTS.idle;
    const count = pending.points.length;
    if (pending.command === 'LINE') {
      if (count === 0) return PROMPTS.lineFirst;
      return count === 1 ? PROMPTS.lineNext : PROMPTS.lineNextClose;
    }
    if (pending.command === 'PLINE') return count === 0 ? PROMPTS.plineStart : PROMPTS.plineNext;
    return count === 0 ? PROMPTS.splineFirst : PROMPTS.splineNext;
  }

  private isPointLoop(): boolean {
    const command = this.pending?.command;
    return command === 'LINE' || command === 'PLINE' || command === 'SPLINE';
  }

  private isPickLoop(): boolean {
    const command = this.pending?.command;
    return command === 'TRIM' || command === 'EXTEND' || command === 'OFFSET';
  }

  currentPrompt(): string {
    if (this.pending === null) return PROMPTS.idle;
    if (this.isPointLoop()) return this.pointLoopPrompt();
    return this.currentSlot()?.prompt ?? PROMPTS.idle;
  }

  submit(text: string): void {
    const trimmed = text.trim();
    if (this.pending === null) {
      if (trimmed === '') {
        if (this.lastCommand !== null) this.start(this.lastCommand);
        return;
      }
      const handle = parseHandleReference(trimmed);
      if (handle !== null) {
        const found = this.host.drawing().objects.find((object) => object.handle === handle);
        if (found === undefined) this.host.history(copy.history.noObjectFound);
        else this.host.setSelection([handle]);
        return;
      }
      const command = resolveCommand(trimmed);
      if (command === null) {
        this.host.history(copy.history.unknownCommand(trimmed));
        return;
      }
      this.start(command);
      return;
    }

    if (this.isPointLoop()) {
      this.handlePointLoopInput(trimmed);
      return;
    }
    const slot = this.currentSlot();
    if (slot === null) return;
    this.consume(slot, trimmed);
  }

  private handlePointLoopInput(text: string): void {
    const pending = this.pending!;
    const upper = text.toUpperCase();
    if (text === '') {
      if (pending.points.length >= 2) void this.finishPointLoop(false);
      else this.cancel();
      return;
    }
    if (upper === 'C' && pending.command !== 'SPLINE') {
      if (pending.points.length >= 3) void this.finishPointLoop(true);
      else this.host.history(copy.history.invalidPoint);
      return;
    }
    if (upper === 'U') {
      pending.points.pop();
      this.lastPoint = pending.points.at(-1) ?? null;
      this.host.refresh();
      return;
    }
    const point = this.readPoint(text);
    if (point === null) return;
    this.addLoopPoint(point);
  }

  private addLoopPoint(point: Point): void {
    const pending = this.pending!;
    pending.points.push(point);
    this.lastPoint = point;
    this.host.refresh();
  }

  private async finishPointLoop(close: boolean): Promise<void> {
    const pending = this.pending!;
    const command = pending.command;
    const points = pending.points;
    this.pending = null;
    this.lastPoint = null;
    const trace = this.host.activeTrace();
    if (command === 'SPLINE') {
      await this.host.runBase('SPLINE', { fit_points: points });
    } else if (command === 'PLINE') {
      if (trace !== null) await this.host.runTrace('PLINE', { points, closed: close });
      else await this.host.runBase('PLINE', { points, closed: close });
    } else if (trace !== null) {
      await this.host.runTrace('LINE', { points, close });
    } else {
      await this.host.runBase('LINE', { points, close });
    }
    this.host.refresh();
  }

  private readPoint(text: string): Point | null {
    const typed = parseTypedPoint(text);
    if (typed === null) {
      this.host.history(copy.history.invalidPoint);
      return null;
    }
    const point = resolveTypedPoint(typed, this.lastPoint, this.host.units());
    if (point === null) {
      this.host.history(copy.history.invalidPoint);
      return null;
    }
    return point;
  }

  private readSelection(text: string): string | null {
    const handle = parseHandleReference(text);
    const drawing = this.host.drawing();
    if (handle !== null) {
      const found = drawing.objects.find((object) => object.handle === handle);
      if (found === undefined) {
        this.host.history(copy.history.noObjectFound);
        return null;
      }
      return found.handle;
    }
    const typed = parseTypedPoint(text);
    if (typed === null) {
      this.host.history(copy.history.invalidPoint);
      return null;
    }
    const point = resolveTypedPoint(typed, this.lastPoint, this.host.units());
    if (point === null) {
      this.host.history(copy.history.invalidPoint);
      return null;
    }
    const found = pickObject(selectableObjects(drawing), point, PICK_MILLIMETRES);
    if (found === null) {
      this.host.history(copy.history.noObjectFound);
      return null;
    }
    return found.handle;
  }

  private consume(slot: Slot, text: string): void {
    const pending = this.pending!;
    switch (slot.type) {
      case 'point': {
        const point = this.readPoint(text);
        if (point === null) return;
        this.lastPoint = point;
        pending.values.push(point);
        break;
      }
      case 'distance':
      case 'factor': {
        const value = parseNumber(text);
        if (value === null || (slot.type === 'factor' && value <= 0) || (slot.type === 'distance' && value < 0)) {
          this.host.history(copy.history.positiveNumber);
          return;
        }
        if (slot.type === 'distance' && value === 0 && pending.command !== 'FILLET') {
          this.host.history(copy.history.positiveNumber);
          return;
        }
        pending.values.push(slot.type === 'distance' ? lengthToMillimetres(value, this.host.units()) : value);
        break;
      }
      case 'angle': {
        const value = parseNumber(text);
        if (value === null) {
          this.host.history(copy.history.positiveNumber);
          return;
        }
        pending.values.push(value);
        break;
      }
      case 'int': {
        const value = parseNumber(text);
        if (value === null || !Number.isInteger(value) || value < 3) {
          this.host.history(copy.history.positiveNumber);
          return;
        }
        pending.values.push(value);
        break;
      }
      case 'select': {
        const handle = this.readSelection(text);
        if (handle === null) return;
        pending.values.push(handle);
        break;
      }
      case 'selectSet': {
        if (text === '') {
          if (pending.selection.length === 0) {
            this.host.history(copy.history.noObjectFound);
            this.cancel();
            return;
          }
          pending.values.push([...pending.selection]);
          break;
        }
        const handle = this.readSelection(text);
        if (handle === null) return;
        if (!pending.selection.includes(handle)) pending.selection.push(handle);
        this.host.setSelection([...pending.selection]);
        this.host.refresh();
        return;
      }
      case 'text': {
        if (pending.command === 'ZOOM') {
          this.pending = null;
          if (text.toUpperCase() === 'E') this.host.zoomExtents();
          this.host.refresh();
          return;
        }
        pending.values.push(text);
        break;
      }
      case 'yesno': {
        const upper = text.toUpperCase();
        pending.values.push(upper === 'Y' || upper === 'YES');
        break;
      }
    }
    this.advance();
  }

  /** A canvas pick or tap at a point prompt. */
  pick(point: Point): void {
    if (this.pending === null) return;
    if (this.isPointLoop()) {
      this.addLoopPoint(point);
      return;
    }
    const slot = this.currentSlot();
    if (slot === null) return;
    if (slot.type === 'point') {
      this.lastPoint = point;
      this.pending.values.push(point);
      this.advance();
      return;
    }
    if (slot.type === 'select' || slot.type === 'selectSet') {
      const found = pickObject(selectableObjects(this.host.drawing()), point, PICK_MILLIMETRES);
      if (found === null) {
        this.host.history(copy.history.noObjectFound);
        return;
      }
      this.pickHandle(found.handle, point);
    }
  }

  pickHandle(handle: string, at: Point | null): void {
    if (this.pending === null) return;
    const slot = this.currentSlot();
    if (slot === null) return;
    if (slot.type === 'select') {
      this.pending.values.push(handle);
      if (at !== null) this.pending.loop = { ...(this.pending.loop ?? {}), ...{} };
      if (at !== null) this.lastPoint = at;
      this.advance(at);
      return;
    }
    if (slot.type === 'selectSet') {
      if (!this.pending.selection.includes(handle)) this.pending.selection.push(handle);
      this.host.setSelection([...this.pending.selection]);
      this.host.refresh();
    }
  }

  private advance(pickPoint: Point | null = null): void {
    const pending = this.pending;
    if (pending === null) return;
    if (this.isPickLoop()) {
      void this.advancePickLoop(pickPoint);
      return;
    }
    if (pending.values.length < pending.slots.length) {
      this.host.refresh();
      return;
    }
    void this.complete();
  }

  private async advancePickLoop(pickPoint: Point | null): Promise<void> {
    const pending = this.pending!;
    if (pending.command === 'OFFSET') {
      if (pending.values.length === 1) {
        pending.slots = [
          { type: 'distance', prompt: PROMPTS.offsetDistance },
          { type: 'select', prompt: PROMPTS.offsetSelect },
        ];
        this.host.refresh();
        return;
      }
      if (pending.values.length === 2) {
        pending.slots = [
          { type: 'distance', prompt: PROMPTS.offsetDistance },
          { type: 'select', prompt: PROMPTS.offsetSelect },
          { type: 'point', prompt: PROMPTS.offsetSide },
        ];
        this.host.refresh();
        return;
      }
      const distance = pending.values[0] as number;
      const handle = pending.values[1] as string;
      const side = pending.values[2] as Point;
      pending.values = [distance];
      pending.slots = [
        { type: 'distance', prompt: PROMPTS.offsetDistance },
        { type: 'select', prompt: PROMPTS.offsetSelect },
      ];
      this.host.refresh();
      await this.host.runBase('OFFSET', { handle, distance, side });
      this.host.refresh();
      return;
    }
    const handle = pending.values[0] as string;
    const pick = pickPoint ?? this.lastPoint ?? [0, 0];
    pending.values = [];
    this.host.refresh();
    await this.host.runBase(pending.command, { handle, pick });
    this.host.refresh();
  }

  private async complete(): Promise<void> {
    const pending = this.pending!;
    const command = pending.command;
    const values = pending.values;
    this.pending = null;
    this.lastPoint = null;
    const trace = this.host.activeTrace();
    const units = this.host.units();

    if (command === 'DIST') {
      const result = await this.host.measure(values[0] as Point, values[1] as Point);
      this.host.history(result.text);
      this.host.announce(copy.announce.measurement(result.text, units));
      this.host.refresh();
      return;
    }

    if (trace !== null) {
      const args = this.traceArgs(command, values);
      if (args !== null) await this.host.runTrace(command, args);
      this.host.refresh();
      return;
    }

    const args = this.baseArgs(command, values);
    if (args === null) {
      this.host.refresh();
      return;
    }
    const result = await this.host.runBase(command, args);
    if (result !== null) this.announceResult(command, values, result, units);
    this.host.refresh();
  }

  private announceResult(
    command: string,
    values: unknown[],
    result: CommandResult,
    units: Units,
  ): void {
    if (command === 'INSERT') {
      const position = values[0] as Point;
      const block = this.host.insertDefaults().block;
      this.host.announce(
        copy.announce.blockPlaced(block, formatLength(position[0], units), formatLength(position[1], units)),
      );
      return;
    }
    if (command.startsWith('DIM')) {
      const created = result.objects.find((object) => object.type === 'dimension');
      if (created !== undefined && created.type === 'dimension') {
        this.host.announce(copy.announce.dimensionPlaced(created.text));
      }
    }
  }

  private traceArgs(command: string, values: unknown[]): Record<string, unknown> | null {
    switch (command) {
      case 'CIRCLE':
        return { center: values[0], radius: values[1] };
      case 'MTEXT':
        return {
          position: values[0],
          width: Math.abs((values[1] as Point)[0] - (values[0] as Point)[0]) || 2000,
          contents: values[2],
        };
      case 'REVCLOUD':
        return { first: values[0], opposite: values[1] };
      case 'ERASE':
        return { handles: values[0] };
      default:
        return null;
    }
  }

  private baseArgs(command: string, values: unknown[]): Record<string, unknown> | null {
    switch (command) {
      case 'RECTANG':
        return { first: values[0], other: values[1] };
      case 'CIRCLE':
        return { center: values[0], radius: values[1] };
      case 'ARC':
        return { center: values[0], radius: values[1], start_angle: values[2], end_angle: values[3] };
      case 'POLYGON':
        return { center: values[1], sides: values[0], radius: values[2] };
      case 'MOVE':
      case 'COPY':
        return { handles: values[0], from: values[1], to: values[2] };
      case 'ROTATE':
        return { handles: values[0], base: values[1], angle: values[2] };
      case 'SCALE':
        return { handles: values[0], base: values[1], factor: values[2] };
      case 'MIRROR':
        return { handles: values[0], first: values[1], second: values[2], erase_source: values[3] };
      case 'ERASE':
        return { handles: values[0] };
      case 'FILLET':
        return { handles: [values[1], values[2]], radius: values[0] };
      case 'INSERT': {
        const defaults = this.host.insertDefaults();
        return {
          block: defaults.block,
          position: values[0],
          scale: defaults.scale,
          rotation: defaults.rotation,
        };
      }
      case 'DIMLINEAR':
      case 'DIMALIGNED':
        return { first: values[0], second: values[1], location: values[2] };
      case 'DIMRADIUS':
        return { handle: values[0], location: values[1] };
      case 'DIMANGULAR':
        return { first_handle: values[0], second_handle: values[1], location: values[2] };
      case 'MTEXT':
        return {
          position: values[0],
          width: Math.abs((values[1] as Point)[0] - (values[0] as Point)[0]) || 2000,
          contents: values[2],
        };
      default:
        return null;
    }
  }
}
