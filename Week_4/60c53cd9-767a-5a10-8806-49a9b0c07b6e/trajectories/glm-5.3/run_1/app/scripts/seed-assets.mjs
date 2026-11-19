// Generates the seeded tower assets: the Draco-compressed shell and floor-plate
// models, the facade texture, the duotone ramp, and one full-colour view
// photograph per released band and stack (except 30-35/H). All bytes are drawn
// procedurally by this script, so no third-party artwork is involved.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import draco3d from 'draco3d';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? resolve(here, '..', 'seed-assets');

const STACKS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const BANDS = [
  { id: '03-09', floors: [3, 9] },
  { id: '10-19', floors: [10, 19] },
  { id: '20-29', floors: [20, 29] },
  { id: '30-35', floors: [30, 35] },
  { id: '36-38', floors: [36, 38] },
];
const STACK_BEARINGS = { A: 134, B: 178, C: 214, D: 268, E: 311, F: 4, G: 41, H: 93 };
const STACK_VIEWS = { A: 'park', B: 'park', C: 'harbour-partial', D: 'harbour-partial', E: 'ridge', F: 'ridge', G: 'city', H: 'city' };
const STACK_METAS = {
  A: { bedrooms: 2, areaM2: 78 },
  B: { bedrooms: 2, areaM2: 74 },
  C: { bedrooms: 3, areaM2: 112 },
  D: { bedrooms: 2, areaM2: 71 },
  E: { bedrooms: 1, areaM2: 52 },
  F: { bedrooms: 1, areaM2: 49 },
  G: { bedrooms: 2, areaM2: 76 },
  H: { bedrooms: 3, areaM2: 108 },
};

// Octagonal tower: eight stacks around an octagon plan, one face per stack.
const RADIUS = 7.5;
const FLOOR_HEIGHT = 1;
const PODIUM_HEIGHT = 2 * FLOOR_HEIGHT;
const RESIDENTIAL_FLOORS = 36;
const CAMERAS = { width: 40, height: 24 };

function stackAngle(stack) {
  const idx = STACKS.indexOf(stack);
  return (STACK_BEARINGS[stack] * Math.PI) / 180;
}

function stackCentre(stack) {
  const idx = STACKS.indexOf(stack);
  const angle = (idx / STACKS.length) * Math.PI * 2;
  // The window direction for each stack is its bearing, so the face normal for
  // stack i points at bearing_i. Bearing is measured from north (-Z) clockwise.
  const normalAngle = (STACK_BEARINGS[stack] * Math.PI) / 180;
  const centreAngle = normalAngle + Math.PI;
  return new THREE.Vector3(Math.sin(centreAngle) * RADIUS, 0, -Math.cos(centreAngle) * RADIUS);
}

function makeShell() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  // Podium: two storeys, slightly wider.
  const podium = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS + 1.5, RADIUS + 1.5, PODIUM_HEIGHT, 8, 1, true), material);
  podium.position.y = PODIUM_HEIGHT / 2;
  group.add(podium);
  // Residential: 36 storeys as an open octagonal shell.
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, RADIUS, RESIDENTIAL_FLOORS * FLOOR_HEIGHT, 8, RESIDENTIAL_FLOORS, true), material);
  shell.position.y = PODIUM_HEIGHT + (RESIDENTIAL_FLOORS * FLOOR_HEIGHT) / 2;
  group.add(shell);
  // Floor slabs.
  for (let i = 0; i <= RESIDENTIAL_FLOORS; i++) {
    const slab = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 8), new THREE.MeshBasicMaterial({ color: 0xdddddd, side: THREE.DoubleSide }));
    slab.rotation.x = -Math.PI / 2;
    slab.position.y = PODIUM_HEIGHT + i * FLOOR_HEIGHT;
    group.add(slab);
  }
  return group;
}

function makePlate(band) {
  const group = new THREE.Group();
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(RADIUS, RADIUS, 0.08, 8, 1, false),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  group.add(plate);
  for (const stack of STACKS) {
    const centre = stackCentre(stack);
    const windowNode = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.6, 0.6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    windowNode.name = `window-${stack}`;
    windowNode.position.set(centre.x, 0, centre.z);
    // Face the window toward the stack's bearing. North is -Z, east is +X.
    windowNode.rotation.y = -(STACK_BEARINGS[stack] * Math.PI) / 180;
    group.add(windowNode);
  }
  return group;
}

async function dracoEncode(exporterModule, geometryPositions, geometryIndices) {
  const encoder = new encoderClass(exporterModule);
  return encoder;
}

let encoderClass;

async function dracoWrap(glb) {
  // Draco-encode the glTF by feeding each mesh's positions and indices through
  // the encoder, then rebuild the GLB with a KHR_draco_mesh_compression extension.
  const buffer = ArrayBuffer.isView(glb) ? Buffer.from(glb.buffer, glb.byteOffset, glb.byteLength) : Buffer.from(glb);
  // Parse the GLB header and json chunk.
  const magic = buffer.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error('not a GLB');
  const jsonLength = buffer.readUInt32LE(12);
  const jsonText = buffer.toString('utf8', 20, 20 + jsonLength);
  const json = JSON.parse(jsonText);
  const binHeaderStart = 20 + jsonLength;
  const binLength = buffer.readUInt32LE(binHeaderStart + 4);
  const binStart = binHeaderStart + 8;
  const bin = buffer.subarray(binStart, binStart + binLength);

  // Decode accessor data for each mesh primitive and re-encode it with Draco.
  const encoderModule = await draco3d.createEncoderModule();
  const encoder = new encoderModule.Encoder();
  const meshBuilder = new encoderModule.MeshBuilder();
  const outBuffers = [];
  let nextBufferOffset = 0;
  const accessors = json.accessors;
  const bufferViews = json.bufferViews;

  const decodeF32 = (accessor) => {
    const view = bufferViews[accessor.bufferView];
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const count = accessor.count;
    const width = accessor.type === 'VEC3' ? 3 : accessor.type === 'VEC2' ? 2 : accessor.type === 'SCALAR' ? 1 : 3;
    const source = bin.subarray(start, start + count * 4 * width);
    const copy = Buffer.from(source);
    const floats = new Float32Array(count * width);
    for (let i = 0; i < floats.length; i++) floats[i] = copy.readFloatLE(i * 4);
    return Array.from(floats);
  };
  const decodeIndices = (accessor) => {
    const view = bufferViews[accessor.bufferView];
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const count = accessor.count;
    const bytesPerComponent = accessor.componentType === 5123 ? 2 : 4;
    const source = Buffer.from(bin.subarray(start, start + count * bytesPerComponent));
    const ints = [];
    for (let i = 0; i < count; i++) {
      ints.push(bytesPerComponent === 2 ? source.readUInt16LE(i * 2) : source.readUInt32LE(i * 4));
    }
    return ints;
  };

  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      const positionAccessor = accessors[primitive.attributes.POSITION];
      const positions = decodeF32(positionAccessor);
      const indices = decodeIndices(accessors[primitive.indices]);
      const dracoMesh = new encoderModule.Mesh();
      meshBuilder.AddFacesToMesh(dracoMesh, indices.length / 3, new Uint32Array(indices));
      meshBuilder.AddFloatAttributeToMesh(dracoMesh, encoderModule.POSITION, positions.length / 3, 3, new Float32Array(positions));
      const normals = primitive.attributes.NORMAL !== undefined ? decodeF32(accessors[primitive.attributes.NORMAL]) : null;
      if (normals) {
        meshBuilder.AddFloatAttributeToMesh(dracoMesh, encoderModule.NORMAL, normals.length / 3, 3, new Float32Array(normals));
      }
      const uvs = primitive.attributes.TEXCOORD_0 !== undefined ? decodeF32(accessors[primitive.attributes.TEXCOORD_0]) : null;
      if (uvs) {
        meshBuilder.AddFloatAttributeToMesh(dracoMesh, encoderModule.TEX_COORD, uvs.length / 2, 2, new Float32Array(uvs));
      }
      encoder.SetSpeedOptions(10, 10);
      encoder.SetAttributeQuantization(encoderModule.POSITION, 14);
      encoder.SetEncodingMethod(encoderModule.MESH_EDGEBREAKER_ENCODING);
      const encoded = new encoderModule.DracoInt8Array();
      const length = encoder.EncodeMeshToDracoBuffer(dracoMesh, encoded);
      if (length <= 0) throw new Error('draco encode failed');
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = encoded.GetValue(i);
      encoderModule.destroy(dracoMesh);
      encoderModule.destroy(encoded);
      primitive.extensions = primitive.extensions ?? {};
      primitive.extensions.KHR_draco_mesh_compression = {
        bufferView: addBufferView(nextBufferOffset, bytes.length),
        attributes: {},
      };
      if (normals) primitive.extensions.KHR_draco_mesh_compression.attributes.NORMAL = 0;
      if (uvs) primitive.extensions.KHR_draco_mesh_compression.attributes.TEXCOORD_0 = 1;
      outBuffers.push(bytes);
      nextBufferOffset += bytes.length + ((4 - (bytes.length % 4)) % 4);
      delete primitive.attributes;
      delete primitive.indices;
      delete primitive.mode;
    }
  }

  function addBufferView(offset, length) {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: length });
    return bufferViews.length - 1;
  }

  json.extensionsUsed = [...(json.extensionsUsed ?? []), 'KHR_draco_mesh_compression'];
  json.extensionsRequired = [...(json.extensionsRequired ?? []), 'KHR_draco_mesh_compression'];
  json.bufferViews = bufferViews;
  const usedLength = nextBufferOffset;
  const binPadding = (4 - (usedLength % 4)) % 4;
  const binPayload = Buffer.alloc(usedLength + binPadding, 0);
  let offset = 0;
  for (const chunk of outBuffers) {
    binPayload.set(chunk, offset);
    offset += chunk.length + ((4 - (chunk.length % 4)) % 4);
  }

  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPadding, 0x20)]);
  const binChunkHeader = Buffer.alloc(8);
  const binPaddedLength = binPayload.length;
  binChunkHeader.writeUInt32LE(binPaddedLength, 0);
  binChunkHeader.write('BIN', 4, 'ascii');
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  const total = 12 + 8 + jsonChunk.length + 8 + binPaddedLength;
  header.writeUInt32LE(total, 8);
  return Buffer.concat([header, (() => { const c = Buffer.alloc(8); c.writeUInt32LE(jsonChunk.length, 0); c.write('JSON', 4, 'ascii'); return c; })(), jsonChunk, binChunkHeader, binPayload]);
}

// Node has no FileReader; three's GLTFExporter uses it to read back the Blob it
// builds. Polyfill just enough for the binary path used here.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  };
}

const exporter = new GLTFExporter();
const exporterParse = (scene) => exporter.parseAsync(scene, { binary: true });

async function main() {
  mkdirSync(outDir, { recursive: true });

  const shell = makeShell();
  const shellBuffer = await exporterParse(shell);
  const shellDraco = await dracoWrap(shellBuffer);
  writeFileSync(resolve(outDir, 'tower-shell.glb'), shellDraco);

  for (const band of BANDS) {
    const plate = makePlate(band);
    const plateBuffer = await exporterParse(plate);
    const plateDraco = await dracoWrap(plateBuffer);
    writeFileSync(resolve(outDir, `plate-${band.id}.glb`), plateDraco);
  }

  // Facade texture: a flat two-colour ultramarine/white grid PNG.
  const facadePng = makeFacadeTexture();
  writeFileSync(resolve(outDir, 'facade.png'), facadePng);

  // Duotone ramp: hard steps between the two field colours.
  const rampPng = makeRampPng();
  writeFileSync(resolve(outDir, 'duotone-ramp.png'), rampPng);

  // View photographs: 1024x512, full colour, one per released band and stack
  // except 30-35/H. The unreleased band is skipped entirely.
  let count = 0;
  for (const band of BANDS) {
    for (const stack of STACKS) {
      if (band.id === '30-35' && stack === 'H') continue;
      if (band.id === '36-38') continue;
      const png = makeViewPng(band, stack);
      writeFileSync(resolve(outDir, `view-${band.id}-${stack}.png`), png);
      count++;
    }
  }
  console.log('assets written to', outDir, `${count} views`);
}

// Node has no FileReader; three's GLTFExporter uses it to read back the Blob it
// builds. Polyfill just enough for the binary path used here.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  };
}


// ---------- PNG encoding ----------

function crc32(bytes) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

export function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    rgba.copy ? rgba.copy(raw, p, y * width * 4, (y + 1) * width * 4) : null;
    p += width * 4;
  }
  const compressed = deflateRawSync(raw);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

import { deflateRawSync } from 'node:zlib';

// ---------- textures ----------

function makeFacadeTexture() {
  const width = 512;
  const height = 256;
  const px = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inWindow = y % 32 > 8 && (x % 32 > 8 && x % 32 < 24);
      const colour = inWindow ? [255, 255, 255] : [43, 34, 122];
      px[i] = colour[0];
      px[i + 1] = colour[1];
      px[i + 2] = colour[2];
      px[i + 3] = 255;
    }
  }
  return encodePng(width, height, px);
}

function makeRampPng() {
  const width = 8;
  const height = 8;
  const px = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const light = (x / width) * 2 > 1;
      const colour = light ? [255, 255, 255] : [43, 34, 122];
      px[i] = colour[0];
      px[i + 1] = colour[1];
      px[i + 2] = colour[2];
      px[i + 3] = 255;
    }
  }
  return encodePng(width, height, px);
}

// ---------- view photographs ----------

const VIEW_PALETTES = {
  park: { sky: [116, 174, 224], horizon: [96, 156, 110], feature: [64, 120, 84], dark: [40, 88, 64] },
  city: { sky: [128, 166, 208], horizon: [150, 152, 168], feature: [96, 100, 120], dark: [64, 68, 88] },
  ridge: { sky: [140, 176, 210], horizon: [120, 130, 120], feature: [88, 92, 80], dark: [60, 64, 56] },
  harbour: { sky: [116, 168, 220], horizon: [60, 120, 170], feature: [40, 90, 140], dark: [24, 60, 100] },
  'harbour-partial': { sky: [116, 168, 220], horizon: [60, 120, 170], feature: [40, 90, 140], dark: [24, 60, 100] },
};

function makeViewPng(band, stack) {
  const width = 1024;
  const height = 512;
  const px = Buffer.alloc(width * height * 4);
  const view = viewForBandStack(band, stack);
  const palette = VIEW_PALETTES[view];
  // The horizon sits lower in higher bands.
  const horizon = Math.floor(height * (0.72 - bandIndex(band) * 0.08));
  const bearing = STACK_BEARINGS[stack];
  // Deterministic per-image variation from the band and stack.
  const seedBase = bandIndex(band) * 31 + STACKS.indexOf(stack) * 7;
  const rand = mulberry(seedBase + 1);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let colour;
      if (y < horizon) {
        // Sky with a faint band of cloud, still flat-colour blocks.
        const cloud = noiseBand(x, y, seedBase);
        colour = cloud ? lighten(palette.sky, 12) : palette.sky;
        if (y < horizon - 40 && ((x + seedBase * 13) % 512) < 3) {
          colour = lighten(palette.sky, 30);
        }
      } else {
        // Ground plane with the view's feature blocks.
        const depth = (y - horizon) / (height - horizon);
        const blockNoise = noiseBand(x, y + seedBase * 5, seedBase + 3);
        colour = mix(palette.horizon, palette.dark, depth);
        if (blockNoise) colour = mix(palette.feature, palette.dark, depth * 0.6);
        if (view === 'harbour' || view === 'harbour-partial') {
          colour = mix(palette.horizon, palette.dark, Math.min(1, depth * 1.4));
          const wave = ((x * 3 + y * 2 + seedBase * 11) % 64) < 2;
          if (wave && depth > 0.15) colour = lighten(colour, 10);
        }
        if (view === 'harbour-partial') {
          // The invented Calder House block fills about half the frame.
          const blockX0 = Math.floor(width * 0.28);
          const blockX1 = Math.floor(width * 0.78);
          const blockTop = horizon - Math.floor((height - horizon) * 0.75);
          if (x >= blockX0 && x <= blockX1 && y >= blockTop && y <= horizon + Math.floor((height - horizon) * 0.35)) {
            const inWindowColumn = ((x - blockX0) % 48) < 30;
            const inWindowRow = ((y - blockTop) % 40) < 26;
            colour = inWindowColumn && inWindowRow ? lighten(palette.feature, 18) : palette.feature;
          }
        }
        if (view === 'city' || view === 'park') {
          // Scattered building blocks / trees at deterministic positions.
          const blocks = view === 'city' ? 5 : 8;
          for (let b = 0; b < blocks; b++) {
            const cx = Math.floor(((b * 197 + seedBase * 31 + 13) % width));
            const w = 40 + ((b * 53 + seedBase) % 60);
            const top = horizon - 20 - ((b * 71 + seedBase * 17) % 120);
            if (x >= cx && x <= cx + w && y >= top && y <= height) {
              colour = view === 'city' ? palette.dark : mix(palette.dark, [10, 40, 20], 0.2);
              if (view === 'park' && ((x - cx) % 16) < 8) colour = palette.feature;
            }
          }
        }
        if (view === 'ridge') {
          // Layered hills.
          const ridgeY = horizon + Math.floor(Math.sin((x / width) * Math.PI * 4 + seedBase) * 30) + 40;
          if (y > ridgeY) colour = mix(palette.dark, palette.feature, 0.3);
          const ridgeY2 = horizon + Math.floor(Math.sin((x / width) * Math.PI * 7 + seedBase * 2) * 18) + 90;
          if (y > ridgeY2) colour = palette.dark;
        }
      }
      px[i] = colour[0];
      px[i + 1] = colour[1];
      px[i + 2] = colour[2];
      px[i + 3] = 255;
    }
  }
  void bearing;
  void rand;
  return encodePng(width, height, px);
}

function viewForBandStack(band, stack) {
  const base = STACK_VIEWS[stack];
  if ((stack === 'C' || stack === 'D') && band.floors[0] >= 20) return 'harbour';
  return base;
}

function bandIndex(band) {
  return BANDS.findIndex((b) => b.id === band.id);
}

function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseBand(x, y, seed) {
  const v = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return v - Math.floor(v) > 0.82;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function lighten(c, amount) {
  return [Math.min(255, c[0] + amount), Math.min(255, c[1] + amount), Math.min(255, c[2] + amount)];
}

await main();
