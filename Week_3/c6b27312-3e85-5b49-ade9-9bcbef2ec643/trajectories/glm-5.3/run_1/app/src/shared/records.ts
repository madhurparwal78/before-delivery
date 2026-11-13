/** Public config values that reach the browser. */
export interface PublicConfig {
  evalDebounceMs: number;
  slowEvalNoticeMs: number;
  commentMaxChars: number;
  requiredApprovals: number;
  preflightSignedOutLimit: number;
}

export interface SeedUser {
  key: string;
  email: string;
  password: string;
  displayName: string;
  verified: boolean;
}

export interface Values {
  [name: string]: number | boolean | string;
}

export type ParamKind = "length" | "angle" | "count" | "boolean" | "enum";

export interface ManifestEntry {
  name: string;
  label: string;
  kind: ParamKind;
  unit: "mm" | "\u00b0" | null;
  value: number | boolean | string;
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  precision: number;
  options?: string[];
  group: string;
  derived: boolean;
  order: number;
}

export interface Diagnostic {
  code: string;
  message: string;
  parameter: string | null;
}

export interface TapeOperation {
  index: number;
  kind: "start" | "params" | "body" | "cut" | "join";
  op: string;
  line: number | null;
  digest: string;
  volume: number;
  delta: number;
  bbox: [number, number, number];
}

export interface SolidOp {
  op: string;
  [key: string]: unknown;
}

export interface Solid {
  ops: SolidOp[];
}

export interface EvalResult {
  solid: Solid;
  digest: string;
  volume: number;
  bbox: [number, number, number];
  faces: number;
  diagnostics?: Diagnostic[];
}

export interface RevisionValues {
  id: string;
  label: string;
  partSlug: string;
  parentRevisionId: string | null;
  authorId: string;
  createdAt: string;
  values: Values;
  sourceRef: string;
  evaluationId: string;
  geometryDigest: string;
  message: string;
  restoredFrom: string | null;
  forkedFrom: { revisionId: string; operation: number } | null;
}

export const CATEGORIES: ReadonlyArray<{ slug: string; name: string }> = [
  { slug: "hardware", name: "Hardware" },
  { slug: "organisers", name: "Organisers" },
  { slug: "brackets", name: "Brackets" },
  { slug: "plumbing", name: "Plumbing" },
  { slug: "enclosure-parts", name: "Enclosure parts" },
  { slug: "jigs", name: "Jigs" },
];

export const PROCESSES: ReadonlyArray<{
  id: string;
  label: string;
  envelope: [number, number, number];
  wallBlocking: number;
  wallAdvisory: number;
  depthRatio: number | null;
  setup: number;
  ratePerCm3: number;
  leadTime: string;
}> = [
  { id: "fdm-04", label: "FDM print, 0.4 mm nozzle", envelope: [220, 220, 250], wallBlocking: 1.2, wallAdvisory: 2.0, depthRatio: null, setup: 2, ratePerCm3: 0.06, leadTime: "2\u20134 working days" },
  { id: "mill-3", label: "Three-axis mill", envelope: [300, 200, 100], wallBlocking: 1.2, wallAdvisory: 1.5, depthRatio: 6, setup: 40, ratePerCm3: 0.45, leadTime: "5\u201310 working days" },
  { id: "laser-sheet", label: "Laser-cut sheet", envelope: [600, 400, 6], wallBlocking: 1.5, wallAdvisory: 3.0, depthRatio: null, setup: 8, ratePerCm3: 0.30, leadTime: "3\u20136 working days" },
];

export const SEED_PART_CATEGORY: Record<string, string> = {
  "twin-hole-plate": "hardware",
  "peg-rail": "organisers",
  "shelf-bracket": "brackets",
  "cable-comb": "organisers",
  "hinge-leaf": "hardware",
  "spacer-ring": "hardware",
  "label-holder": "organisers",
  "pipe-saddle": "plumbing",
  "fan-grille-plate": "enclosure-parts",
  "hose-clip": "plumbing",
  "jig-fence-block": "jigs",
  "pegboard-hook-plate": "hardware",
};

export const SEED_SOURCES: Record<string, string> = {};

export function seedSource(slug: string): string {
  return SEED_SOURCES[slug];
}
