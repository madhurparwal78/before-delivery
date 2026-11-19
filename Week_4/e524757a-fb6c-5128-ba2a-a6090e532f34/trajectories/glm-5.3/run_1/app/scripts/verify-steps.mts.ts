// Simulates the page's fixed-step loop exactly: N held steps for N x 100 ms of page time.
import { stepOf, Explorer } from "../src/shared/movement";
import { isLand } from "../src/shared/world";
import { Heading } from "../src/shared/world";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) { failures++; console.error(`FAIL ${name}`, detail ?? ""); } else console.log(`ok   ${name}`);
}

interface SimExplorer extends Explorer { heldSteps: number; jumpSteps: number; queuedJump: boolean }

function hold(e0: SimExplorer, dir: Heading | null, steps: number, running: boolean): SimExplorer {
  let e: SimExplorer = { ...e0, tile: [...e0.tile] as [number, number], heading: e0.heading };
  for (let i = 0; i < steps; i++) {
    const res = stepOf({ tile: e.tile, heading: e.heading, gait: e.gait } as Explorer, 1,
      { direction: dir, running, jumpQueued: e.queuedJump && e.jumpSteps === 0 }, isLand, e.heldSteps, e.jumpSteps);
    e.queuedJump = false;
    e.heldSteps = dir !== null ? e.heldSteps + 1 : 0;
    e.jumpSteps = res.jumpSteps;
    e.tile = [...res.tile] as [number, number];
    e.heading = res.heading;
    e.gait = res.gait;
  }
  return e;
}

// DP-05: from spot 1 (3,12 E), holding D 4 steps -> 5,12; then R + D 4 steps -> 9,12.
const spot1: SimExplorer = { tile: [3, 12], heading: "E", gait: "idle", heldSteps: 0, jumpSteps: 0, queuedJump: false };
const afterWalk = hold(spot1, "E", 4, false);
check("DP-05 walk 400ms lands 5,12", afterWalk.tile[0] === 5 && afterWalk.tile[1] === 12, JSON.stringify(afterWalk.tile));
const afterRun = hold({ ...afterWalk, heldSteps: 0 }, "E", 4, true);
check("DP-05 run 400ms lands 9,12", afterRun.tile[0] === 9 && afterRun.tile[1] === 12, JSON.stringify(afterRun.tile));

// Gait on each step: walk moves on held steps 1 and 3.
{
  let e = { ...spot1 };
  const tiles: string[] = [];
  for (let i = 0; i < 4; i++) {
    e = hold(e, "E", 1, false);
    tiles.push(e.gait === "walk" && (e.tile[0] === 4 || e.tile[0] === 5) ? `w${e.tile[0]}` : `${e.gait[0]}${e.tile[0]}`);
  }
  check("walk moves on steps 1 and 3", JSON.stringify(tiles) === JSON.stringify(["w4", "w4", "w5", "w5"]), JSON.stringify(tiles));
}

// DP-06: from 7,5 holding S stops at the rock with heading S.
const at75: SimExplorer = { tile: [7, 5], heading: "N", gait: "idle", heldSteps: 0, jumpSteps: 0, queuedJump: false };
const sHold = hold(at75, "S", 3, false);
check("DP-06 S blocked at 7,5 heading S", sHold.tile[0] === 7 && sHold.tile[1] === 5 && sHold.heading === "S", JSON.stringify(sHold));

// DP-06: jump from 7,5 facing S lands 7,7 on the 4th step with gait jump throughout.
{
  let e = { ...at75, heading: "S" };
  e.queuedJump = true;
  const seq: string[] = [];
  for (let i = 0; i < 4; i++) {
    e = hold(e, null, 1, false);
    seq.push(`${e.gait}@${e.tile[0]},${e.tile[1]}`);
  }
  check("DP-06 jump lands 7,7 on 4th step", e.tile[0] === 7 && e.tile[1] === 7, JSON.stringify(seq));
  check("DP-06 gait jump on all four steps", seq.every(s => s.startsWith("jump")), JSON.stringify(seq));
}

// Rock stop from published example: hold S from 7,5 stops with data-heading S.
check("rock blocks", isLand(1, 7, 6) === false);

// Joystick: 16px north held for 4 steps walks 2 tiles north.
const joyStart: SimExplorer = { tile: [3, 12], heading: "E", gait: "idle", heldSteps: 0, jumpSteps: 0, queuedJump: false };
const joyAfter = hold(joyStart, "N", 4, false);
check("DP-09 4 steps north walks 2 tiles", joyAfter.tile[0] === 3 && joyAfter.tile[1] === 10, JSON.stringify(joyAfter.tile));

console.log(failures === 0 ? "ALL STEP-LOOP CHECKS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
