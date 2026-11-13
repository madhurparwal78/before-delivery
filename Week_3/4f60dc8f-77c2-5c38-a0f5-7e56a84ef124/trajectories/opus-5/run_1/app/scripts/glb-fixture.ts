export type GlbSpec = {
  min: [number, number, number];
  max: [number, number, number];
  componentType?: number;
  normalized?: boolean;
  nodeScale?: [number, number, number];
  nodeRotation?: [number, number, number, number];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  omitScenes?: boolean;
  breakAccessorIndex?: boolean;
};

export const buildGlb = (spec: GlbSpec): Buffer => {
  const document: Record<string, unknown> = {
    asset: { version: '2.0' },
    ...(spec.extensionsUsed ? { extensionsUsed: spec.extensionsUsed } : {}),
    ...(spec.extensionsRequired ? { extensionsRequired: spec.extensionsRequired } : {}),
    ...(spec.omitScenes === true ? {} : { scene: 0, scenes: [{ nodes: [0] }] }),
    nodes: [
      {
        mesh: 0,
        ...(spec.nodeScale ? { scale: spec.nodeScale } : {}),
        ...(spec.nodeRotation ? { rotation: spec.nodeRotation } : {}),
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: spec.breakAccessorIndex === true ? 9 : 0 } }] }],
    accessors: [
      {
        componentType: spec.componentType ?? 5126,
        ...(spec.normalized === true ? { normalized: true } : {}),
        count: 8,
        type: 'VEC3',
        min: spec.min,
        max: spec.max,
      },
    ],
  };

  let json = Buffer.from(JSON.stringify(document), 'utf8');
  while (json.length % 4 !== 0) json = Buffer.concat([json, Buffer.from(' ', 'utf8')]);

  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length, 8);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(json.length, 0);
  chunkHeader.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([header, chunkHeader, json]);
};

export const buildPdf = (): Buffer =>
  Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'ascii');

export const buildPng = (): Buffer => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrBody = Buffer.alloc(13);
  ihdrBody.writeUInt32BE(1, 0);
  ihdrBody.writeUInt32BE(1, 4);
  ihdrBody[8] = 8;
  ihdrBody[9] = 0;
  const chunk = (type: string, body: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length, 0);
    return Buffer.concat([length, Buffer.from(type, 'ascii'), body, Buffer.alloc(4)]);
  };
  return Buffer.concat([signature, chunk('IHDR', ihdrBody), chunk('IEND', Buffer.alloc(0))]);
};
