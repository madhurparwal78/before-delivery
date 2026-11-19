// Verifies the published worked examples and movement examples against the domain rules.
import { loadConfig } from "../src/shared/config";
import { presentCreatures, weatherAt, timeOfTick, hourOfTick } from "../src/shared/creatures";
import { creaturesInFrame, scoreOf, Pose } from "../src/shared/frame";
import { walkPath, stepOf, Explorer } from "../src/shared/movement";
import { isLand } from "../src/shared/world";

const config = loadConfig();
let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail ?? ""}`); } else console.log(`ok   ${name}`);
}

// Route rule examples
const heron6000 = presentCreatures(6000, config).find(c => c.id === "reedpipe-heron")!;
check("heron 6000 at 6,16 E", heron6000.x === 6 && heron6000.y === 16 && heron6000.heading === "E", JSON.stringify(heron6000));
const heron6030 = presentCreatures(6030, config).find(c => c.id === "reedpipe-heron")!;
check("heron 6030 at 9,16 E", heron6030.x === 9 && heron6030.y === 16 && heron6030.heading === "E", JSON.stringify(heron6030));
const heron11000 = presentCreatures(11000, config).find(c => c.id === "reedpipe-heron")!;
check("heron 11000 at 10,16 W", heron11000.x === 10 && heron11000.y === 16 && heron11000.heading === "W", JSON.stringify(heron11000));

// Times
check("tick 6000 is 10:00", timeOfTick(6000, config.worldDayTicks) === "10:00", timeOfTick(6000, config.worldDayTicks));
check("tick 11000 is 18:20", timeOfTick(11000, config.worldDayTicks) === "18:20", timeOfTick(11000, config.worldDayTicks));
check("tick 4000 is 06:40", timeOfTick(4000, config.worldDayTicks) === "06:40", timeOfTick(4000, config.worldDayTicks));
check("tick 4000 is rain", weatherAt(4000, config) === "rain");
check("tick 6000 is clear", weatherAt(6000, config) === "clear");
check("tick 11000 is dusk hour 18", hourOfTick(11000, config.worldDayTicks) === 18);

// Worked examples
const ex: [string, Pose, string, number][] = [
  ["ex1", { island: 1, tile: [12, 10], camera: [12, 10], heading: "N", zoom: 2, focus: 4, tick: 6000 }, "mossback-newt", 100],
  ["ex2", { island: 1, tile: [12, 10], camera: [12, 10], heading: "N", zoom: 1, focus: 2, tick: 6000 }, "mossback-newt", 70],
  ["ex3", { island: 1, tile: [13, 10], camera: [13, 10], heading: "N", zoom: 2, focus: 8, tick: 6000 }, "mossback-newt", 60],
  ["ex4", { island: 1, tile: [8, 20], camera: [8, 20], heading: "N", zoom: 1, focus: 4, tick: 6030 }, "reedpipe-heron", 80],
  ["ex5", { island: 1, tile: [20, 12], camera: [20, 12], heading: "W", zoom: 1, focus: 2, tick: 11000 }, "gloamfin-moth", 75]
];
const expectedRows: Record<string, [number, number, number, number]> = {
  ex1: [30, 25, 25, 20], ex2: [10, 25, 25, 10], ex3: [30, 5, 25, 0], ex4: [30, 15, 15, 20], ex5: [30, 25, 0, 20]
};
for (const [name, pose, subjectId, total] of ex) {
  const states = presentCreatures(pose.tick, config).filter(c => c.island === pose.island);
  const inFrame = creaturesInFrame(pose, states);
  const subject = inFrame[0];
  check(`${name} subject`, subject?.id === subjectId, JSON.stringify(inFrame.map(c => c.id)));
  if (subject) {
    const { score } = scoreOf(pose, subject);
    const [s, c, f, p] = expectedRows[name];
    check(`${name} rows`, score.size === s && score.centring === c && score.facing === f && score.sharpness === p && score.total === total,
      JSON.stringify(score));
  }
}
// in-view lists for examples 4 and 5
// ex4 pose: camera follows zoom/focus freely; in-view check uses the actual list
const ex4pose: Pose = { island: 1, tile: [8, 20], camera: [8, 20], heading: "N", zoom: 1, focus: 4, tick: 6030 };
check("ex4 in-view", creaturesInFrame(ex4pose, presentCreatures(6030, config).filter(c => c.island === 1)).map(c => c.id).join(",") === "reedpipe-heron,mossback-newt",
  creaturesInFrame(ex4pose, presentCreatures(6030, config).filter(c => c.island === 1)).map(c => `${c.id}@${c.x},${c.y}`).join(","));
const ex5pose: Pose = { island: 1, tile: [20, 12], camera: [20, 12], heading: "W", zoom: 1, focus: 2, tick: 11000 };
check("ex5 in-view @11000", creaturesInFrame(ex5pose, presentCreatures(11000, config).filter(c => c.island === 1)).map(c => c.id).join(",") === "gloamfin-moth,reedpipe-heron",
  creaturesInFrame(ex5pose, presentCreatures(11000, config).filter(c => c.island === 1)).map(c => `${c.id}@${c.x},${c.y}`).join(","));
check("ex5 in-view @6000", creaturesInFrame({ ...ex5pose, tick: 6000 }, presentCreatures(6000, config).filter(c => c.island === 1)).map(c => c.id).join(",") === "reedpipe-heron",
  creaturesInFrame({ ...ex5pose, tick: 6000 }, presentCreatures(6000, config).filter(c => c.island === 1)).map(c => `${c.id}@${c.x},${c.y}`).join(","));

// From spot 1 facing E at tick 6000 nothing in frame at any zoom
for (const zoom of [1, 2, 3, 4]) {
  const p: Pose = { island: 1, tile: [3, 12], camera: [3, 12], heading: "E", zoom, focus: 4, tick: 6000 };
  const list = creaturesInFrame(p, presentCreatures(6000, config).filter(c => c.island === 1));
  check(`spot1 E zoom ${zoom} empty`, list.length === 0, list.map(c => `${c.id}@${c.x},${c.y}`).join(","));
}

// DP-05: holding D 400ms from spot 1 walks to 5,12; then R with D runs to 9,12
function simulate(e0: Explorer, dir: "D" | "R" | null, steps: number, running: boolean): Explorer {
  let e = { ...e0, tile: [...e0.tile] as [number, number] };
  let heldSteps = 0;
  let jumpSteps = 0;
  for (let i = 0; i < steps; i++) {
    const dirH = dir === "D" ? "E" : null;
    const res = stepOf(e, 1, { direction: dirH, running, jumpQueued: false }, isLand, heldSteps, jumpSteps);
    e = { tile: res.tile, heading: res.heading, gait: res.gait };
    if (dirH !== null) heldSteps++;
    else heldSteps = 0;
    jumpSteps = res.jumpSteps;
  }
  return e;
}
const spot1: Explorer = { tile: [3, 12], heading: "E", gait: "idle" };
const afterWalk = simulate(spot1, "D", 4, false);
check("DP-05 walk 400ms to 5,12", afterWalk.tile[0] === 5 && afterWalk.tile[1] === 12, JSON.stringify(afterWalk.tile));
const afterRun = simulate(afterWalk, "D", 4, true);
check("DP-05 run 400ms to 9,12", afterRun.tile[0] === 9 && afterRun.tile[1] === 12, JSON.stringify(afterRun.tile));

// DP-06: from 7,5 holding S stops at rock 7,6 with heading S
const atRock = simulate({ tile: [7, 5], heading: "S", gait: "idle" }, "D", 2, false); // dir hack below
// proper: holding S
function simulateDir(e0: Explorer, direction: "N" | "E" | "S" | "W", steps: number, running: boolean): Explorer {
  let e = { ...e0, tile: [...e0.tile] as [number, number] };
  let heldSteps = 0;
  let jumpSteps = 0;
  for (let i = 0; i < steps; i++) {
    const res = stepOf(e, 1, { direction, running, jumpQueued: false }, isLand, heldSteps, jumpSteps);
    e = { tile: res.tile, heading: res.heading, gait: res.gait };
    heldSteps++;
    jumpSteps = res.jumpSteps;
  }
  return e;
}
const sHold = simulateDir({ tile: [7, 5], heading: "N", gait: "idle" }, "S", 2, false);
check("DP-06 S stops at 7,5 heading S", sHold.tile[0] === 7 && sHold.tile[1] === 5 && sHold.heading === "S", JSON.stringify(sHold));
// jump from 7,5 facing S lands on 7,7 on the 4th step
let e: Explorer = { tile: [7, 5], heading: "S", gait: "idle" };
let jumpSteps = 0;
const jumpSeq: string[] = [];
for (let i = 0; i < 4; i++) {
  const res = stepOf(e, 1, { direction: null, running: false, jumpQueued: i === 0 }, isLand, 0, jumpSteps);
  e = { tile: res.tile, heading: res.heading, gait: res.gait };
  jumpSteps = res.jumpSteps;
  jumpSeq.push(`${e.gait}@${e.tile}`);
}
check("DP-06 jump lands 7,7", e.tile[0] === 7 && e.tile[1] === 7, JSON.stringify(jumpSeq));
check("DP-06 jump gait jump through 4th", jumpSeq.every(s => s.startsWith("jump")), JSON.stringify(jumpSeq));

// DP-11: walk path from spot 1 to 12,10
const path = walkPath(1, [3, 12], [12, 10], isLand);
check("DP-11 path exists", path !== null);
if (path) {
  check("DP-11 first tiles 3,11 then 3,10", path[0][0] === 3 && path[0][1] === 11 && path[1][0] === 3 && path[1][1] === 10, JSON.stringify(path.slice(0, 4)));
  check("DP-11 then east 4,10..12,10", path[2][0] === 4 && path[2][1] === 10 && path[path.length - 1][0] === 12 && path[path.length - 1][1] === 10, JSON.stringify(path.slice(0, 8)));
}

// DP-30 creatures string at tick 6000
const c6000 = presentCreatures(6000, config).filter(c => c.island === 1).map(c => `${c.id}@${c.x},${c.y},${c.heading}`).join(";");
check("DP-30 creatures", c6000 === "mossback-newt@12,6,S;reedpipe-heron@6,16,E", c6000);
const c6030 = presentCreatures(6030, config).filter(c => c.island === 1).map(c => `${c.id}@${c.x},${c.y},${c.heading}`).join(";");
check("DP-31 heron 9,16 E @6030", c6030.includes("reedpipe-heron@9,16,E"), c6030);
const c11000 = presentCreatures(11000, config).filter(c => c.island === 1).map(c => `${c.id}@${c.x},${c.y},${c.heading}`).join(";");
check("DP-33 moth present @11000", c11000.includes("gloamfin-moth@18,12,W"), c11000);
const rain4000 = presentCreatures(4000, config).filter(c => c.island === 1).map(c => `${c.id}@${c.x},${c.y},${c.heading}`).join(";");
check("DP-34 lark 4,4 S @4000", rain4000.includes("puddle-lark@4,4,S"), rain4000);

console.log(failures === 0 ? "ALL DOMAIN CHECKS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
