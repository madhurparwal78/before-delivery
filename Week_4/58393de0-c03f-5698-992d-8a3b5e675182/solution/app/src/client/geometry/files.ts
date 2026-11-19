import { MM_PER_INCH } from "../../shared/limits";
import type { ExportUnit, Vec3 } from "../../shared/types";
import type { BuiltFile, SolidResult } from "./types";

const HEADER = "Quarkyard";
const STL_HEADER_BYTES = 80;
const STL_TRIANGLE_BYTES = 50;

function unitDivisor(unit: ExportUnit): number {
  return unit === "in" ? MM_PER_INCH : 1;
}

/** Every coordinate in the file's unit, divided in double precision and then rounded once to float32. */
function scaledPositions(mesh: SolidResult, unit: ExportUnit): Float32Array {
  const divisor = unitDivisor(unit);
  const out = new Float32Array(mesh.positions.length);
  for (let i = 0; i < out.length; i++) out[i] = (mesh.positions[i] ?? 0) / divisor;
  return out;
}

function extentsIn(mesh: SolidResult, unit: ExportUnit): { x: number; y: number; z: number } {
  const divisor = unitDivisor(unit);
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  const { min, max } = mesh.bounds;
  return { x: round((max[0] - min[0]) / divisor), y: round((max[1] - min[1]) / divisor), z: round((max[2] - min[2]) / divisor) };
}

export function extentsOf(mesh: SolidResult): Vec3 {
  const { min, max } = mesh.bounds;
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

export function stlFile(mesh: SolidResult, unit: ExportUnit): BuiltFile {
  const positions = scaledPositions(mesh, unit);
  const count = mesh.triangleCount;
  const bytes = new Uint8Array(STL_HEADER_BYTES + 4 + count * STL_TRIANGLE_BYTES);
  const view = new DataView(bytes.buffer);
  const header = HEADER.padEnd(STL_HEADER_BYTES, " ");
  for (let i = 0; i < STL_HEADER_BYTES; i++) bytes[i] = header.charCodeAt(i);
  view.setUint32(STL_HEADER_BYTES, count, true);
  let at = STL_HEADER_BYTES + 4;
  for (let t = 0; t < count; t++) {
    const corners = [mesh.indices[t * 3] ?? 0, mesh.indices[t * 3 + 1] ?? 0, mesh.indices[t * 3 + 2] ?? 0].map((v) => v * 3);
    const [a = 0, b = 0, c = 0] = corners;
    const ux = (positions[b] ?? 0) - (positions[a] ?? 0), uy = (positions[b + 1] ?? 0) - (positions[a + 1] ?? 0), uz = (positions[b + 2] ?? 0) - (positions[a + 2] ?? 0);
    const vx = (positions[c] ?? 0) - (positions[a] ?? 0), vy = (positions[c + 1] ?? 0) - (positions[a + 1] ?? 0), vz = (positions[c + 2] ?? 0) - (positions[a + 2] ?? 0);
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    view.setFloat32(at, nx / length, true);
    view.setFloat32(at + 4, ny / length, true);
    view.setFloat32(at + 8, nz / length, true);
    at += 12;
    for (const corner of corners) {
      for (let axis = 0; axis < 3; axis++) view.setFloat32(at + axis * 4, positions[corner + axis] ?? 0, true);
      at += 12;
    }
    view.setUint16(at, 0, true);
    at += 2;
  }
  return { bytes, triangleCount: count, bbox: extentsIn(mesh, unit) };
}

/** Shortest decimal text that reads back as the same float32. */
function float32Text(value: number): string {
  for (let digits = 1; digits <= 9; digits++) {
    const text = value.toPrecision(digits);
    if (Math.fround(Number(text)) === value) return String(Number(text));
  }
  return String(value);
}

export function objFile(mesh: SolidResult, unit: ExportUnit): BuiltFile {
  const positions = scaledPositions(mesh, unit);
  const lines = [`# ${HEADER} export, coordinates in ${unit === "in" ? "inches" : "millimetres"}`, "o quarkyard"];
  for (let i = 0; i < positions.length; i += 3) {
    lines.push(`v ${float32Text(positions[i] ?? 0)} ${float32Text(positions[i + 1] ?? 0)} ${float32Text(positions[i + 2] ?? 0)}`);
  }
  for (let t = 0; t < mesh.triangleCount; t++) {
    lines.push(`f ${(mesh.indices[t * 3] ?? 0) + 1} ${(mesh.indices[t * 3 + 1] ?? 0) + 1} ${(mesh.indices[t * 3 + 2] ?? 0) + 1}`);
  }
  return { bytes: new TextEncoder().encode(`${lines.join("\n")}\n`), triangleCount: mesh.triangleCount, bbox: extentsIn(mesh, unit) };
}

function trimmed(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

/**
 * The design's top view: its silhouette as one filled path (even-odd, so holes show through), x to the right and y up
 * the page, in the chosen unit. `outline` is the projected footprint's closed loops in millimetres.
 */
export function svgFile(mesh: SolidResult, outline: [number, number][][], unit: ExportUnit): BuiltFile {
  const divisor = unitDivisor(unit);
  const decimals = unit === "in" ? 5 : 3;
  const { min, max } = mesh.bounds;
  const width = (max[0] - min[0]) / divisor;
  const height = (max[1] - min[1]) / divisor;
  const path = outline
    .map((loop) => loop.map(([x, y], i) => `${i === 0 ? "M" : "L"}${trimmed((x - min[0]) / divisor, decimals)} ${trimmed((max[1] - y) / divisor, decimals)}`).join("") + "Z")
    .join("");
  const w = trimmed(width, decimals);
  const h = trimmed(height, decimals);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}${unit}" height="${h}${unit}" viewBox="0 0 ${w} ${h}">\n<path d="${path}" fill="#282727" fill-rule="evenodd"/>\n</svg>\n`;
  return { bytes: new TextEncoder().encode(svg), triangleCount: null, bbox: extentsIn(mesh, unit) };
}

export function circuitFile(svg: string): BuiltFile {
  return { bytes: new TextEncoder().encode(svg), triangleCount: null, bbox: null };
}
