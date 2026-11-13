// Laws engine checks against the worked examples in the brief (run after build).
import {
  chipOf,
  figuresText,
  oversText,
  rate2,
  rate3signed,
  replayInnings,
  runRateText,
} from "../dist/server/laws.js";

const players = new Map();
const add = (id, name, shortName) => {
  players.set(id, { name, short_name: shortName });
};
const kes = ["k1", "k2", "k3", "k4", "k5", "k6"];
const her = ["h1", "h2", "h3", "h4", "h5", "h6"];
add("k1", "Arjun Rao", "Rao");
add("k2", "Kabir Iyer", "Iyer");
add("k3", "Dev Sen", "Sen");
add("k4", "Neel Bose", "Bose");
add("k5", "Omar Khan", "Khan");
add("k6", "Ravi Das", "Das");
add("h1", "Vik Mehta", "Mehta");
add("h2", "Sam Pillai", "Pillai");
add("h3", "Jai Nair", "Nair");
add("h4", "Tom Gill", "Gill");
add("h5", "Ash Kurian", "Kurian");
add("h6", "Leo Varma", "Varma");

const spec = {
  innings: "1",
  batting_team: "Kestrels",
  bowling_team: "Herons",
  super_over_number: 0,
  overs_quota: 5,
  max_wickets: 5,
  batting_xi: kes,
  bowling_xi: her,
};

const token = (p) => {
  if (/^[0-6]$/.test(p)) return { extra: "none", runs: Number(p) };
  const runs = Number(p.slice(1));
  const extra = p[0] === "D" ? "wide" : p[0] === "N" ? "no-ball" : p[0] === "B" ? "bye" : "leg-bye";
  return { extra, runs };
};

const mk = (seq, striker, bowler, t, wicket) => ({
  kind: "delivery",
  seq,
  delivery: { seq, over: 1, ball: 1, striker, bowler, extra: t.extra, runs: t.runs, wicket },
});

const w = (kind, opts = {}) => ({
  kind,
  fielder: opts.fielder ?? null,
  batter_out: opts.batter_out ?? "striker",
  new_batter: opts.new_batter ?? null,
});

let failures = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    failures += 1;
    console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`);
  } else {
    console.log(`ok   ${name}`);
  }
};

// E1: one over with every extra. Strikers: Rao, Rao, Rao, Iyer, Iyer, Iyer, Rao, Rao, Iyer.
const e1seq = ["k1", "k1", "k1", "k2", "k2", "k2", "k1", "k1", "k2"];
const e1tokens = ["0", "D0", "1", "N4", "B2", "L1", "6", "D1", "2"];
const e1 = replayInnings(spec, e1tokens.map((t, i) => mk(i + 1, e1seq[i], "h1", token(t), null)), players);
check("E1 runs", e1.runs, 20);
check("E1 wickets", e1.wickets, 0);
check("E1 legal balls", e1.legal_balls, 6);
check("E1 extras", e1.extras, { b: 2, lb: 1, w: 3, nb: 1 });
check("E1 Rao", [e1.batters.get("k1").runs, e1.batters.get("k1").balls], [7, 3]);
check("E1 Iyer", [e1.batters.get("k2").runs, e1.batters.get("k2").balls], [6, 4]);
check("E1 Mehta figures", figuresText(e1.bowlers.get("h1").legal_balls, e1.bowlers.get("h1").maidens, e1.bowlers.get("h1").runs, e1.bowlers.get("h1").wickets), "1-0-17-0");
check("E1 run rate", runRateText(e1.runs, e1.legal_balls), "20.00");
check("E1 line seq4", e1.commentary[3].line, "0.3 Mehta to Iyer, no-ball, FOUR");
check("E1 line seq5", e1.commentary[4].line, "0.3 Mehta to Iyer, 2 byes (free hit)");
check("E1 line seq8", e1.commentary[7].line, "0.6 Mehta to Rao, 2 wides");
check("E1 over end", e1.commentary[e1.commentary.length - 1].line, "End of over 1: 20 runs. Kestrels 20/0");
check("E1 free hit gone", e1.free_hit, false);
check("E1 chips", e1.commentary.filter((c) => c.kind === "delivery").map((c) => chipOf(c, c.runs)), ["0", "1wd", "1", "5nb", "2b", "1lb", "6", "2wd", "2"]);
check("E1 end striker", e1.striker, "k1");
check("E1 end non-striker", e1.non_striker, "k2");

check("rate 0.125", rate2(0.125), "0.13");
check("rate 66.666", rate2(66.666), "66.67");
check("nrr -1.057", rate3signed(140 / 20 - 141 / 17.5), "-1.057");
check("overs text", [oversText(0), oversText(3), oversText(46), oversText(120)], ["0", "0.3", "7.4", "20"]);

// E4 free hit. The no-ball's odd run swaps strike, so Iyer faces the free-hit balls.
const e4seq = ["k1", "k1", "k2", "k2", "k2"];
const e4 = replayInnings(spec, ["0", "N1", "D0", "6", "0"].map((t, i) => mk(i + 1, e4seq[i], "h1", token(t), null)), players);
check("E4 lines", e4.commentary.filter((c) => c.kind === "delivery").map((c) => c.line), [
  "0.1 Mehta to Rao, no run",
  "0.2 Mehta to Rao, no-ball, 1 run",
  "0.2 Mehta to Iyer, 1 wide (free hit)",
  "0.2 Mehta to Iyer, SIX (free hit)",
  "0.3 Mehta to Iyer, no run",
]);
check("E4 free hit flags", e4.commentary.filter((c) => c.kind === "delivery").map((c) => c.free_hit), [false, false, true, true, false]);

// E5 bowlers and strike: Mehta over 1 (six dots, a maiden), Pillai over 2 (six singles),
// Mehta over 3 and Pillai over 4 (six singles each). Batters swap on odd runs and at
// the over end, so each batter faces 15 of the 24 balls.
const e5entries = [];
let seq5 = 0;
const overOf = (bowler, runsEach) => {
  for (let i = 0; i < 6; i++) {
    seq5 += 1;
    const striker = (seq5 - 1) % 2 === 0 ? "k1" : "k2";
    e5entries.push(mk(seq5, striker, bowler, { extra: "none", runs: runsEach }, null));
  }
};
overOf("h1", 0);
overOf("h2", 1);
overOf("h1", 1);
overOf("h2", 1);
const e5 = replayInnings({ ...spec, overs_quota: 6 }, e5entries, players);
check("E5 Mehta", figuresText(e5.bowlers.get("h1").legal_balls, e5.bowlers.get("h1").maidens, e5.bowlers.get("h1").runs, e5.bowlers.get("h1").wickets), "2-1-6-0");
check("E5 Pillai", figuresText(e5.bowlers.get("h2").legal_balls, e5.bowlers.get("h2").maidens, e5.bowlers.get("h2").runs, e5.bowlers.get("h2").wickets), "2-0-12-0");
check("E5 score", [e5.runs, e5.wickets, oversText(e5.legal_balls)], [18, 0, "4"]);
check("E5 batters", [e5.batters.get("k1").runs, e5.batters.get("k1").balls, e5.batters.get("k2").runs, e5.batters.get("k2").balls], [9, 15, 9, 9]);
check("E5 striker", e5.striker, "k1");

// E3 wickets (all out). The engine derives strike; compute it here too.
const e3striker = ["k1", "k2", "k3", "k4", "k4", "k5"];
const e3parts = [
  { t: "1", striker: "k1", bowler: "h1" },
  { t: "0", striker: "k2", bowler: "h1", wicket: w("caught", { fielder: "h3", new_batter: "k3" }) },
  { t: "0", striker: "k3", bowler: "h1", wicket: w("lbw", { new_batter: "k4" }) },
  { t: "2", striker: "k4", bowler: "h1" },
  { t: "1", striker: "k4", bowler: "h1", wicket: w("run-out", { fielder: "h4", batter_out: "non-striker", new_batter: "k5" }) },
  { t: "0", striker: "k5", bowler: "h1", wicket: w("bowled", { new_batter: "k6" }) },
  { t: "D0", striker: "k4", bowler: "h2", wicket: w("stumped", { fielder: "h5" }) },
];
void e3striker;
const e3entries = e3parts.map((p, i) => mk(i + 1, p.striker, p.bowler, token(p.t), p.wicket ?? null));
const e3 = replayInnings(spec, e3entries, players);
check("E3 fow", e3.fow.map((f) => `${f.wicket}-${f.runs} (${players.get(f.player).short_name}, ${f.label})`).join(", "), "1-1 (Iyer, 0.2), 2-1 (Sen, 0.3), 3-4 (Rao, 0.5), 4-4 (Khan, 0.6), 5-5 (Bose, 1.1)");
check("E3 lines", e3.commentary.filter((c) => c.kind === "delivery").map((c) => c.line), [
  "0.1 Mehta to Rao, 1 run",
  "0.2 Mehta to Iyer, OUT! c Nair b Mehta",
  "0.3 Mehta to Sen, OUT! lbw b Mehta",
  "0.4 Mehta to Bose, 2 runs",
  "0.5 Mehta to Bose, 1 run, OUT! run out (Gill)",
  "0.6 Mehta to Khan, OUT! b Mehta",
  "1.1 Pillai to Bose, 1 wide, OUT! st Kurian b Pillai",
]);
check("E3 extras", e3.extras, { b: 0, lb: 0, w: 1, nb: 0 });
check("E3 all out", e3.innings_ended, true);

// E7: undo of the third delivery of E3
const e7 = replayInnings(spec, e3entries.slice(0, 2), players);
check("E7 score", [e7.runs, e7.wickets, oversText(e7.legal_balls)], [1, 1, "0.2"]);
check("E7 batters", [e7.striker, e7.non_striker], ["k3", "k1"]);
check("E7 fow", e7.fow.map((f) => `${f.wicket}-${f.runs}`).join(", "), "1-1");
check("E7 Mehta", figuresText(e7.bowlers.get("h1").legal_balls, e7.bowlers.get("h1").maidens, e7.bowlers.get("h1").runs, e7.bowlers.get("h1").wickets), "0.2-0-1-1");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
