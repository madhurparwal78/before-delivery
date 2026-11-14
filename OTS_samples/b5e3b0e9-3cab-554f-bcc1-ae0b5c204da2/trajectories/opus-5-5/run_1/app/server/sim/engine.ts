import type { Bay, LogPosition, Position } from '../../shared/types.js';
import { BOARD_BAYS } from '../../shared/types.js';
import { clockText, durationText, parseClock } from '../../shared/time.js';
import type { Timers } from '../config.js';
import type { Airfield } from '../layouts.js';
import { type Command, GENERAL_USAGE, normalise, parseInstruction } from './grammar.js';
import {
  type Aircraft,
  type Alert,
  type Leg,
  type LogKind,
  RULES,
  type RuleId,
  type Scenario,
  type SimEvent,
  type SimState,
  type Strip,
  type TrafficItem,
  type Wake,
} from './model.js';
import { findRoute, segmentIds } from './routes.js';
import { clearanceAlerts, type RuleContext, taxiConflicts } from './rules.js';

export type Refusal = { ok: false; message: string };

interface Checked {
  ok: true;
  callsign: string;
  command: Command;
  text: string;
  legs: Leg[] | null;
}

export type CommandResult =
  | { ok: true; callsign: string; readback: string; alerts: { rule: RuleId; text: string }[] }
  | Refusal;

export interface PreviewResult {
  callsign: string | null;
  route: string[];
  stop: string | null;
  conflicts: { segment: string; rule: string }[];
}

export type StripActionResult = { ok: true } | { ok: false; conflict: boolean; message: string };

export type EventResult = { ok: true } | { ok: false; error: 'not_final' | 'parse'; message: string };

const ELIGIBLE: Command['verb'][] = ['TAXI', 'LINEUP', 'TAKEOFF', 'LAND', 'CROSS'];
const HELD_FOR_EMERGENCY: Command['verb'][] = ['TAXI', 'CONTINUE', 'LINEUP', 'TAKEOFF', 'CROSS'];

export const boardOf = (bay: Bay): Position => (BOARD_BAYS.GND.includes(bay) ? 'GND' : 'TWR');

export class Engine implements RuleContext {
  readonly startTime: number;
  readonly arrivalProtectSeconds: number;
  private readonly traffic = new Map<string, TrafficItem>();

  constructor(
    readonly scenario: Scenario,
    readonly airfield: Airfield,
    readonly timers: Timers,
    public state: SimState,
  ) {
    this.startTime = parseClock(scenario.startSimTime)!;
    this.arrivalProtectSeconds = timers.arrivalProtectSeconds;
    for (const item of scenario.traffic) this.traffic.set(item.callsign, item);
  }

  static initialState(scenario: Scenario, firstTime: number | null): SimState {
    const startTime = parseClock(scenario.startSimTime)!;
    const now = firstTime ?? startTime;
    return {
      firstTime: now,
      startTime,
      now,
      status: 'running',
      speed: 1,
      runwayInUse: scenario.runwayInUse,
      wind: { dir: scenario.windDir, kt: scenario.windKt },
      closed: false,
      notice: '',
      runwayChange: null,
      emergency: null,
      lastTakeoff: null,
      eligibleReadbacks: 0,
      readbackErrors: [],
      aircraft: {},
      strips: {},
      seq: 0,
      log: [],
      endTime: null,
    };
  }

  /** Opens the session: traffic and events due by its first second are in place. */
  open(): void {
    for (const event of this.scenario.events) {
      if (this.startTime + event.at <= this.state.now) this.applyEvent(event, 'INS');
    }
    for (const item of this.scenario.traffic) {
      if (this.startTime + item.appearAt <= this.state.now) this.appear(item);
    }
    this.settle();
  }

  item(callsign: string): TrafficItem {
    return this.traffic.get(callsign)!;
  }

  wakeOf(callsign: string): Wake {
    return this.item(callsign).wake;
  }

  private nextSeq(): number {
    this.state.seq += 1;
    return this.state.seq;
  }

  appear(item: TrafficItem): void {
    const departure = item.kind === 'dep';
    this.state.aircraft[item.callsign] = {
      callsign: item.callsign,
      status: departure ? 'parked' : 'final',
      segment: null,
      node: departure ? item.stand : this.airfield.thresholdNode(item.runway ?? ''),
      progress: 0,
      legs: [],
      stop: null,
      routeBy: null,
      timer: 0,
      due: departure ? null : item.dueSeconds,
      landClear: false,
      takeoffStart: null,
      runwayEntry: null,
      emergency: false,
    };
    const strip: Strip = {
      callsign: item.callsign,
      bay: departure ? 'Pending' : 'Arrivals',
      frequency: departure ? 'GND' : 'TWR',
      version: 1,
      signature: '',
      cleared: null,
      holdingPoint: departure ? item.holdingPoint : null,
      runway: departure ? null : item.runway,
      remarks: '',
      emergency: false,
      goAround: false,
      offer: null,
      transferredSeq: null,
      seq: this.nextSeq(),
    };
    strip.signature = signatureOf(strip);
    this.state.strips[item.callsign] = strip;
  }

  /** Raises each strip's version once for every operation that changed what the version covers. */
  settle(): void {
    for (const strip of Object.values(this.state.strips)) {
      const signature = signatureOf(strip);
      if (signature !== strip.signature) {
        strip.signature = signature;
        strip.version += 1;
      }
    }
  }

  log(position: LogPosition, kind: LogKind, text: string, callsign: string | null): void {
    this.state.log.push({ simTime: this.state.now, position, kind, text, callsign, rule: null, penalty: null });
  }

  private alert(position: LogPosition, alert: Alert): void {
    this.state.log.push({
      simTime: this.state.now,
      position,
      kind: 'alert',
      text: alert.text,
      callsign: alert.callsign,
      rule: alert.rule,
      penalty: RULES[alert.rule].penalty,
    });
  }

  setBay(strip: Strip, bay: Bay): void {
    if (strip.bay !== bay) {
      strip.bay = bay;
      strip.seq = this.nextSeq();
    }
  }

  private enterRunway(aircraft: Aircraft): void {
    aircraft.runwayEntry = this.nextSeq();
  }

  // ---------- clock ----------

  tick(): void {
    const s = this.state;
    s.now += 1;
    for (const event of this.scenario.events) {
      if (this.startTime + event.at === s.now) this.applyEvent(event, 'INS');
    }
    const appeared = new Set<string>();
    for (const item of this.scenario.traffic) {
      if (this.startTime + item.appearAt === s.now && !s.aircraft[item.callsign]) {
        this.appear(item);
        appeared.add(item.callsign);
      }
    }
    const reached: string[] = [];
    for (const callsign of Object.keys(s.aircraft).sort()) {
      if (!appeared.has(callsign)) this.advance(s.aircraft[callsign]!, reached);
    }
    this.countRunwayChange();
    for (const callsign of Object.keys(s.strips).sort()) {
      const strip = s.strips[callsign]!;
      if (strip.offer && strip.offer.expiresAt <= s.now) {
        strip.offer = null;
        this.setBay(strip, 'Taxi');
        this.alert(strip.frequency, { rule: 'R6', text: `Handoff not accepted: ${callsign}.`, callsign });
      }
    }
    for (const error of [...s.readbackErrors].sort((a, b) => (a.callsign < b.callsign ? -1 : 1))) {
      if (error.deadline <= s.now) {
        s.readbackErrors = s.readbackErrors.filter((open) => open !== error);
        this.alert(s.strips[error.callsign]!.frequency, {
          rule: 'R7',
          text: `Readback error not corrected: ${error.callsign}.`,
          callsign: error.callsign,
        });
      }
    }
    const lateHandoffs: string[] = [];
    for (const callsign of reached) {
      if (this.item(callsign).overrunsHold) this.overrun(callsign);
      else if (s.strips[callsign]!.frequency === 'GND') lateHandoffs.push(callsign);
    }
    for (const callsign of lateHandoffs) {
      this.alert('GND', {
        rule: 'R6',
        text: `Late handoff: ${callsign} reached ${s.aircraft[callsign]!.node} on Ground.`,
        callsign,
      });
    }
    if (this.finished() || s.now >= this.startTime + this.scenario.durationSeconds) this.end();
    this.settle();
  }

  private finished(): boolean {
    return this.scenario.traffic.every((item) => {
      const status = this.state.aircraft[item.callsign]?.status;
      return status === 'airborne' || status === 'vacated';
    });
  }

  end(): void {
    if (this.state.status === 'ended') return;
    this.state.status = 'ended';
    this.state.endTime = this.state.now;
    this.log('INS', 'event', 'Exercise ended.', null);
  }

  private advance(aircraft: Aircraft, reached: string[]): void {
    const countdown = () => {
      aircraft.timer -= 1;
      return aircraft.timer <= 0;
    };
    switch (aircraft.status) {
      case 'pushing':
        if (countdown()) aircraft.status = 'ready';
        return;
      case 'lining-up':
        if (countdown()) aircraft.status = 'lined-up';
        return;
      case 'rolling':
        if (countdown()) aircraft.status = 'airborne';
        return;
      case 'crossing':
        if (countdown()) {
          const leg = aircraft.legs.shift()!;
          aircraft.node = leg.to;
          aircraft.status = aircraft.legs.length > 0 ? 'taxiing' : 'holding';
        }
        return;
      case 'landing':
        if (countdown()) {
          aircraft.status = 'vacated';
          this.setBay(this.state.strips[aircraft.callsign]!, 'Landed');
        }
        return;
      case 'final':
        aircraft.due = (aircraft.due ?? 0) - 1;
        if (aircraft.due <= 0) {
          if (aircraft.landClear) {
            aircraft.status = 'landing';
            aircraft.due = null;
            aircraft.timer = this.timers.landingRollSeconds;
            this.enterRunway(aircraft);
          } else {
            this.goAround(aircraft.callsign);
            this.log('TWR', 'event', `Go-around: ${aircraft.callsign}.`, aircraft.callsign);
          }
        }
        return;
      case 'taxiing':
        this.taxi(aircraft, reached);
        return;
      default:
        return;
    }
  }

  private taxi(aircraft: Aircraft, reached: string[]): void {
    if (aircraft.segment === null) {
      const next = aircraft.legs[0];
      if (!next || next.kind === 'cross') {
        aircraft.status = 'holding';
        return;
      }
      aircraft.segment = next.id;
      aircraft.node = null;
      aircraft.progress = 0;
    } else if (aircraft.progress >= this.airfield.segments.get(aircraft.segment)!.lengthM) {
      aircraft.legs.shift();
      aircraft.segment = aircraft.legs[0]!.id;
      aircraft.progress = 0;
    }
    const segment = this.airfield.segments.get(aircraft.segment)!;
    aircraft.progress = Math.min(segment.lengthM, aircraft.progress + segment.speedMps);
    if (aircraft.progress < segment.lengthM) return;
    const after = aircraft.legs[1];
    if (after && after.kind === 'seg') return;
    const leg = aircraft.legs.shift()!;
    aircraft.segment = null;
    aircraft.node = leg.to;
    aircraft.progress = 0;
    aircraft.status = 'holding';
    if (aircraft.legs.length === 0 && this.airfield.servesThreshold(leg.to)) reached.push(aircraft.callsign);
  }

  private overrun(callsign: string): void {
    const aircraft = this.state.aircraft[callsign]!;
    const strip = this.state.strips[callsign]!;
    const from = strip.frequency;
    aircraft.status = 'lining-up';
    aircraft.timer = this.timers.lineupSeconds;
    aircraft.stop = null;
    this.enterRunway(aircraft);
    strip.offer = null;
    strip.transferredSeq = null;
    strip.frequency = 'TWR';
    this.setBay(strip, 'Line up');
    this.alert(from, { rule: 'R5', text: `Runway incursion at ${aircraft.node} by ${callsign}.`, callsign });
  }

  private countRunwayChange(): void {
    const change = this.state.runwayChange;
    if (!change) return;
    change.remaining -= 1;
    if (change.remaining > 0) {
      this.state.notice = `Runway change to ${change.to} in ${durationText(change.remaining)}`;
      return;
    }
    this.state.runwayChange = null;
    this.state.runwayInUse = change.to;
    for (const strip of Object.values(this.state.strips)) {
      if (this.item(strip.callsign).kind !== 'arr') continue;
      strip.runway = change.to;
      const aircraft = this.state.aircraft[strip.callsign]!;
      if (aircraft.status === 'final') aircraft.node = this.airfield.thresholdNode(change.to);
    }
    this.state.notice = `Runway in use ${change.to}`;
    this.log('INS', 'event', `Runway in use ${change.to}.`, null);
  }

  // ---------- commands ----------

  private check(position: Position, raw: string): Checked | Refusal {
    const s = this.state;
    const text = normalise(raw);
    if (text === '') return { ok: false, message: GENERAL_USAGE };
    const words = text.split(' ');
    const callsign = words[0]!;
    const aircraft = s.aircraft[callsign];
    const strip = s.strips[callsign];
    if (!aircraft || !strip) return { ok: false, message: `Unknown callsign ${callsign}.` };
    if (strip.frequency !== position) return { ok: false, message: `${callsign} is not on your frequency.` };
    const grammar = parseInstruction(words.slice(1), position);
    if (!grammar.ok) return grammar;
    const command = grammar.command;
    const unknownPoint = (point: string): Refusal | null =>
      this.airfield.isHoldingPoint(point) ? null : { ok: false, message: `Unknown holding point ${point}.` };
    const unknownRunway = (runway: string): Refusal | null =>
      this.airfield.isThreshold(runway) ? null : { ok: false, message: `Unknown runway ${runway}.` };
    let legs: Leg[] | null = null;
    switch (command.verb) {
      case 'TAXI': {
        const refusal = unknownPoint(command.point);
        if (refusal) return refusal;
        legs = findRoute(this.airfield, aircraft, command.point, command.via);
        if (!legs) {
          const via = command.via.length > 0 ? ` via ${command.via.join(' ')}` : '';
          return { ok: false, message: `No route to ${command.point}${via}.` };
        }
        break;
      }
      case 'LINEUP':
      case 'TAKEOFF':
      case 'LAND': {
        const refusal = unknownRunway(command.runway);
        if (refusal) return refusal;
        break;
      }
      case 'CROSS': {
        const refusal = unknownRunway(command.runway) ?? unknownPoint(command.point);
        if (refusal) return refusal;
        break;
      }
      default:
        break;
    }
    if ((command.verb === 'LINEUP' || command.verb === 'TAKEOFF') && command.runway !== s.runwayInUse) {
      return { ok: false, message: `Runway ${command.runway} is not in use.` };
    }
    if (s.emergency && s.emergency !== callsign && HELD_FOR_EMERGENCY.includes(command.verb)) {
      return { ok: false, message: `All traffic is holding for ${s.emergency}.` };
    }
    if (!this.allowed(aircraft, strip, command)) return { ok: false, message: `${callsign} cannot do that now.` };
    if (command.verb === 'NEGATIVE') {
      const open = s.readbackErrors.find((error) => error.callsign === callsign);
      if (!open) return { ok: false, message: `${callsign} has nothing to correct.` };
      if (open.kind !== command.what || open.value !== command.value) {
        return { ok: false, message: 'That is not the clearance you gave.' };
      }
    }
    return { ok: true, callsign, command, text, legs };
  }

  private allowed(aircraft: Aircraft, strip: Strip, command: Command): boolean {
    const status = aircraft.status;
    switch (command.verb) {
      case 'PUSH':
        return status === 'parked';
      case 'TAXI':
        return (status === 'ready' || status === 'taxiing' || status === 'stopped') && !strip.offer;
      case 'HOLD':
        return status === 'taxiing';
      case 'CONTINUE':
        return status === 'stopped';
      case 'CONTACT':
        return (status === 'taxiing' || status === 'stopped' || status === 'holding') && !strip.offer;
      case 'LINEUP':
        return (
          status === 'holding' &&
          aircraft.legs.length === 0 &&
          aircraft.node !== null &&
          this.airfield.servesThreshold(aircraft.node) === command.runway
        );
      case 'TAKEOFF':
        return status === 'lined-up';
      case 'LAND':
        return status === 'final' && strip.runway === command.runway;
      case 'CROSS':
        return status === 'holding' && aircraft.node === command.point && aircraft.legs[0]?.kind === 'cross';
      case 'GOAROUND':
        return status === 'final';
      case 'NEGATIVE':
        return true;
    }
  }

  preview(position: Position, raw: string): PreviewResult {
    const first = normalise(raw).split(' ')[0] ?? '';
    const strip = this.state.strips[first];
    const callsign = strip && strip.frequency === position ? first : null;
    const checked = this.check(position, raw);
    if (!checked.ok || checked.command.verb !== 'TAXI' || !checked.legs) {
      return { callsign, route: [], stop: null, conflicts: [] };
    }
    const conflicts = taxiConflicts(this.state, checked.callsign, checked.legs, checked.command.point).marks;
    return { callsign, route: segmentIds(checked.legs), stop: checked.command.point, conflicts };
  }

  command(position: Position, raw: string): CommandResult {
    const checked = this.check(position, raw);
    if (!checked.ok) return checked;
    const { callsign, command, text, legs } = checked;
    const alerts = clearanceAlerts(this, callsign, command, legs);
    const readback = this.readback(callsign, command);
    this.execute(position, callsign, command, legs, text);
    this.log(position, 'command', text, callsign);
    this.log(position, 'readback', readback, callsign);
    for (const alert of alerts) this.alert(position, alert);
    this.settle();
    return { ok: true, callsign, readback, alerts: alerts.map(({ rule, text: alertText }) => ({ rule, text: alertText })) };
  }

  /** The readback as the pilot says it, seeded with an error when the formula picks this one. */
  private readback(callsign: string, command: Command): string {
    const s = this.state;
    let wrong = false;
    if (ELIGIBLE.includes(command.verb)) {
      s.eligibleReadbacks += 1;
      const every = this.scenario.readbackErrorEvery ?? this.timers.readbackErrorEvery;
      const open = s.readbackErrors.some((error) => error.callsign === callsign);
      const n = this.scenario.seed + this.timers.simSeedOffset + s.eligibleReadbacks;
      if (every > 0 && !open && ((n % every) + every) % every === 0) {
        wrong = true;
        s.readbackErrors.push({
          callsign,
          deadline: s.now + this.timers.readbackCorrectSeconds,
          kind: command.verb === 'TAXI' ? 'HP' : 'RUNWAY',
          value: command.verb === 'TAXI' ? command.point : 'runway' in command ? command.runway : '',
        });
      }
    }
    const runway = (value: string) => (wrong ? this.airfield.reciprocal(value) : value);
    switch (command.verb) {
      case 'PUSH':
        return `Push approved, ${callsign}.`;
      case 'TAXI': {
        const point = wrong ? this.airfield.nextServingHoldingPoint(command.point) : command.point;
        const via = command.via.length > 0 ? ` via ${command.via.join(' ')}` : '';
        return `Taxi holding point ${point}${via}, ${callsign}.`;
      }
      case 'HOLD':
        return `Holding position, ${callsign}.`;
      case 'CONTINUE':
        return `Continuing taxi, ${callsign}.`;
      case 'CONTACT':
        return `Contact Tower, ${callsign}.`;
      case 'LINEUP':
        return `Line up runway ${runway(command.runway)}, ${callsign}.`;
      case 'TAKEOFF':
        return `Cleared for takeoff runway ${runway(command.runway)}, ${callsign}.`;
      case 'LAND':
        return `Cleared to land runway ${runway(command.runway)}, ${callsign}.`;
      case 'CROSS':
        return `Cross runway ${runway(command.runway)} at ${command.point}, ${callsign}.`;
      case 'GOAROUND':
        return `Going around, ${callsign}.`;
      case 'NEGATIVE':
        return command.what === 'RUNWAY'
          ? `Correct, runway ${command.value}, ${callsign}.`
          : `Correct, holding point ${command.value}, ${callsign}.`;
    }
  }

  private execute(position: Position, callsign: string, command: Command, legs: Leg[] | null, text: string): void {
    const s = this.state;
    const aircraft = s.aircraft[callsign]!;
    const strip = s.strips[callsign]!;
    if (command.verb !== 'NEGATIVE' && command.verb !== 'GOAROUND') strip.cleared = text.slice(callsign.length + 1);
    switch (command.verb) {
      case 'PUSH':
        aircraft.status = 'pushing';
        aircraft.timer = this.timers.pushSeconds;
        this.setBay(strip, 'Pushback');
        return;
      case 'TAXI':
        aircraft.legs = legs!;
        aircraft.status = 'taxiing';
        aircraft.stop = command.point;
        aircraft.routeBy = position;
        this.setBay(strip, 'Taxi');
        return;
      case 'HOLD':
        aircraft.status = 'stopped';
        return;
      case 'CONTINUE':
        aircraft.status = 'taxiing';
        return;
      case 'CONTACT':
        this.setBay(strip, 'Hand-off');
        strip.offer = { expiresAt: s.now + this.timers.handoffOfferSeconds, seq: this.nextSeq() };
        return;
      case 'LINEUP':
        aircraft.status = 'lining-up';
        aircraft.timer = this.timers.lineupSeconds;
        aircraft.stop = null;
        this.enterRunway(aircraft);
        this.setBay(strip, 'Line up');
        return;
      case 'TAKEOFF':
        aircraft.status = 'rolling';
        aircraft.timer = this.timers.takeoffRollSeconds;
        aircraft.takeoffStart = s.now;
        s.lastTakeoff = { callsign, wake: this.wakeOf(callsign), start: s.now };
        this.setBay(strip, 'Departed');
        return;
      case 'LAND':
        aircraft.landClear = true;
        return;
      case 'CROSS':
        aircraft.status = 'crossing';
        aircraft.timer = this.timers.crossSeconds;
        this.enterRunway(aircraft);
        return;
      case 'GOAROUND':
        this.goAround(callsign);
        return;
      case 'NEGATIVE':
        s.readbackErrors = s.readbackErrors.filter((error) => error.callsign !== callsign);
        return;
    }
  }

  private goAround(callsign: string): void {
    const aircraft = this.state.aircraft[callsign]!;
    const strip = this.state.strips[callsign]!;
    aircraft.status = 'final';
    aircraft.due = this.timers.goAroundSeconds;
    aircraft.landClear = false;
    aircraft.runwayEntry = null;
    strip.goAround = true;
    strip.cleared = null;
  }

  // ---------- strip moves and edits ----------

  private versionConflict(strip: Strip, version: number): StripActionResult | null {
    return strip.version === version
      ? null
      : { ok: false, conflict: true, message: `${strip.callsign} was changed by another seat first. Your action was not applied.` };
  }

  move(position: Position, callsign: string, to: string, version: number): StripActionResult {
    const strip = this.state.strips[callsign]!;
    const conflict = this.versionConflict(strip, version);
    if (conflict) return conflict;
    if (strip.offer && position === 'TWR' && to === 'Holding') {
      strip.offer = null;
      strip.frequency = 'TWR';
      strip.transferredSeq = strip.seq;
      this.setBay(strip, 'Holding');
      this.log('TWR', 'event', `Handoff accepted: ${callsign}.`, callsign);
      this.settle();
      return { ok: true };
    }
    if (strip.offer && position === 'GND' && to === 'Taxi') {
      strip.offer = null;
      this.setBay(strip, 'Taxi');
      this.log('GND', 'event', `Handoff recalled: ${callsign}.`, callsign);
      this.settle();
      return { ok: true };
    }
    if (strip.frequency !== position) return { ok: false, conflict: false, message: `${callsign} is not on your frequency.` };
    return { ok: false, conflict: false, message: `${callsign} cannot move there.` };
  }

  edit(position: Position, callsign: string, holdingPoint: string, remarks: string, version: number): StripActionResult {
    const strip = this.state.strips[callsign]!;
    const conflict = this.versionConflict(strip, version);
    if (conflict) return conflict;
    if (strip.frequency !== position) return { ok: false, conflict: false, message: `${callsign} is not on your frequency.` };
    const point = holdingPoint.trim().toUpperCase();
    if (point !== '' && !this.airfield.isHoldingPoint(point)) {
      return { ok: false, conflict: false, message: `Unknown holding point ${point}.` };
    }
    strip.holdingPoint = point === '' ? null : point;
    strip.remarks = remarks;
    this.settle();
    return { ok: true };
  }

  // ---------- events ----------

  inject(event: SimEvent): EventResult {
    const result = this.applyEvent(event, 'INS');
    this.settle();
    return result;
  }

  private applyEvent(event: SimEvent, position: LogPosition): EventResult {
    const s = this.state;
    const unknown = (word: string): EventResult => ({ ok: false, error: 'parse', message: `Unknown callsign ${word}.` });
    switch (event.kind) {
      case 'closure':
        s.closed = true;
        s.notice = `Runway ${s.runwayInUse} closed`;
        this.log(position, 'event', `Runway ${s.runwayInUse} closed.`, null);
        return { ok: true };
      case 'reopen':
        s.closed = false;
        s.notice = `Runway ${s.runwayInUse} reopened`;
        this.log(position, 'event', `Runway ${s.runwayInUse} reopened.`, null);
        return { ok: true };
      case 'go-around': {
        const callsign = (event.callsign ?? '').toUpperCase();
        const aircraft = s.aircraft[callsign];
        if (!aircraft) return unknown(callsign);
        if (aircraft.status !== 'final') return { ok: false, error: 'not_final', message: `${callsign} is not on final.` };
        this.goAround(callsign);
        this.log(position, 'event', `Go-around: ${callsign}.`, callsign);
        return { ok: true };
      }
      case 'emergency': {
        const callsign = (event.callsign ?? '').toUpperCase();
        if (!s.aircraft[callsign]) return unknown(callsign);
        if (s.emergency) this.clearEmergency();
        s.emergency = callsign;
        s.aircraft[callsign]!.emergency = true;
        s.strips[callsign]!.emergency = true;
        for (const aircraft of Object.values(s.aircraft)) {
          if (aircraft.callsign !== callsign && aircraft.status === 'taxiing') aircraft.status = 'stopped';
        }
        s.notice = `Emergency ${callsign}: all traffic hold.`;
        this.log(position, 'event', `Emergency: ${callsign}.`, callsign);
        return { ok: true };
      }
      case 'end-emergency': {
        const callsign = s.emergency;
        if (!callsign) return { ok: false, error: 'parse', message: 'There is no emergency to end.' };
        this.clearEmergency();
        s.notice = '';
        this.log(position, 'event', `Emergency ended: ${callsign}.`, callsign);
        return { ok: true };
      }
      case 'wind': {
        const dir = event.windDir ?? 0;
        s.wind = { dir, kt: event.windKt ?? 0 };
        const favoured = this.airfield.thresholdIds.filter((id) => {
          const diff = Math.abs((((this.airfield.thresholdHeading(id) - dir) % 360) + 540) % 360 - 180);
          return diff < 90;
        });
        this.log(position, 'event', `Wind ${String(dir).padStart(3, '0')} at ${s.wind.kt} kt.`, null);
        if (favoured.length === 1) {
          const target = favoured[0]!;
          if (target !== s.runwayInUse) {
            s.runwayChange = { to: target, remaining: this.timers.windChangeDelaySeconds };
            s.notice = `Runway change to ${target} in ${durationText(this.timers.windChangeDelaySeconds)}`;
          } else if (s.runwayChange) {
            s.runwayChange = null;
            s.notice = '';
          }
        }
        return { ok: true };
      }
    }
  }

  private clearEmergency(): void {
    const callsign = this.state.emergency;
    if (!callsign) return;
    this.state.emergency = null;
    this.state.aircraft[callsign]!.emergency = false;
    this.state.strips[callsign]!.emergency = false;
  }

  get simClock(): string {
    return clockText(this.state.now);
  }
}

export function signatureOf(strip: Strip): string {
  return JSON.stringify([
    strip.bay,
    strip.offer ? 'offered' : 'active',
    strip.frequency,
    strip.cleared,
    strip.holdingPoint,
    strip.remarks,
    strip.emergency,
    strip.transferredSeq !== null,
  ]);
}
