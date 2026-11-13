import type { Point, Units } from "../shared/types.js";

export interface DxfEntity {
  type: string;
  layer: string;
  handle: string;
  colour?: string;
  linetype?: string;
  lineweight?: string;
  data: Record<string, unknown>;
}

export interface DxfLayer {
  name: string;
  colour: string;
  linetype: string;
  frozen: boolean;
  locked: boolean;
  off: boolean;
}

export interface DxfDocument {
  units: Units;
  layers: DxfLayer[];
  entities: DxfEntity[];
  skipped: string[];
}

const aciToName: Record<number, string> = {
  1: "Red",
  2: "Yellow",
  3: "Green",
  4: "Cyan",
  5: "Blue",
  6: "Magenta",
  7: "White",
};

const nameToAci: Record<string, number> = {
  ByLayer: 256,
  Red: 1,
  Yellow: 2,
  Green: 3,
  Cyan: 4,
  Blue: 5,
  Magenta: 6,
  White: 7,
};

export interface Pair {
  code: number;
  value: string;
}

export function parseDxf(text: string): { pairs: Pair[]; binary: boolean } {
  const trimmed = text.replace(/^\uFEFF/, "");
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim());
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i], 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: lines[i + 1] });
  }
  return { pairs, binary: false };
}

export function isDxfText(bytes: Uint8Array): boolean {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 4096));
  if (text.includes("\u0000")) return false;
  const full = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const trimmed = full.trim();
  if (!trimmed.startsWith("0") && !/^0\s/.test(trimmed)) return false;
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim());
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i], 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: lines[i + 1] });
  }
  if (pairs.length === 0) return false;
  if (pairs[0].code !== 0 || pairs[0].value !== "SECTION") return false;
  return pairs.some((p) => p.code === 0 && p.value === "EOF");
}

export function importDxf(text: string, units: Units): DxfDocument {
  const { pairs } = parseDxf(text);
  const layers: DxfLayer[] = [{ name: "0", colour: "White", linetype: "Continuous", frozen: false, locked: false, off: false }];
  const entities: DxfEntity[] = [];
  const skipped: string[] = [];
  let insunits: Units = "mm";
  let section = "";
  let currentEntity: { type: string; data: Record<string, string[]> } | null = null;
  let currentLayer: { name: string; data: Record<string, string[]> } | null = null;
  for (let i = 0; i < pairs.length; i++) {
    const { code, value } = pairs[i];
    if (code === 0) {
      if (currentEntity) flushEntity(currentEntity, entities, skipped, units);
      if (currentLayer) flushLayer(currentLayer, layers);
      currentEntity = null;
      currentLayer = null;
      if (value === "SECTION") {
        section = pairs[i + 1]?.value ?? "";
      } else if (value === "EOF") {
        section = "";
      } else if (section === "TABLES" && value === "LAYER") {
        currentLayer = { name: "", data: {} };
      } else if (section === "ENTITIES") {
        if (["LINE", "CIRCLE", "ARC", "LWPOLYLINE", "MTEXT", "INSERT"].includes(value)) {
          currentEntity = { type: value, data: {} };
        } else {
          skipped.push(value);
        }
      }
      continue;
    }
    if (code === 9 && value === "$INSUNITS" && section === "HEADER") {
      const next = pairs[i + 1];
      if (next && next.code === 70) {
        insunits = Number.parseInt(next.value, 10) === 6 ? "m" : "mm";
        i += 1;
      }
      continue;
    }
    if (currentEntity) {
      const key = String(code);
      currentEntity.data[key] = currentEntity.data[key] ?? [];
      currentEntity.data[key].push(value);
    }
    if (currentLayer) {
      const key = String(code);
      currentLayer.data[key] = currentLayer.data[key] ?? [];
      currentLayer.data[key].push(value);
    }
  }
  if (currentEntity) flushEntity(currentEntity, entities, skipped, units);
  if (currentLayer) flushLayer(currentLayer, layers);
  return { units: insunits, layers, entities, skipped };
}

function flushLayer(layer: { name: string; data: Record<string, string[]> }, layers: DxfLayer[]): void {
  const name = (layer.data["2"] ?? [""])[0];
  if (!name) return;
  const colourAci = Number.parseInt((layer.data["62"] ?? ["7"])[0], 10);
  const flags = Number.parseInt((layer.data["70"] ?? ["0"])[0], 10);
  const linetype = (layer.data["6"] ?? ["Continuous"])[0] || "Continuous";
  const frozen = (flags & 1) !== 0;
  const locked = (flags & 4) !== 0;
  const off = colourAci < 0;
  layers.push({
    name,
    colour: aciToName[Math.abs(colourAci)] ?? "White",
    linetype: linetype === "ByLayer" ? "Continuous" : linetype,
    frozen,
    locked,
    off,
  });
}

function flushEntity(
  entity: { type: string; data: Record<string, string[]> },
  entities: DxfEntity[],
  skipped: string[],
  units: Units,
): void {
  const num = (key: string, index = 0): number => {
    const raw = entity.data[key]?.[index];
    const value = Number.parseFloat(raw ?? "0");
    return Number.isFinite(value) ? (units === "m" ? value * 1000 : value) : 0;
  };
  const str = (key: string, index = 0): string => (entity.data[key]?.[index] ?? "");
  const layer = str("8") || "0";
  const handle = str("5");
  const colourAci = Number.parseInt(entity.data["62"]?.[0] ?? "256", 10);
  switch (entity.type) {
    case "LINE":
      entities.push({
        type: "line",
        layer,
        handle,
        colour: aciToName[Math.abs(colourAci)] ?? "ByLayer",
        data: { start: [num("10"), num("20")], end: [num("11"), num("21")] },
      });
      break;
    case "CIRCLE":
      entities.push({
        type: "circle",
        layer,
        handle,
        colour: aciToName[Math.abs(colourAci)] ?? "ByLayer",
        data: { center: [num("10"), num("20")], radius: num("40") },
      });
      break;
    case "ARC":
      entities.push({
        type: "arc",
        layer,
        handle,
        colour: aciToName[Math.abs(colourAci)] ?? "ByLayer",
        data: { center: [num("10"), num("20")], radius: num("40"), start_angle: num("50"), end_angle: num("51") },
      });
      break;
    case "LWPOLYLINE": {
      const xs = entity.data["10"] ?? [];
      const ys = entity.data["20"] ?? [];
      const flags = Number.parseInt(entity.data["70"]?.[0] ?? "0", 10);
      const vertices: Point[] = [];
      for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
        const x = Number.parseFloat(xs[i]);
        const y = Number.parseFloat(ys[i]);
        vertices.push([units === "m" ? x * 1000 : x, units === "m" ? y * 1000 : y]);
      }
      entities.push({
        type: "polyline",
        layer,
        handle,
        colour: aciToName[Math.abs(colourAci)] ?? "ByLayer",
        data: { vertices, closed: (flags & 1) !== 0 },
      });
      break;
    }
    case "MTEXT":
      entities.push({
        type: "mtext",
        layer,
        handle,
        colour: aciToName[Math.abs(colourAci)] ?? "ByLayer",
        data: {
          position: [num("10"), num("20")],
          width: num("41"),
          height: num("40"),
          contents: str("1") || str("3"),
        },
      });
      break;
    case "INSERT":
      entities.push({
        type: "insert",
        layer,
        handle,
        colour: aciToName[Math.abs(colourAci)] ?? "ByLayer",
        data: { block: str("2"), position: [num("10"), num("20")], scale: num("41", 0) || 1, rotation: num("50") },
      });
      break;
    default:
      skipped.push(entity.type);
  }
}

interface WriteContext {
  lines: string[];
}

function pair(ctx: WriteContext, code: number, value: string | number): void {
  ctx.lines.push(String(code));
  ctx.lines.push(String(value));
}

export interface ExportEntityInput {
  handle: string;
  type: string;
  layer: string;
  colour: string;
  linetype: string;
  lineweight: string;
  geometry: Record<string, unknown>;
}

export interface ExportLayerInput {
  name: string;
  colour: string;
  linetype: string;
  on: boolean;
  frozen: boolean;
  locked: boolean;
}

export function writeDxf(input: {
  units: Units;
  layers: ExportLayerInput[];
  entities: ExportEntityInput[];
}): string {
  const ctx: WriteContext = { lines: [] };
  pair(ctx, 0, "SECTION");
  pair(ctx, 2, "HEADER");
  pair(ctx, 9, "$INSUNITS");
  pair(ctx, 70, input.units === "m" ? 6 : 4);
  pair(ctx, 0, "ENDSEC");
  pair(ctx, 0, "SECTION");
  pair(ctx, 2, "TABLES");
  pair(ctx, 0, "TABLE");
  pair(ctx, 2, "LAYER");
  for (const layer of input.layers) {
    pair(ctx, 0, "LAYER");
    pair(ctx, 5, layer.name);
    pair(ctx, 2, layer.name);
    pair(ctx, 70, (layer.frozen ? 1 : 0) + (layer.locked ? 4 : 0));
    pair(ctx, 62, (layer.on ? 1 : -1) * (nameToAci[layer.colour] ?? 7));
    pair(ctx, 6, layer.linetype);
  }
  pair(ctx, 0, "ENDTAB");
  pair(ctx, 0, "ENDSEC");
  pair(ctx, 0, "SECTION");
  pair(ctx, 2, "ENTITIES");
  const factor = input.units === "m" ? 0.001 : 1;
  const fmt = (n: number): string => (factor === 1 ? n.toFixed(6) : (n * factor).toFixed(6));
  for (const e of input.entities) {
    const g = e.geometry;
    const base = (): void => {
      pair(ctx, 5, e.handle);
      pair(ctx, 8, e.layer);
    };
    switch (e.type) {
      case "line":
        pair(ctx, 0, "LINE");
        base();
        pair(ctx, 10, fmt((g.start as Point)[0]));
        pair(ctx, 20, fmt((g.start as Point)[1]));
        pair(ctx, 11, fmt((g.end as Point)[0]));
        pair(ctx, 21, fmt((g.end as Point)[1]));
        break;
      case "circle":
        pair(ctx, 0, "CIRCLE");
        base();
        pair(ctx, 10, fmt((g.center as Point)[0]));
        pair(ctx, 20, fmt((g.center as Point)[1]));
        pair(ctx, 40, fmt(g.radius as number));
        break;
      case "arc":
        pair(ctx, 0, "ARC");
        base();
        pair(ctx, 10, fmt((g.center as Point)[0]));
        pair(ctx, 20, fmt((g.center as Point)[1]));
        pair(ctx, 40, fmt(g.radius as number));
        pair(ctx, 50, g.start_angle as number);
        pair(ctx, 51, g.end_angle as number);
        break;
      case "polyline":
      case "spline": {
        const vertices = (e.type === "polyline" ? g.vertices : g.fit_points) as Point[];
        pair(ctx, 0, "LWPOLYLINE");
        base();
        pair(ctx, 90, vertices.length);
        pair(ctx, 70, (g.closed === true ? 1 : 0) | (e.type === "spline" ? 0 : 0));
        for (const v of vertices) {
          pair(ctx, 10, fmt(v[0]));
          pair(ctx, 20, fmt(v[1]));
        }
        break;
      }
      case "mtext":
        pair(ctx, 0, "MTEXT");
        base();
        pair(ctx, 10, fmt((g.position as Point)[0]));
        pair(ctx, 20, fmt((g.position as Point)[1]));
        pair(ctx, 40, fmt(g.height as number));
        pair(ctx, 41, fmt(g.width as number));
        pair(ctx, 1, String(g.contents ?? ""));
        break;
      case "insert":
        pair(ctx, 0, "INSERT");
        base();
        pair(ctx, 2, String(g.block ?? ""));
        pair(ctx, 10, fmt((g.position as Point)[0]));
        pair(ctx, 20, fmt((g.position as Point)[1]));
        pair(ctx, 41, g.scale as number);
        pair(ctx, 50, g.rotation as number);
        break;
      case "dimension": {
        const points = g.points as Point[];
        const location = g.location as Point;
        for (const p of points) {
          pair(ctx, 0, "LINE");
          pair(ctx, 5, `${e.handle}${points.indexOf(p) === 0 ? "1" : "2"}`);
          pair(ctx, 8, e.layer);
          pair(ctx, 10, fmt(p[0]));
          pair(ctx, 20, fmt(p[1]));
          pair(ctx, 11, fmt(location[0]));
          pair(ctx, 21, fmt(location[1]));
        }
        pair(ctx, 0, "MTEXT");
        pair(ctx, 5, `${e.handle}T`);
        pair(ctx, 8, e.layer);
        pair(ctx, 10, fmt(location[0]));
        pair(ctx, 20, fmt(location[1]));
        pair(ctx, 40, "100");
        pair(ctx, 41, "1000");
        pair(ctx, 1, String(g.text ?? ""));
        break;
      }
      default:
        break;
    }
  }
  pair(ctx, 0, "ENDSEC");
  pair(ctx, 0, "EOF");
  return ctx.lines.join("\r\n") + "\r\n";
}
