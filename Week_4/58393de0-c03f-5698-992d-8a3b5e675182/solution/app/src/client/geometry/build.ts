import type { ManifoldToplevel } from "../../../third_party/manifold/manifold.js";
import type { DesignObject, ExportFormat, ExportUnit, SnapshotCircuit } from "../../shared/types";
import { circuitSvg } from "../circuit/svg";
import { Arena, designManifold, resolveDesignMesh, resolveObjectMesh, solidResult } from "./csg";
import { circuitFile, extentsOf, objFile, stlFile, svgFile } from "./files";
import type { BuiltFile, DesignSummary, JobName, SolidResult, WorkerJobs, WorkerRequest } from "./types";

export function summarise(api: ManifoldToplevel, objects: DesignObject[]): DesignSummary {
  const result = resolveDesignMesh(api, objects);
  return { empty: result === null, size: result ? extentsOf(result) : null };
}

/** The STL, OBJ or SVG (top view) of the whole design. Throws when the design has no solid. */
export function buildDesign(api: ManifoldToplevel, objects: DesignObject[], format: ExportFormat, unit: ExportUnit): BuiltFile {
  const arena = new Arena();
  try {
    const manifold = designManifold(api, arena, objects);
    const result: SolidResult | null = manifold ? solidResult(manifold) : null;
    if (!manifold || !result) throw new Error("There is no solid to export.");
    if (format === "stl") return stlFile(result, unit);
    if (format === "obj") return objFile(result, unit);
    const loops = manifold.project().toPolygons().map((loop) => loop.map(([x, y]): [number, number] => [x, y]));
    return svgFile(result, loops, unit);
  } finally {
    arena.release();
  }
}

function buildCircuit(snapshot: SnapshotCircuit): BuiltFile {
  return circuitFile(circuitSvg(snapshot));
}

/** Runs one worker job. Pure apart from the WASM module it is given. */
export function runJob(api: ManifoldToplevel, request: WorkerRequest): WorkerJobs[JobName]["output"] {
  switch (request.job) {
    case "resolveObject": return resolveObjectMesh(api, request.input);
    case "resolveDesign": return resolveDesignMesh(api, request.input);
    case "summariseDesign": return summarise(api, request.input);
    case "buildDesignFile": return buildDesign(api, request.input.objects, request.input.format, request.input.unit);
    case "buildCircuitFile": return buildCircuit(request.input);
  }
}
