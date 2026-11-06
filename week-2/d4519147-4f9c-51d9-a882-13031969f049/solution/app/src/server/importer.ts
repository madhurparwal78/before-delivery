import { randomBytes } from "node:crypto";
import { closestPorts, elbowPath, portPoint } from "../shared/geometry.ts";
import { isSystemKind, isZoneKind, type Connector, type PageDoc, type Point, type PortSide, type Shape, type Zone, type ZoneKind } from "../shared/model.ts";
import { ApiError } from "./http.ts";
import { validatePage } from "./validate.ts";
import { isElement, NotDiagramXml, ParseLimitExceeded, parseXml, SVG_NS, textOf, type ParsedXml, type XmlElement } from "./xml.ts";

const unsupportedFileType = () => new ApiError(415, "unsupported_file_type", "Only diagram XML and SVG files can be imported.");
const invalidModel = () => new ApiError(422, "invalid_model", "This file does not describe a valid diagram.");
const unsafeFile = () => new ApiError(422, "unsafe_file", "This file contains scripts, external entities or unsafe links and was not imported.");

function* walk(element: XmlElement): Generator<XmlElement> {
  yield element;
  for (const child of element.children) if (isElement(child)) yield* walk(child);
}

/** Values are judged after character references are decoded, with whitespace and control characters removed, ignoring case. */
const normalize = (value: string) => value.replace(/[\s\u0000-\u001f\u007f-\u009f]/g, "").toLowerCase();

const BLOCKED_ELEMENTS = new Set(["script", "foreignobject", "iframe", "embed", "object"]);
const ANIMATIONS = new Set(["animate", "set", "animatetransform"]);
const TEXT_ATTRIBUTES = new Set(["label", "name", "note", "id", "kind", "from", "to"]);

function unsafeCss(value: string): boolean {
  const v = normalize(value);
  if (v.includes("@import")) return true;
  let at = v.indexOf("url(");
  while (at !== -1) {
    const close = v.indexOf(")", at + 4);
    const target = v.slice(at + 4, close === -1 ? undefined : close).replace(/["']/g, "");
    if (!target.startsWith("#")) return true;
    at = v.indexOf("url(", at + 4);
  }
  return false;
}

/** Judged on the parsed document, never on raw text. */
function isUnsafe(doc: ParsedXml): boolean {
  if (doc.doctype || doc.processingInstruction) return true;
  for (const el of walk(doc.root)) {
    const local = el.local.toLowerCase();
    if (BLOCKED_ELEMENTS.has(local)) return true;
    if (local === "style" && unsafeCss(textOf(el))) return true;
    for (const a of el.attrs) {
      const name = a.local.toLowerCase();
      if (a.prefix === "xmlns" || a.qname === "xmlns") continue;
      if (name.startsWith("on")) return true;
      if (name === "src" || name === "action" || name === "formaction") return true;
      if (name === "href") {
        const v = normalize(a.value);
        if (v !== "" && !v.startsWith("#")) return true;
      }
      if (!TEXT_ATTRIBUTES.has(name) && !name.startsWith("data-") && unsafeCss(a.value)) return true;
    }
    if (ANIMATIONS.has(local)) {
      const attr = (n: string) => el.attrs.find((a) => a.local.toLowerCase() === n)?.value;
      const target = normalize(attr("attributename") ?? "");
      if (target === "href" || target.endsWith(":href")) return true;
      const scripted = (v: string | undefined) => v !== undefined && /^(javascript|data):/.test(normalize(v));
      if (scripted(attr("to")) || scripted(attr("from"))) return true;
      if ((attr("values") ?? "").split(";").some((item) => scripted(item))) return true;
    }
  }
  return false;
}

const freshId = (prefix: string) => `${prefix}-${randomBytes(6).toString("hex")}`;
const attr = (el: XmlElement, name: string) => el.attrs.find((a) => a.qname === name)?.value;
const children = (el: XmlElement, local: string) => el.children.filter((c): c is XmlElement => isElement(c) && c.local === local);

function number(value: string | undefined, fallback?: number): number {
  if (value === undefined || value.trim() === "") {
    if (fallback !== undefined) return fallback;
    throw invalidModel();
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw invalidModel();
  return Math.round(n);
}

function flow(id: string, label: string, a: Shape, b: Shape): Connector {
  const [pa, pb] = closestPorts(a, b);
  return { id, label, from: { shapeId: a.id, port: pa }, to: { shapeId: b.id, port: pb }, points: elbowPath(portPoint(a, pa), portPoint(b, pb)) };
}

interface Model {
  zones: Zone[];
  shapes: Shape[];
  connectors: Connector[];
}

function fromDiagramXml(root: XmlElement): Model {
  const model: Model = { zones: [], shapes: [], connectors: [] };
  const pages = children(root, "page");
  if (pages.length === 0) throw invalidModel();
  for (const page of pages) {
    if (attr(page, "name") === undefined) throw invalidModel();
    const systems = new Map<string, Shape>();
    for (const el of page.children.filter(isElement)) {
      if (el.local === "zone") {
        const kind = attr(el, "kind");
        if (!isZoneKind(kind)) throw invalidModel();
        const note = children(el, "note")[0];
        model.zones.push({
          id: freshId("zone"), kind, name: attr(el, "name") ?? "", note: note ? textOf(note) : "",
          x: number(attr(el, "x")), y: number(attr(el, "y")), width: number(attr(el, "width")), height: number(attr(el, "height")),
        });
      } else if (el.local === "system") {
        const kind = attr(el, "kind");
        const shape: Shape = {
          id: freshId("shp"), kind: isSystemKind(kind) ? kind : "server", label: attr(el, "label") ?? "",
          x: number(attr(el, "x")), y: number(attr(el, "y")), width: number(attr(el, "width")), height: number(attr(el, "height")),
          z: model.shapes.length + 1, groupId: null,
        };
        const sourceId = attr(el, "id");
        if (sourceId === undefined || systems.has(sourceId)) throw invalidModel();
        systems.set(sourceId, shape);
        model.shapes.push(shape);
      }
    }
    for (const el of children(page, "flow")) {
      const a = systems.get(attr(el, "from") ?? ""), b = systems.get(attr(el, "to") ?? "");
      if (!a || !b) throw invalidModel();
      model.connectors.push(flow(freshId("con"), attr(el, "label") ?? "", a, b));
    }
  }
  return model;
}

const ZONE_DATA_KINDS: Record<string, ZoneKind> = { "zone-cde": "cde", "zone-connected": "connected", "zone-out": "out_of_scope" };
const isPort = (v: string | undefined): v is PortSide => v === "n" || v === "e" || v === "s" || v === "w";

function titleOf(el: XmlElement): string {
  const title = children(el, "title").find((t) => t.ns === SVG_NS);
  return title ? textOf(title) : "";
}

function parsePoints(value: string): Point[] | null {
  const nums = value.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (nums.length < 4 || nums.length % 2 || nums.some((n) => !Number.isFinite(n))) return null;
  const pts: Point[] = [];
  for (let i = 0; i < nums.length; i += 2) pts.push([Math.round(nums[i]!), Math.round(nums[i + 1]!)]);
  return pts;
}

function fromSvg(root: XmlElement): Model {
  const model: Model = { zones: [], shapes: [], connectors: [] };
  const byDataId = new Map<string, Shape | Zone>();
  const dataIds = new Set<string>();
  const svgElements = [...walk(root)].filter((el) => el.ns === SVG_NS);
  for (const el of svgElements) {
    if (el.local !== "rect") continue;
    const dataId = attr(el, "data-id");
    if (dataId !== undefined) {
      if (dataIds.has(dataId)) throw invalidModel();
      dataIds.add(dataId);
    }
    const dataKind = attr(el, "data-kind") ?? "";
    const box = { x: number(attr(el, "x"), 0), y: number(attr(el, "y"), 0), width: number(attr(el, "width")), height: number(attr(el, "height")) };
    const zoneKind = ZONE_DATA_KINDS[dataKind];
    let item: Shape | Zone | null = null;
    if (zoneKind) {
      item = { id: freshId("zone"), kind: zoneKind, name: titleOf(el), note: "", ...box };
      model.zones.push(item);
    } else if (isSystemKind(dataKind)) {
      item = { id: freshId("shp"), kind: dataKind, label: titleOf(el), ...box, z: model.shapes.length + 1, groupId: null };
      model.shapes.push(item);
    }
    if (dataId !== undefined && item) byDataId.set(dataId, item);
  }
  for (const el of svgElements) {
    if (el.local !== "polyline" || attr(el, "data-connector") === undefined) continue;
    const a = byDataId.get(attr(el, "data-from") ?? ""), b = byDataId.get(attr(el, "data-to") ?? "");
    const pa = attr(el, "data-from-port"), pb = attr(el, "data-to-port");
    if (!a || !b || !("z" in a) || !("z" in b) || !isPort(pa) || !isPort(pb)) continue;
    const start = portPoint(a, pa), end = portPoint(b, pb);
    const pts = parsePoints(attr(el, "points") ?? "");
    const kept = pts !== null &&
      pts[0]![0] === start[0] && pts[0]![1] === start[1] &&
      pts[pts.length - 1]![0] === end[0] && pts[pts.length - 1]![1] === end[1] &&
      pts.every((p, i) => i === 0 || p[0] === pts[i - 1]![0] || p[1] === pts[i - 1]![1]);
    model.connectors.push({
      id: freshId("con"), label: titleOf(el),
      from: { shapeId: a.id, port: pa }, to: { shapeId: b.id, port: pb },
      points: kept ? pts : elbowPath(start, end),
    });
  }
  return model;
}

/**
 * Judges an upload in the published order: type (415), parse limits (422 invalid_model),
 * unsafe content (422 unsafe_file), then the model's page validation (422 invalid_model).
 */
export function readImport(bytes: Buffer, fileName: string, pageId: string): PageDoc {
  let parsed: ParsedXml;
  try {
    parsed = parseXml(bytes);
  } catch (error) {
    if (error instanceof ParseLimitExceeded) throw invalidModel();
    if (error instanceof NotDiagramXml) throw unsupportedFileType();
    throw error;
  }
  if (isUnsafe(parsed)) throw unsafeFile();
  const model = parsed.root.local === "diagram" ? fromDiagramXml(parsed.root) : fromSvg(parsed.root);
  try {
    return validatePage({ id: pageId, name: `Imported ${fileName}`, version: 1, ...model });
  } catch (error) {
    if (error instanceof ApiError) throw invalidModel();
    throw error;
  }
}
