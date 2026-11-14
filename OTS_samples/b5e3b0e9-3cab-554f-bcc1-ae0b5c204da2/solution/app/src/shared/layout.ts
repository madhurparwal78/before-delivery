export type NodeKind = "threshold" | "holding" | "junction" | "stand";

export interface LayoutNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  serves?: string;
}
export interface LayoutSegment {
  id: string;
  from: string;
  to: string;
  lengthM: number;
  speedMps: number;
  taxiway: string;
}
interface LayoutThreshold {
  id: string;
  node: string;
  heading: number;
}
export interface LayoutRunway {
  id: string;
  lengthM: number;
  thresholds: LayoutThreshold[];
}
export interface Layout {
  name: string;
  code: string;
  runways: LayoutRunway[];
  nodes: LayoutNode[];
  segments: LayoutSegment[];
}

export const BUILT_IN_LAYOUTS: Record<string, Layout> = {
  wrenfield: {
    name: "Wrenfield",
    code: "WRN",
    runways: [
      {
        id: "09/27",
        lengthM: 1600,
        thresholds: [
          { id: "09", node: "R09", heading: 90 },
          { id: "27", node: "R27", heading: 270 },
        ],
      },
    ],
    nodes: [
      { id: "R09", kind: "threshold", x: 100, y: 100 },
      { id: "R27", kind: "threshold", x: 900, y: 100 },
      { id: "A1", kind: "holding", x: 850, y: 200, serves: "27" },
      { id: "A6", kind: "holding", x: 150, y: 200, serves: "09" },
      { id: "J2", kind: "junction", x: 650, y: 200 },
      { id: "J3", kind: "junction", x: 500, y: 200 },
      { id: "J4", kind: "junction", x: 350, y: 200 },
      { id: "W", kind: "junction", x: 350, y: 320 },
      { id: "E", kind: "junction", x: 650, y: 320 },
      { id: "S1", kind: "stand", x: 300, y: 420 },
      { id: "S2", kind: "stand", x: 400, y: 420 },
      { id: "S3", kind: "stand", x: 600, y: 420 },
      { id: "S4", kind: "stand", x: 700, y: 420 },
    ],
    segments: [
      { id: "A2", from: "J2", to: "A1", lengthM: 300, speedMps: 10, taxiway: "A" },
      { id: "A3", from: "J3", to: "J2", lengthM: 300, speedMps: 10, taxiway: "A" },
      { id: "A4", from: "J4", to: "J3", lengthM: 300, speedMps: 10, taxiway: "A" },
      { id: "A5", from: "A6", to: "J4", lengthM: 300, speedMps: 10, taxiway: "A" },
      { id: "W1", from: "W", to: "J4", lengthM: 200, speedMps: 10, taxiway: "W" },
      { id: "E1", from: "E", to: "J2", lengthM: 200, speedMps: 10, taxiway: "E" },
      { id: "S1T", from: "S1", to: "W", lengthM: 100, speedMps: 5, taxiway: "apron" },
      { id: "S2T", from: "S2", to: "W", lengthM: 100, speedMps: 5, taxiway: "apron" },
      { id: "S3T", from: "S3", to: "E", lengthM: 100, speedMps: 5, taxiway: "apron" },
      { id: "S4T", from: "S4", to: "E", lengthM: 100, speedMps: 5, taxiway: "apron" },
    ],
  },
  "kestrel-down": {
    name: "Kestrel Down",
    code: "KDN",
    runways: [
      {
        id: "09/27",
        lengthM: 1400,
        thresholds: [
          { id: "09", node: "K09", heading: 90 },
          { id: "27", node: "K27", heading: 270 },
        ],
      },
    ],
    nodes: [
      { id: "K09", kind: "threshold", x: 100, y: 250 },
      { id: "K27", kind: "threshold", x: 900, y: 250 },
      { id: "N1", kind: "stand", x: 300, y: 50 },
      { id: "N2", kind: "stand", x: 700, y: 50 },
      { id: "NB", kind: "junction", x: 300, y: 120 },
      { id: "NC", kind: "junction", x: 700, y: 120 },
      { id: "B2", kind: "holding", x: 300, y: 200, serves: "cross" },
      { id: "C2", kind: "holding", x: 700, y: 200, serves: "cross" },
      { id: "B3", kind: "holding", x: 300, y: 300, serves: "cross" },
      { id: "C3", kind: "holding", x: 700, y: 300, serves: "cross" },
      { id: "SB", kind: "junction", x: 300, y: 380 },
      { id: "SC", kind: "junction", x: 700, y: 380 },
      { id: "D1", kind: "holding", x: 850, y: 380, serves: "27" },
      { id: "D6", kind: "holding", x: 150, y: 380, serves: "09" },
    ],
    segments: [
      { id: "N1T", from: "N1", to: "NB", lengthM: 100, speedMps: 5, taxiway: "apron" },
      { id: "N2T", from: "N2", to: "NC", lengthM: 100, speedMps: 5, taxiway: "apron" },
      { id: "N3", from: "NB", to: "NC", lengthM: 400, speedMps: 10, taxiway: "N" },
      { id: "B1", from: "NB", to: "B2", lengthM: 100, speedMps: 10, taxiway: "B" },
      { id: "C1", from: "NC", to: "C2", lengthM: 100, speedMps: 10, taxiway: "C" },
      { id: "B4", from: "B3", to: "SB", lengthM: 100, speedMps: 10, taxiway: "B" },
      { id: "C4", from: "C3", to: "SC", lengthM: 100, speedMps: 10, taxiway: "C" },
      { id: "D2", from: "SC", to: "D1", lengthM: 300, speedMps: 10, taxiway: "D" },
      { id: "D3", from: "SB", to: "SC", lengthM: 400, speedMps: 10, taxiway: "D" },
      { id: "D4", from: "D6", to: "SB", lengthM: 300, speedMps: 10, taxiway: "D" },
    ],
  },
};
