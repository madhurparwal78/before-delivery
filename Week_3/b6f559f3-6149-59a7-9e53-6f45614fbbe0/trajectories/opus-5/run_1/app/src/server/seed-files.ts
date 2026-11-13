import { deflateSync } from 'node:zlib';

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.byteLength; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** A PNG generated in code: no image files are shipped. */
export function generatePng(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      raw[offset] = 40 + ((x * 3) % 60);
      raw[offset + 1] = 36 + ((y * 2) % 48);
      raw[offset + 2] = 70 + ((x + y) % 90);
      offset += 3;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

interface Accessor {
  bufferView: number;
  componentType: number;
  count: number;
  type: string;
}

function boxGeometry(): { positions: number[]; normals: number[]; indices: number[] } {
  const faces: { normal: [number, number, number]; corners: [number, number, number][] }[] = [
    { normal: [0, 0, 1], corners: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
    { normal: [0, 0, -1], corners: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
    { normal: [-1, 0, 0], corners: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
    { normal: [1, 0, 0], corners: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
    { normal: [0, 1, 0], corners: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
    { normal: [0, -1, 0], corners: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  faces.forEach((face, faceIndex) => {
    for (const corner of face.corners) {
      positions.push(corner[0], corner[1], corner[2]);
      normals.push(face.normal[0], face.normal[1], face.normal[2]);
    }
    const base = faceIndex * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return { positions, normals, indices };
}

/** The seeded swing.gltf, a text glTF with embedded buffers, generated in code. */
export function generateSwingGltf(): Buffer {
  const box = boxGeometry();
  const parts: Buffer[] = [];
  const views: { byteOffset: number; byteLength: number }[] = [];
  const accessors: Accessor[] = [];
  let offset = 0;

  const pushView = (data: Buffer): number => {
    while (offset % 4 !== 0) {
      parts.push(Buffer.alloc(1));
      offset += 1;
    }
    views.push({ byteOffset: offset, byteLength: data.byteLength });
    parts.push(data);
    offset += data.byteLength;
    return views.length - 1;
  };
  const pushFloats = (values: number[], type: string): number => {
    const data = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => data.writeFloatLE(value, index * 4));
    const view = pushView(data);
    const components = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type] ?? 1;
    accessors.push({ bufferView: view, componentType: 5126, count: values.length / components, type });
    return accessors.length - 1;
  };
  const pushUint16 = (values: number[]): number => {
    const data = Buffer.alloc(values.length * 2);
    values.forEach((value, index) => data.writeUInt16LE(value, index * 2));
    const view = pushView(data);
    accessors.push({ bufferView: view, componentType: 5123, count: values.length, type: 'SCALAR' });
    return accessors.length - 1;
  };

  const positionAccessor = pushFloats(box.positions, 'VEC3');
  const normalAccessor = pushFloats(box.normals, 'VEC3');
  const indexAccessor = pushUint16(box.indices);
  const turnTimes = pushFloats([0, 2], 'SCALAR');
  const half = Math.sin(Math.PI / 4);
  const turnRotation = pushFloats([0, 0, 0, 1, 0, half, 0, half], 'VEC4');
  const turnTranslation = pushFloats([0, 0, 0, 2, 1, 0], 'VEC3');
  const hopTimes = pushFloats([0, 0.5, 1], 'SCALAR');
  const hopTranslation = pushFloats([0, 0, 0, 0, 1, 0, 0, 0, 0], 'VEC3');

  const buffer = Buffer.concat(parts);
  const gltf = {
    asset: { version: '2.0', generator: 'Halation Studio seed' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'Arm', mesh: 0, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      { name: 'Foot', mesh: 1, translation: [0, -1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    ],
    meshes: [
      {
        name: 'ArmBox',
        primitives: [
          {
            attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
            indices: indexAccessor,
            mode: 4,
          },
        ],
      },
      {
        name: 'FootBox',
        primitives: [
          {
            attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
            indices: indexAccessor,
            mode: 4,
          },
        ],
      },
    ],
    animations: [
      {
        name: 'Turn',
        samplers: [
          { input: turnTimes, output: turnRotation, interpolation: 'LINEAR' },
          { input: turnTimes, output: turnTranslation, interpolation: 'LINEAR' },
        ],
        channels: [
          { sampler: 0, target: { node: 0, path: 'rotation' } },
          { sampler: 1, target: { node: 0, path: 'translation' } },
        ],
      },
      {
        name: 'Hop',
        samplers: [{ input: hopTimes, output: hopTranslation, interpolation: 'STEP' }],
        channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }],
      },
    ],
    accessors,
    bufferViews: views.map((view) => ({ buffer: 0, byteOffset: view.byteOffset, byteLength: view.byteLength })),
    buffers: [
      {
        byteLength: buffer.byteLength,
        uri: `data:application/octet-stream;base64,${buffer.toString('base64')}`,
      },
    ],
  };
  return Buffer.from(JSON.stringify(gltf, null, 2), 'utf8');
}
