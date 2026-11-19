import { deflateSync } from 'node:zlib';
import type { Content } from './content';
import { notFound } from './errors';
import { getObject, modelKey } from './s3';
import { cameraDistance, eyeOffset, FOV_DEGREES, framingRadius, partOffset } from '../shared/camera';
import { checkGlb, type GlbModel, type GlbNode, type GltfPrimitive } from '../shared/glb';
import { fieldColours } from '../shared/pose';
import type { Part, Step } from '../shared/types';

type Vec3 = [number, number, number];
type Rgb = [number, number, number];

const WIDTH = 800;
const HEIGHT = 600;
const SAMPLES = 2;
const OUTLINE_PIXELS = 2;
const AMBIENT = 0.45;
const GREY = 0.5;
const DARK_OUTLINE: Rgb = [0x1f, 0x15, 0x0c];
const LIGHT_OUTLINE: Rgb = [255, 255, 255];
const LIGHT_DIRECTION: Vec3 = normalise([-0.5, 0.6, -0.65]);

const FLOAT = 5126;
const INDEX_SIZES: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4 };
const TRIANGLES = 4;

/** What a pixel shows: nothing, a silhouette, or a focus part whose outline is dark or light. */
const Mark = { none: 0, silhouette: 1, focusDark: 2, focusLight: 3 } as const;

interface View {
  eye: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  tanHalf: number;
  near: number;
  far: number;
}

interface Canvas {
  width: number;
  height: number;
  invDepth: Float32Array;
  rgb: Uint8Array;
  marks: Uint8Array;
}

interface Look {
  /** material colour (0..1) of a focus part, or null for a silhouette */
  material: Rgb | null;
  silhouette: Rgb;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function hexColour(hex: string): Rgb {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(colour: Rgb): number {
  return 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2];
}

function makeView(content: Content, step: Step, model: GlbModel): View {
  const scale = content.model_scale;
  const { min, max } = model.bounds;
  const target: Vec3 = [((min[0] + max[0]) / 2) * scale, ((min[1] + max[1]) / 2) * scale, ((min[2] + max[2]) / 2) * scale];
  const radius = framingRadius(model.bounds, content.parts, content.steps, scale);
  const distance = cameraDistance(radius, step.camera.zoom);
  const offset = eyeOffset(step.camera.yaw, step.camera.pitch, distance);
  const eye: Vec3 = [target[0] + offset[0], target[1] + offset[1], target[2] + offset[2]];
  const forward = normalise(subtract(target, eye));
  const right = normalise(cross(forward, [0, 1, 0]));
  return {
    eye,
    right,
    up: cross(right, forward),
    forward,
    tanHalf: Math.tan((FOV_DEGREES * Math.PI) / 360),
    near: Math.max(distance - radius * 1.5, distance * 0.01),
    far: distance + radius * 1.5,
  };
}

function makeCanvas(background: Rgb): Canvas {
  const width = WIDTH * SAMPLES;
  const height = HEIGHT * SAMPLES;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < rgb.length; i += 3) {
    rgb[i] = background[0];
    rgb[i + 1] = background[1];
    rgb[i + 2] = background[2];
  }
  return { width, height, invDepth: new Float32Array(width * height), rgb, marks: new Uint8Array(width * height) };
}

/** Reads an accessor's elements as numbers, honouring buffer view offset and stride; null if it does not fit the binary chunk. */
function readAccessor(model: GlbModel, accessorIndex: number, components: number, size: number, read: (view: DataView, at: number) => number): number[] | null {
  const accessor = model.document.accessors?.[accessorIndex];
  const bufferView = model.document.bufferViews?.[accessor?.bufferView ?? -1];
  if (!accessor || !bufferView || !model.bin) return null;
  const stride = bufferView.byteStride ?? components * size;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const end = start + (accessor.count - 1) * stride + components * size;
  if (accessor.count < 1 || end > model.bin.byteLength) return null;
  const view = new DataView(model.bin.buffer, model.bin.byteOffset, model.bin.byteLength);
  const values: number[] = [];
  for (let i = 0; i < accessor.count; i++)
    for (let c = 0; c < components; c++) values.push(read(view, start + i * stride + c * size));
  return values;
}

function readPositions(model: GlbModel, primitive: GltfPrimitive): number[] | null {
  const index = primitive.attributes.POSITION;
  const accessor = index === undefined ? undefined : model.document.accessors?.[index];
  if (index === undefined || accessor?.componentType !== FLOAT || accessor.type !== 'VEC3') return null;
  return readAccessor(model, index, 3, 4, (view, at) => view.getFloat32(at, true));
}

function readIndices(model: GlbModel, primitive: GltfPrimitive, vertexCount: number): number[] | null {
  if (primitive.indices === undefined) return Array.from({ length: vertexCount }, (_, i) => i);
  const accessor = model.document.accessors?.[primitive.indices];
  const size = INDEX_SIZES[accessor?.componentType ?? 0];
  if (!accessor || !size || accessor.type !== 'SCALAR') return null;
  return readAccessor(model, primitive.indices, 1, size, (view, at) =>
    size === 1 ? view.getUint8(at) : size === 2 ? view.getUint16(at, true) : view.getUint32(at, true),
  );
}

function materialColour(model: GlbModel, primitive: GltfPrimitive): Rgb {
  const factor = model.document.materials?.[primitive.material ?? -1]?.pbrMetallicRoughness?.baseColorFactor;
  return factor && factor.length >= 3 ? [factor[0]!, factor[1]!, factor[2]!] : [GREY, GREY, GREY];
}

/** Sum of the offsets of every part bound to this node or to one of its ancestors, in model space. */
function nodeOffset(node: GlbNode, parts: readonly Part[], explode: number): Vec3 {
  const total: Vec3 = [0, 0, 0];
  for (const part of parts) {
    if (node.nodePath !== part.node_path && !node.nodePath.startsWith(`${part.node_path}/`)) continue;
    const offset = partOffset(part, explode);
    for (let axis = 0; axis < 3; axis++) total[axis]! += offset[axis]!;
  }
  return total;
}

/** Vertex positions of a primitive in camera space: x right, y up, z forward (distance along the view direction). */
function toViewSpace(positions: readonly number[], node: GlbNode, offset: Vec3, scale: number, view: View): Vec3[] {
  const w = node.world;
  const result: Vec3[] = [];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    const world: Vec3 = [
      (w[0]! * x + w[4]! * y + w[8]! * z + w[12]! + offset[0]) * scale,
      (w[1]! * x + w[5]! * y + w[9]! * z + w[13]! + offset[1]) * scale,
      (w[2]! * x + w[6]! * y + w[10]! * z + w[14]! + offset[2]) * scale,
    ];
    const relative = subtract(world, view.eye);
    result.push([dot(relative, view.right), dot(relative, view.up), dot(relative, view.forward)]);
  }
  return result;
}

function triangleColour(a: Vec3, b: Vec3, c: Vec3, look: Look): Rgb {
  if (!look.material) return look.silhouette;
  const normal = normalise(cross(subtract(b, a), subtract(c, a)));
  const facing = normal[2] > 0 ? -1 : 1;
  const light = AMBIENT + (1 - AMBIENT) * Math.max(0, facing * dot(normal, LIGHT_DIRECTION));
  return [look.material[0] * light * 255, look.material[1] * light * 255, look.material[2] * light * 255];
}

function markOf(look: Look): number {
  if (!look.material) return Mark.silhouette;
  return luminance(look.material) > 0.4 ? Mark.focusDark : Mark.focusLight;
}

function drawTriangle(canvas: Canvas, view: View, points: readonly [Vec3, Vec3, Vec3], look: Look): void {
  if (points.some((p) => p[2] < view.near || p[2] > view.far)) return;
  const screen = points.map((p) => [
    (((p[0] / (p[2] * view.tanHalf * (WIDTH / HEIGHT))) * 0.5 + 0.5) * canvas.width),
    ((0.5 - (p[1] / (p[2] * view.tanHalf)) * 0.5) * canvas.height),
    1 / p[2],
  ]) as [number, number, number][];
  const [a, b, c] = screen as [[number, number, number], [number, number, number], [number, number, number]];
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return;
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const x1 = Math.min(canvas.width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const y1 = Math.min(canvas.height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const colour = triangleColour(...points, look);
  const mark = markOf(look);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const invDepth = w0 * a[2] + w1 * b[2] + w2 * c[2];
      const at = y * canvas.width + x;
      if (invDepth <= canvas.invDepth[at]!) continue;
      canvas.invDepth[at] = invDepth;
      canvas.marks[at] = mark;
      canvas.rgb[at * 3] = colour[0];
      canvas.rgb[at * 3 + 1] = colour[1];
      canvas.rgb[at * 3 + 2] = colour[2];
    }
}

function drawNode(canvas: Canvas, view: View, model: GlbModel, node: GlbNode, offset: Vec3, scale: number, focus: boolean, silhouette: Rgb): void {
  if (node.mesh === null) return;
  for (const primitive of model.document.meshes?.[node.mesh]?.primitives ?? []) {
    if ((primitive.mode ?? TRIANGLES) !== TRIANGLES) continue;
    const positions = readPositions(model, primitive);
    const vertices = positions ? toViewSpace(positions, node, offset, scale, view) : null;
    const indices = vertices ? readIndices(model, primitive, vertices.length) : null;
    if (!vertices || !indices) continue;
    const look: Look = { material: focus ? materialColour(model, primitive) : null, silhouette };
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const a = vertices[indices[i]!], b = vertices[indices[i + 1]!], c = vertices[indices[i + 2]!];
      if (a && b && c) drawTriangle(canvas, view, [a, b, c], look);
    }
  }
}

/** Paints a band around the focus parts: the focus pixels grown by the outline width, minus the focus pixels themselves. */
function paintOutlines(canvas: Canvas): void {
  const { width, height, marks } = canvas;
  const radius = OUTLINE_PIXELS * SAMPLES;
  const grown = new Uint8Array(marks.length);
  const across = new Uint8Array(marks.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const mark = marks[y * width + x]!;
      if (mark < Mark.focusDark) continue;
      for (let dx = Math.max(0, x - radius); dx <= Math.min(width - 1, x + radius); dx++)
        across[y * width + dx] = Math.max(across[y * width + dx]!, mark);
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const mark = across[y * width + x]!;
      if (mark === Mark.none) continue;
      for (let dy = Math.max(0, y - radius); dy <= Math.min(height - 1, y + radius); dy++)
        grown[dy * width + x] = Math.max(grown[dy * width + x]!, mark);
    }
  for (let at = 0; at < marks.length; at++) {
    if (marks[at]! >= Mark.focusDark || grown[at] === Mark.none) continue;
    canvas.rgb.set(grown[at] === Mark.focusDark ? DARK_OUTLINE : LIGHT_OUTLINE, at * 3);
  }
}

function downsample(canvas: Canvas): Buffer {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  const samples = SAMPLES * SAMPLES;
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++)
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let sy = 0; sy < SAMPLES; sy++)
          for (let sx = 0; sx < SAMPLES; sx++) sum += canvas.rgb[((y * SAMPLES + sy) * canvas.width + x * SAMPLES + sx) * 3 + channel]!;
        pixels[(y * WIDTH + x) * 3 + channel] = Math.round(sum / samples);
      }
  return pixels;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function encodePng(pixels: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  const stride = WIDTH * 3;
  const rows = Buffer.alloc((stride + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) pixels.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A PNG (800x600) of one guide step, drawn without a GPU: focus parts lit and outlined, every other part a flat silhouette. */
export async function renderStill(content: Content, stepNumber: number): Promise<Buffer> {
  const step = content.steps[stepNumber - 1];
  const bytes = content.model_id === null ? null : await getObject(modelKey(content.model_id));
  if (!step || !bytes) throw notFound();
  const checked = checkGlb(bytes, { modelMaxBytes: Infinity, modelMaxParts: Infinity });
  if (!checked.ok) throw notFound();
  const model = checked.model;
  const colours = fieldColours[step.phase];
  const canvas = makeCanvas(hexColour(colours.field));
  const view = makeView(content, step, model);
  const silhouette = hexColour(colours.text);
  for (const node of model.nodes) {
    const part = content.parts.find((p) => p.node_path === node.nodePath);
    const focus = part !== undefined && step.focus_parts.includes(part.id);
    const offset = nodeOffset(node, content.parts, step.explode);
    drawNode(canvas, view, model, node, offset, content.model_scale, focus, silhouette);
  }
  paintOutlines(canvas);
  return encodePng(downsample(canvas));
}
