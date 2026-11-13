import { simulateRound } from "./sim/sim.js";
import { roundDef } from "../shared/domain.js";

function check(label: string, condition: boolean, detail?: string): void {
  if (!condition) {
    console.error(`FAIL ${label} ${detail ?? ""}`);
    process.exitCode = 1;
  } else {
    console.log(`ok ${label}${detail ? ` ${detail}` : ""}`);
  }
}

// Guarantee: a lone bean holding forward finishes the race in under 40 s and the final in under 30 s.
for (const kind of ["race", "final"] as const) {
  const limitSeconds = kind === "race" ? 40 : 30;
  let worst = 0;
  for (let seed = 0; seed < 400; seed++) {
    const inputs = [{ tick: 0, userId: 1, buttons: 1 }];
    const out = simulateRound({ kind, seed, starters: [1], inputs });
    const qualified = out.results[0];
    if (!qualified || qualified.outcome !== "qualified" || qualified.finishTick === null) {
      check(`${kind} seed ${seed} forward finish`, false, `outcome ${qualified?.outcome}`);
      process.exit(1);
    }
    worst = Math.max(worst, qualified.finishTick / 20);
  }
  check(`${kind} forward finishes under ${limitSeconds}s across seeds`, worst < limitSeconds, `worst ${worst.toFixed(1)}s`);
}

// Guarantee: a lone bean with no input in the survival arena falls within 30 seconds.
let worstSurvival = 0;
for (let seed = 0; seed < 400; seed++) {
  const out = simulateRound({ kind: "survival", seed, starters: [1], inputs: [] });
  const result = out.results[0];
  if (!result || result.outcome !== "eliminated" || result.eliminatedTick === null) {
    check(`survival seed ${seed} idle fall`, false, `outcome ${result?.outcome}`);
    process.exit(1);
  }
  worstSurvival = Math.max(worstSurvival, result.eliminatedTick / 20);
}
check("survival idle falls within 30s across seeds", worstSurvival <= 30, `worst ${worstSurvival.toFixed(1)}s`);

// Guarantee: a lone bean holding right runs off the side and falls within 5 seconds.
// In a race a fall respawns rather than eliminates, so the check looks for the
// fall itself in the recorded frames.
for (const kind of ["race", "final"] as const) {
  let worstFall = 0;
  for (let seed = 0; seed < 400; seed++) {
    const out = simulateRound({ kind, seed, starters: [1], inputs: [{ tick: 0, userId: 1, buttons: 8 }], recordFrames: true });
    let fallTick = -1;
    for (const [tick, frame] of out.frames) {
      if (frame.beans.some((bean) => bean.state === "falling")) {
        fallTick = tick;
        break;
      }
    }
    if (fallTick < 0 || fallTick > 100) {
      check(`${kind} seed ${seed} side fall`, false, `fallTick ${fallTick}`);
      process.exit(1);
    }
    worstFall = Math.max(worstFall, fallTick / 20);
  }
  check(`${kind} right-hold falls within 5s across seeds`, worstFall <= 5, `worst ${worstFall.toFixed(1)}s`);
}

// Determinism: same inputs, same outputs.
const a = simulateRound({ kind: "race", seed: 20261026, starters: [1, 2, 3], inputs: [{ tick: 0, userId: 1, buttons: 1 }], recordFrames: true });
const b = simulateRound({ kind: "race", seed: 20261026, starters: [1, 2, 3], inputs: [{ tick: 0, userId: 1, buttons: 1 }], recordFrames: true });
check(
  "determinism",
  JSON.stringify([...a.frames.entries()]) === JSON.stringify([...b.frames.entries()]) && a.lastTick === b.lastTick
);

// A 12-bean race resolves with the right slot count.
const race = simulateRound({
  kind: "race",
  seed: 20261026,
  starters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  inputs: Array.from({ length: 10 }, (_, i) => ({ tick: 0, userId: i + 1, buttons: 1 })),
  recordFrames: true
});
check("race slots is ceil(0.6*12)=8", race.slots === 8, `slots ${race.slots}`);
check("race results have 12 entries", race.results.length === 12);
const qualified = race.results.filter((r) => r.outcome === "qualified");
check("race qualifies at most slots", qualified.length <= 8, `qualified ${qualified.length}`);
const lastTickFrame = race.frames.get(race.lastTick ?? 0);
check("last tick frame exists", lastTickFrame !== undefined, `lastTick ${race.lastTick}`);
if (lastTickFrame) {
  const lastSlot = [...lastTickFrame.beans].sort((x, y) => x.rank - y.rank).find((bean) => bean.rank === qualified.length);
  const firstOut = [...lastTickFrame.beans].sort((x, y) => x.rank - y.rank).find((bean) => bean.rank === qualified.length + 1);
  check("marker beans exist in last frame", lastSlot !== undefined && firstOut !== undefined);
}
check("round def names", roundDef(1).name === "Wobble Dash" && roundDef(3).name === "Crown Climb");
console.log("SIM_SELFTEST_DONE");
