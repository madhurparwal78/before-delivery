import type { ExportFormat, ExportUnit, DesignObject, SnapshotCircuit, Vec3 } from "../../shared/types";

/** A triangle mesh in world millimetres, z up. `indices` are triples into `positions` (x,y,z per vertex). */
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** A closed mesh with the numbers the hidden state elements and the export dialog publish. */
export interface SolidResult extends MeshData {
  bounds: Bounds;
  /** Mesh volume in cubic millimetres (unrounded). */
  volume: number;
  triangleCount: number;
}

export interface DesignSummary {
  /** True when the design has no solid, so nothing can be exported. */
  empty: boolean;
  /** Bounding-box extents x, y, z in millimetres of the unioned-minus-holes result; null when empty. */
  size: Vec3 | null;
}

export interface BuiltFile {
  bytes: Uint8Array;
  /** Null for SVG. */
  triangleCount: number | null;
  /** Extents in the file's unit; null for a circuit export. */
  bbox: { x: number; y: number; z: number } | null;
}

/** The jobs the geometry worker answers. Each key maps its input to the value the promise resolves with. */
export interface WorkerJobs {
  resolveObject: { input: DesignObject; output: SolidResult | null };
  resolveDesign: { input: DesignObject[]; output: SolidResult | null };
  summariseDesign: { input: DesignObject[]; output: DesignSummary };
  buildDesignFile: { input: { objects: DesignObject[]; format: ExportFormat; unit: ExportUnit }; output: BuiltFile };
  buildCircuitFile: { input: SnapshotCircuit; output: BuiltFile };
}

export type JobName = keyof WorkerJobs;

export type WorkerRequest = {
  [K in JobName]: { id: number; job: K; input: WorkerJobs[K]["input"] };
}[JobName];

export type WorkerResponse =
  | { id: number; ok: true; output: WorkerJobs[JobName]["output"] }
  | { id: number; ok: false; message: string };
