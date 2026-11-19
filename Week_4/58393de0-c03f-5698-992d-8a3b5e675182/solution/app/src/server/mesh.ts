import { copy } from "../shared/copy";
import type { ExportFormat, ExportUnit } from "../shared/types";
import { ApiError, validationError } from "./errors";

interface ExportFacts {
  /** Null for SVG. */
  triangleCount: number | null;
  /** Extents in the file's own unit; null when the file has no size to report. */
  bbox: { x: number; y: number; z: number } | null;
}

const STL_HEADER_BYTES = 80;
const STL_TRIANGLE_BYTES = 50;
const VERTEX_BYTES = 12;
const VERTEX_ID_LIMIT = 67_108_864;

const notThisFormat = () => validationError({ file: copy.validation });

const round = (value: number): number => Math.round(value * 1e6) / 1e6;

function extents(min: number[], max: number[]): { x: number; y: number; z: number } {
  return { x: round((max[0] ?? 0) - (min[0] ?? 0)), y: round((max[1] ?? 0) - (min[1] ?? 0)), z: round((max[2] ?? 0) - (min[2] ?? 0)) };
}

/** True when every edge belongs to exactly two faces; faces list vertex ids, and shared vertices share an id. */
function isClosed(faces: Iterable<readonly number[]>): boolean {
  const uses = new Map<number, number>();
  for (const face of faces) {
    face.forEach((from, i) => {
      const to = face[(i + 1) % face.length] ?? from;
      const key = Math.min(from, to) * VERTEX_ID_LIMIT + Math.max(from, to);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    });
  }
  return uses.size > 0 && [...uses.values()].every((count) => count === 2);
}

function inspectStl(data: Buffer): ExportFacts {
  if (data.length < STL_HEADER_BYTES + 4) throw notThisFormat();
  const triangleCount = data.readUInt32LE(STL_HEADER_BYTES);
  if (triangleCount === 0 || data.length !== STL_HEADER_BYTES + 4 + STL_TRIANGLE_BYTES * triangleCount) throw notThisFormat();
  const ids = new Map<string, number>();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const faces: number[][] = [];
  for (let t = 0; t < triangleCount; t++) {
    const face: number[] = [];
    for (let v = 0; v < 3; v++) {
      const at = STL_HEADER_BYTES + 4 + t * STL_TRIANGLE_BYTES + VERTEX_BYTES * (v + 1);
      const key = data.toString("latin1", at, at + VERTEX_BYTES);
      let id = ids.get(key);
      if (id === undefined) {
        id = ids.size;
        ids.set(key, id);
        for (let axis = 0; axis < 3; axis++) {
          const value = data.readFloatLE(at + 4 * axis);
          if (!Number.isFinite(value)) throw notThisFormat();
          min[axis] = Math.min(min[axis] ?? value, value);
          max[axis] = Math.max(max[axis] ?? value, value);
        }
      }
      face.push(id);
    }
    faces.push(face);
  }
  if (!isClosed(faces)) throw new ApiError("mesh_not_closed");
  return { triangleCount, bbox: extents(min, max) };
}

function inspectObj(data: Buffer): ExportFacts {
  const ids = new Map<string, number>();
  const vertexIds: number[] = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const faces: number[][] = [];
  let triangleCount = 0;
  for (const line of data.toString("utf8").split(/\r?\n/)) {
    const words = line.trim().split(/\s+/);
    if (words[0] === "v") {
      const point = words.slice(1, 4).map(Number);
      if (point.length < 3 || !point.every(Number.isFinite)) throw notThisFormat();
      const key = point.join(",");
      const id = ids.get(key) ?? ids.size;
      ids.set(key, id);
      vertexIds.push(id);
      point.forEach((value, axis) => {
        min[axis] = Math.min(min[axis] ?? value, value);
        max[axis] = Math.max(max[axis] ?? value, value);
      });
    } else if (words[0] === "f") {
      const corners: number[] = [];
      for (const word of words.slice(1)) {
        const index = Number.parseInt(word.split("/")[0] ?? "", 10);
        const id = vertexIds[index < 0 ? vertexIds.length + index : index - 1];
        if (id === undefined) throw notThisFormat();
        corners.push(id);
      }
      if (corners.length < 3) throw notThisFormat();
      faces.push(corners);
      triangleCount += corners.length - 2;
    }
  }
  if (faces.length === 0) throw notThisFormat();
  if (!isClosed(faces)) throw new ApiError("mesh_not_closed");
  return { triangleCount, bbox: extents(min, max) };
}

const XML_TOKEN = new RegExp([
  "<!--[\\s\\S]*?-->", "<\\?[\\s\\S]*?\\?>", "<!\\[CDATA\\[[\\s\\S]*?\\]\\]>", "<!DOCTYPE[^>]*>",
  "<\\/([A-Za-z_][\\w:.-]*)\\s*>",
  "<([A-Za-z_][\\w:.-]*)((?:\\s+[\\w:.-]+\\s*=\\s*(?:\"[^\"]*\"|'[^']*'))*)\\s*(\\/?)>",
  "[^<]+",
].join("|"), "y");

/** The attributes of the root element when the text is a well-formed XML document rooted at `<svg>`; otherwise null. */
function parseSvgRoot(text: string): string | null {
  const open: string[] = [];
  let rootAttributes: string | null = null;
  let finished = false;
  XML_TOKEN.lastIndex = 0;
  while (XML_TOKEN.lastIndex < text.length) {
    const match = XML_TOKEN.exec(text);
    if (!match) return null;
    const [token, closing, opening, attributes, selfClosing] = match;
    if (closing !== undefined) {
      if (open.pop() !== closing) return null;
      finished = open.length === 0;
    } else if (opening !== undefined) {
      if (finished || (rootAttributes === null && opening !== "svg")) return null;
      rootAttributes ??= attributes ?? "";
      if (!selfClosing) open.push(opening);
      else finished = open.length === 0;
    } else if (!token.startsWith("<") && token.trim() !== "" && open.length === 0) {
      return null;
    }
  }
  return finished && open.length === 0 ? rootAttributes : null;
}

function inspectSvg(data: Buffer, unit: ExportUnit): ExportFacts {
  const attributes = parseSvgRoot(data.toString("utf8"));
  if (attributes === null) throw notThisFormat();
  const size = (name: string): number | null => {
    const value = new RegExp(`\\s${name}\\s*=\\s*["']([\\d.]+)${unit}["']`).exec(attributes)?.[1];
    return value === undefined ? null : Number(value);
  };
  const width = size("width");
  const height = size("height");
  return { triangleCount: null, bbox: width !== null && height !== null ? { x: width, y: height, z: 0 } : null };
}

/** Checks an uploaded file is what it says it is, and reports its size: 422 when it is not, or when a mesh is not closed. */
export function inspectExport(format: ExportFormat, unit: ExportUnit, data: Buffer): ExportFacts {
  if (format === "stl") return inspectStl(data);
  if (format === "obj") return inspectObj(data);
  return inspectSvg(data, unit);
}
