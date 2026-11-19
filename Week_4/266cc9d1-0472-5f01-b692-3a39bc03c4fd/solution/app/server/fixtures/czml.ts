// The Ash Creek flight track: three constant-speed passes on the centreline at 320 m ellipsoidal
// height, one sample every 10 seconds, plus two stray samples outside every availability interval.
import { pointAt, type Centreline } from "../../shared/geodesy.js";

const EPOCH = "2026-06-14T14:00:00Z";
const FLIGHT_HEIGHT_M = 320;
const STEP_S = 10;

interface Pass {
  startS: number;
  endS: number;
  fromM: number;
  toM: number;
}

const PASSES: Pass[] = [
  { startS: 0, endS: 480, fromM: 0, toM: 1268 },
  { startS: 900, endS: 1320, fromM: 1904, toM: 2870 },
  { startS: 1800, endS: 2220, fromM: 2870, toM: 1904 },
];

const STRAYS = [
  { seconds: 540, chainageM: 1400 },
  { seconds: 1560, chainageM: 2500 },
];

function at(seconds: number): string {
  return new Date(Date.parse(EPOCH) + seconds * 1000).toISOString().replace(".000Z", "Z");
}

export function ashCreekTrack(line: Centreline): Buffer {
  const samples: Array<{ seconds: number; chainageM: number }> = [...STRAYS];
  for (const pass of PASSES) {
    for (let s = pass.startS; s <= pass.endS; s += STEP_S) {
      samples.push({ seconds: s, chainageM: pass.fromM + ((pass.toM - pass.fromM) * (s - pass.startS)) / (pass.endS - pass.startS) });
    }
  }
  samples.sort((a, b) => a.seconds - b.seconds);
  const cartographicDegrees = samples.flatMap(({ seconds, chainageM }) => {
    const p = pointAt(line, chainageM, 0);
    return [seconds, p.lonDeg, p.latDeg, FLIGHT_HEIGHT_M];
  });
  const document = [
    { id: "document", name: "Ash Creek 345 kV survey flight", version: "1.0" },
    {
      id: "drone",
      name: "Survey drone, 2026-06-14",
      availability: PASSES.map((p) => `${at(p.startS)}/${at(p.endS)}`),
      position: { epoch: EPOCH, interpolationAlgorithm: "LINEAR", cartographicDegrees },
    },
  ];
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
}
