import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timers as defaultTimers } from '../server/config.js';
import { Airfield, KESTREL_DOWN, WRENFIELD } from '../server/layouts.js';
import { Engine } from '../server/sim/engine.js';
import type { Scenario, TrafficItem } from '../server/sim/model.js';
import { buildDebrief } from '../server/sim/score.js';
import { aircraftViews, snapshot, stripViews } from '../server/sim/view.js';

const timers = { ...defaultTimers, readbackErrorEvery: 0 };

function dep(callsign: string, type: string, wake: TrafficItem['wake'], stand: string, extra: Partial<TrafficItem> = {}): TrafficItem {
  return {
    callsign,
    type,
    wake,
    rules: 'VFR',
    kind: 'dep',
    stand,
    holdingPoint: 'A1',
    runway: null,
    appearAt: 0,
    dueSeconds: null,
    slotSeconds: null,
    overrunsHold: false,
    ...extra,
  };
}

function scenario(traffic: TrafficItem[], extra: Partial<Scenario> = {}): Scenario {
  return {
    name: 'Wake check',
    aerodrome: 'wrenfield',
    runwayInUse: '27',
    windDir: 270,
    windKt: 8,
    startSimTime: '12:00:00',
    durationSeconds: 3600,
    seed: 0,
    readbackErrorEvery: 0,
    traffic,
    events: [],
    ...extra,
  };
}

function engineFor(sc: Scenario, t = timers): Engine {
  const engine = new Engine(sc, new Airfield(WRENFIELD), t, Engine.initialState(sc, null));
  engine.open();
  return engine;
}

function runTo(engine: Engine, second: number): void {
  while (engine.state.now - engine.state.firstTime < second && engine.state.status !== 'ended') engine.tick();
}

test('worked exercise gives 80 with 25 rows', () => {
  const engine = engineFor(
    scenario([dep('GBULK', 'B744', 'H', 'S3', { rules: 'IFR' }), dep('GLITE', 'PA28', 'L', 'S4')]),
  );
  const snaps: Record<number, ReturnType<typeof snapshot>> = {};
  const script: [number, 'GND' | 'TWR', string][] = [
    [0, 'GND', 'GBULK PUSH APPROVED'],
    [30, 'GND', 'GBULK TAXI HP A1 VIA A'],
    [40, 'GND', 'GBULK CONTACT TOWER'],
    [41, 'TWR', 'move GBULK'],
    [60, 'GND', 'GLITE PUSH APPROVED'],
    [100, 'TWR', 'GBULK LINEUP 27'],
    [120, 'TWR', 'GBULK CLEARED TAKEOFF 27'],
    [120, 'GND', 'GLITE TAXI HP A1 VIA A'],
    [191, 'GND', 'GLITE CONTACT TOWER'],
    [192, 'TWR', 'move GLITE'],
    [192, 'TWR', 'GLITE LINEUP 27'],
    [212, 'TWR', 'GLITE CLEARED TAKEOFF 27'],
  ];
  for (const [at, position, text] of script) {
    while (engine.state.now - engine.state.firstTime < at) {
      engine.tick();
      snaps[engine.state.now - engine.state.firstTime] = snapshot(engine);
    }
    if (text.startsWith('move')) {
      const cs = text.split(' ')[1]!;
      const r = engine.move(position, cs, 'Holding', engine.state.strips[cs]!.version);
      assert.equal(r.ok, true, JSON.stringify(r));
    } else {
      const r = engine.command(position, text);
      assert.equal(r.ok, true, `${text}: ${JSON.stringify(r)}`);
    }
    snaps[at] = snapshot(engine);
  }
  while (engine.state.status !== 'ended') {
    engine.tick();
    snaps[engine.state.now - engine.state.firstTime] = snapshot(engine);
  }
  assert.equal(engine.state.now - engine.state.firstTime, 242);
  const debrief = buildDebrief(engine);
  assert.equal(debrief.score, 80);
  assert.equal(debrief.log.length, 25);
  assert.deepEqual(
    debrief.breakdown.map((b) => [b.simTime, b.text]),
    [
      ['12:03:10', 'Late handoff: GLITE reached A1 on Ground.'],
      ['12:03:32', 'Wake: 2:00 required behind GBULK (H), 1:32 elapsed.'],
    ],
  );
  const at = (t: number, cs: string) => snaps[t]!.aircraft.find((a) => a.callsign === cs)!;
  assert.deepEqual([at(50, 'GBULK').segment, at(50, 'GBULK').progress], ['S3T', 100]);
  assert.deepEqual([at(70, 'GBULK').segment, at(70, 'GBULK').progress], ['E1', 200]);
  assert.equal(at(101, 'GBULK').status, 'lining-up');
});

test('taxi movement worked example', () => {
  const engine = engineFor(scenario([dep('GQRST', 'C172', 'L', 'S3')]));
  engine.state.aircraft.GQRST!.status = 'ready';
  engine.state.strips.GQRST!.bay = 'Pushback';
  const r = engine.command('GND', 'gqrst  taxi hp a1 via a');
  assert.deepEqual(r.ok && r.readback, 'Taxi holding point A1 via A, GQRST.');
  const expect: Record<number, [string | null, string | null, number]> = {
    5: ['S3T', null, 25],
    20: ['S3T', null, 100],
    21: ['E1', null, 10],
    40: ['E1', null, 200],
    41: ['A2', null, 10],
    70: [null, 'A1', 0],
  };
  for (let t = 1; t <= 70; t++) {
    engine.tick();
    const want = expect[t];
    if (!want) continue;
    const a = aircraftViews(engine)[0]!;
    assert.deepEqual([a.segment, a.node, a.progress], want, `t=${t}`);
  }
  assert.equal(engine.state.aircraft.GQRST!.status, 'holding');
});

test('refusals in order', () => {
  const engine = engineFor(scenario([dep('GABCD', 'C172', 'L', 'S1')]));
  const refuse = (pos: 'GND' | 'TWR', text: string) => {
    const r = engine.command(pos, text);
    return r.ok ? 'accepted' : r.message;
  };
  assert.equal(refuse('GND', 'GABCX TAXI HP A1'), 'Unknown callsign GABCX.');
  assert.equal(refuse('TWR', 'GABCD LINEUP 27'), 'GABCD is not on your frequency.');
  assert.equal(refuse('GND', 'GABCD LINEUP 27'), 'LINEUP is a Tower instruction.');
  assert.equal(refuse('GND', 'GABCD'), 'Usage: <CALLSIGN> <VERB> <ARGS>.');
  assert.equal(refuse('GND', 'GABCD FLY'), 'Unknown command FLY.');
  assert.equal(refuse('GND', 'GABCD TAXI HP A1 VIA C'), 'No route to A1 via C.');
  assert.equal(refuse('GND', 'GABCD TAXI HP Z9'), 'Unknown holding point Z9.');
  assert.equal(refuse('GND', 'GABCD TAXI HP A1 VIA A'), 'GABCD cannot do that now.');
  assert.equal(refuse('GND', 'GABCD NEGATIVE HP A1'), 'GABCD has nothing to correct.');
  assert.equal(refuse('GND', 'GABCD PUSH'), 'Usage: <CS> PUSH APPROVED.');
  assert.equal(refuse('GND', '   '), 'Usage: <CALLSIGN> <VERB> <ARGS>.');
});

test('R4 conflict and preview', () => {
  const engine = engineFor(scenario([dep('GABCD', 'C172', 'L', 'S1'), dep('GQRST', 'C172', 'L', 'S3', { holdingPoint: 'A6' })]));
  for (const cs of ['GABCD', 'GQRST']) {
    engine.state.aircraft[cs]!.status = 'ready';
    engine.state.strips[cs]!.bay = 'Pushback';
  }
  assert.equal(engine.command('GND', 'GQRST TAXI HP A6').ok, true);
  const preview = engine.preview('GND', 'GABCD TAXI HP A1 VIA A');
  assert.deepEqual(preview.route, ['S1T', 'W1', 'A4', 'A3', 'A2']);
  assert.deepEqual(preview.conflicts, [
    { segment: 'A4', rule: 'R4' },
    { segment: 'A3', rule: 'R4' },
  ]);
  const r = engine.command('GND', 'GABCD TAXI HP A1 VIA A');
  assert.deepEqual(r.ok && r.alerts, [{ rule: 'R4', text: 'Taxi conflict on A4: GQRST and GABCD.' }]);
  const views = stripViews(engine);
  assert.equal(views.find((v) => v.callsign === 'GABCD')!.cleared, 'TAXI HP A1 VIA A');
});

test('readback errors follow formula', () => {
  const sc = scenario([dep('GABCD', 'C172', 'L', 'S1')], { seed: 2, readbackErrorEvery: 3 });
  const engine = engineFor(sc);
  engine.state.aircraft.GABCD!.status = 'ready';
  const r = engine.command('GND', 'GABCD TAXI HP A1 VIA A');
  assert.equal(r.ok && r.readback, 'Taxi holding point A6 via A, GABCD.');
  const wrong = engine.command('GND', 'GABCD NEGATIVE HP A6');
  assert.equal(!wrong.ok && wrong.message, 'That is not the clearance you gave.');
  const right = engine.command('GND', 'GABCD NEGATIVE HP A1');
  assert.equal(right.ok && right.readback, 'Correct, holding point A1, GABCD.');
});

test('R7 fires on the deadline tick', () => {
  const sc = scenario([dep('GABCD', 'C172', 'L', 'S1')], { seed: 2, readbackErrorEvery: 3 });
  const engine = engineFor(sc);
  engine.state.aircraft.GABCD!.status = 'ready';
  engine.command('GND', 'GABCD TAXI HP A1 VIA A');
  runTo(engine, 14);
  assert.equal(engine.state.log.filter((r) => r.rule === 'R7').length, 0);
  runTo(engine, 15);
  assert.equal(engine.state.log.filter((r) => r.rule === 'R7').length, 1);
});

test('overrun raises R5 and occupies runway', () => {
  const engine = engineFor(
    scenario([dep('GQRST', 'C172', 'L', 'S3', { overrunsHold: true }), dep('GABCD', 'C172', 'L', 'S4')]),
  );
  engine.state.aircraft.GQRST!.status = 'ready';
  engine.command('GND', 'GQRST TAXI HP A1');
  runTo(engine, 70);
  const alerts = engine.state.log.filter((r) => r.kind === 'alert');
  assert.deepEqual(alerts.map((a) => [a.rule, a.text, a.position]), [['R5', 'Runway incursion at A1 by GQRST.', 'GND']]);
  assert.equal(engine.state.strips.GQRST!.bay, 'Line up');
  assert.equal(engine.state.aircraft.GQRST!.status, 'lining-up');
});

function linedUp(engine: Engine, callsign: string): void {
  engine.state.aircraft[callsign]!.status = 'lined-up';
  engine.state.aircraft[callsign]!.node = 'A1';
  engine.state.strips[callsign]!.bay = 'Line up';
  engine.state.strips[callsign]!.frequency = 'TWR';
}

test('wake and runway occupancy worked examples', () => {
  const run = (clearAt: string, bulkRolling: boolean) => {
    const sc = scenario([dep('GBULK', 'B744', 'H', 'S3'), dep('GLITE', 'PA28', 'L', 'S4')], { startSimTime: '12:03:00' });
    const engine = engineFor(sc);
    const bulk = engine.state.aircraft.GBULK!;
    bulk.status = bulkRolling ? 'rolling' : 'airborne';
    bulk.timer = 30;
    bulk.takeoffStart = 12 * 3600 + 3 * 60 + 48;
    bulk.runwayEntry = 1;
    engine.state.lastTakeoff = { callsign: 'GBULK', wake: 'H', start: bulk.takeoffStart };
    linedUp(engine, 'GLITE');
    const [h, m, s] = clearAt.split(':').map(Number);
    engine.state.now = h! * 3600 + m! * 60 + s!;
    const wake = stripViews(engine).find((v) => v.callsign === 'GLITE')!.timers.find((t) => t.kind === 'wake');
    const r = engine.command('TWR', 'GLITE CLEARED TAKEOFF 27');
    return { alerts: r.ok ? r.alerts.map((a) => a.text) : [r.message], wake: wake?.text ?? null };
  };
  assert.deepEqual(run('12:05:00', false), {
    alerts: ['Wake: 2:00 required behind GBULK (H), 1:12 elapsed.'],
    wake: 'Wake 0:48',
  });
  assert.deepEqual(run('12:04:10', true).alerts, [
    'Runway 27 occupied by GBULK.',
    'Wake: 2:00 required behind GBULK (H), 0:22 elapsed.',
  ]);
  assert.deepEqual(run('12:05:48', false).alerts, []);
});

test('arrival protection boundary', () => {
  const arr: TrafficItem = {
    callsign: 'GDOWN', type: 'B738', wake: 'M', rules: 'IFR', kind: 'arr', stand: null, holdingPoint: null,
    runway: '27', appearAt: 0, dueSeconds: 600, slotSeconds: null, overrunsHold: false,
  };
  const at = (due: number) => {
    const engine = engineFor(scenario([arr, dep('GQRST', 'C172', 'L', 'S3')]));
    engine.state.aircraft.GDOWN!.due = due;
    const q = engine.state.aircraft.GQRST!;
    q.status = 'holding';
    q.node = 'A1';
    engine.state.strips.GQRST!.frequency = 'TWR';
    const r = engine.command('TWR', 'GQRST LINEUP 27');
    return r.ok ? r.alerts.map((a) => a.text) : [r.message];
  };
  assert.deepEqual(at(47), ['Arrival GDOWN due in 0:47; departure not allowed.']);
  assert.deepEqual(at(120), ['Arrival GDOWN due in 2:00; departure not allowed.']);
  assert.deepEqual(at(121), []);
});

test('slot delay costs whole minutes', () => {
  const sc = scenario([dep('GSLOT', 'C172', 'L', 'S1', { slotSeconds: 600 })]);
  const engine = engineFor(sc);
  engine.state.aircraft.GSLOT!.takeoffStart = 12 * 3600 + 18 * 60 + 30;
  engine.state.aircraft.GSLOT!.status = 'airborne';
  engine.end();
  const debrief = buildDebrief(engine);
  assert.deepEqual(debrief.breakdown, [{ simTime: '12:18:30', rule: 'Slot', text: 'Slot delay GSLOT: 3 min', penalty: 3 }]);
  assert.equal(debrief.score, 97);
});

test('wind change moves the runway after the delay', () => {
  const arr: TrafficItem = {
    callsign: 'GDOWN', type: 'B738', wake: 'M', rules: 'IFR', kind: 'arr', stand: null, holdingPoint: null,
    runway: '27', appearAt: 0, dueSeconds: 900, slotSeconds: null, overrunsHold: false,
  };
  const engine = engineFor(scenario([arr]));
  engine.inject({ kind: 'wind', windDir: 90, windKt: 12 });
  assert.equal(engine.state.notice, 'Runway change to 09 in 2:00');
  engine.tick();
  assert.equal(engine.state.notice, 'Runway change to 09 in 1:59');
  runTo(engine, 120);
  assert.equal(engine.state.runwayInUse, '09');
  assert.equal(engine.state.notice, 'Runway in use 09');
  assert.equal(engine.state.strips.GDOWN!.runway, '09');
  assert.equal(stripViews(engine).find((v) => v.callsign === 'GDOWN')!.forward!.command, 'GDOWN CLEARED LAND 09');
});

test('emergency holds other traffic', () => {
  const engine = engineFor(scenario([dep('GABCD', 'C172', 'L', 'S1'), dep('GQRST', 'C172', 'L', 'S3')]));
  for (const cs of ['GABCD', 'GQRST']) engine.state.aircraft[cs]!.status = 'ready';
  engine.command('GND', 'GQRST TAXI HP A1');
  engine.tick();
  engine.inject({ kind: 'emergency', callsign: 'GABCD' });
  assert.equal(engine.state.aircraft.GQRST!.status, 'stopped');
  const r = engine.command('GND', 'GQRST CONTINUE TAXI');
  assert.equal(!r.ok && r.message, 'All traffic is holding for GABCD.');
  engine.inject({ kind: 'end-emergency' });
  assert.equal(engine.state.aircraft.GQRST!.status, 'stopped');
  assert.equal(engine.command('GND', 'GQRST CONTINUE TAXI').ok, true);
});

test('Kestrel Down crossing stops for CROSS', () => {
  const sc = { ...scenario([dep('GKEST', 'C172', 'L', 'N1', { holdingPoint: 'D6' })]), aerodrome: 'kestrel-down' };
  const engine = new Engine(sc, new Airfield(KESTREL_DOWN), timers, Engine.initialState(sc, null));
  engine.open();
  engine.state.aircraft.GKEST!.status = 'ready';
  const preview = engine.preview('GND', 'GKEST TAXI HP D6');
  assert.deepEqual(preview.route, ['N1T', 'B1', 'B4', 'D4']);
  engine.command('GND', 'GKEST TAXI HP D6');
  runTo(engine, 30);
  assert.equal(engine.state.aircraft.GKEST!.status, 'holding');
  assert.equal(engine.state.aircraft.GKEST!.node, 'B2');
  engine.state.strips.GKEST!.frequency = 'TWR';
  const r = engine.command('TWR', 'GKEST CROSS 09 AT B2');
  assert.equal(r.ok && r.readback, 'Cross runway 09 at B2, GKEST.');
  runTo(engine, 60);
  assert.deepEqual([engine.state.aircraft.GKEST!.status, engine.state.aircraft.GKEST!.node], ['taxiing', 'B3']);
  engine.tick();
  assert.deepEqual([engine.state.aircraft.GKEST!.segment, engine.state.aircraft.GKEST!.progress], ['B4', 10]);
});

test('arrival auto go-around and landing', () => {
  const arr: TrafficItem = {
    callsign: 'GDOWN', type: 'B738', wake: 'M', rules: 'IFR', kind: 'arr', stand: null, holdingPoint: null,
    runway: '27', appearAt: 0, dueSeconds: 10, slotSeconds: null, overrunsHold: false,
  };
  const engine = engineFor(scenario([arr]));
  runTo(engine, 10);
  assert.equal(engine.state.aircraft.GDOWN!.due, 300);
  assert.equal(engine.state.strips.GDOWN!.goAround, true);
  const r = engine.command('TWR', 'GDOWN CLEARED LAND 27');
  assert.equal(r.ok, true);
  runTo(engine, 310);
  assert.equal(engine.state.aircraft.GDOWN!.status, 'landing');
  runTo(engine, 350);
  assert.equal(engine.state.status, 'ended');
  assert.equal(engine.state.strips.GDOWN!.bay, 'Landed');
});
