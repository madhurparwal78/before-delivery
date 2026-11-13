// Seed data: every person, workspace, project and generated file, at
// APP_START_AT.
import type { RouteCtx } from './routes';
import { newId, hashPassword } from './store';
import { randomBytes, createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type {
  SceneDocument,
  Variable,
  Preset,
} from '../domain/kinds';
import { makeLayer, makeScene } from '../domain/props';

interface SeedResult {
  workspaces: Record<string, string>;
  people: Record<string, { id: string; name: string; session: string }>;
  projects: Record<
    string,
    {
      id: string;
      scenes: Record<string, string>;
      layers: Record<string, string>;
      assets: Record<string, string>;
      versions: number[];
    }
  >;
}

function sessionToken(): string {
  return randomBytes(24).toString('hex');
}

// A small grey PNG, 64×64.
function grainPlatePng(): Buffer {
  const w = 64;
  const h = 64;
  const raw = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = 40 + ((x * 7 + y * 13) % 60);
      const i = (y * w + x) * 4;
      raw[i] = v;
      raw[i + 1] = v - 6;
      raw[i + 2] = v + 4;
      raw[i + 3] = 255;
    }
  }
  const deflated = zlibDeflate(raw);
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type, 'ascii');
    const crcInput = Buffer.concat([typeB, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcInput));
    return Buffer.concat([len, typeB, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflated),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let CRC_TABLE: number[] | null = null;
function crc32(buf: Buffer): number {
  if (CRC_TABLE === null) {
    CRC_TABLE = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      CRC_TABLE.push(c);
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) {
    crc = (crc >>> 8) ^ CRC_TABLE![(crc ^ b)! & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zlibDeflate(data: Buffer): Buffer {
  return deflateSync(data);
}

// A text glTF with embedded buffers: nodes Arm and Foot, each a 24-vertex box
// mesh, clips Turn (LINEAR, Arm) and Hop (STEP, Foot).
function swingGltf(): Buffer {
  const box = boxMesh();
  const positions = new Float32Array(box.positions.flat());
  const normals = new Float32Array(box.normals.flat());
  const indices = new Uint16Array(box.indices);
  const posBytes = Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength);
  const normBytes = Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength);
  const idxBytes = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);

  const pad4 = (b: Buffer): Buffer => (b.length % 4 === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]));
  const posP = pad4(posBytes);
  const normP = pad4(normBytes);
  const idxP = pad4(idxBytes);
  const binLen = posP.length + normP.length + idxP.length;
  const meshBuffer = Buffer.concat([posP, normP, idxP]);

  // Turn: rotation 0°→90° about Y and translation (0,0,0)→(2,1,0), both
  // LINEAR over 2 s, on Arm. Hop: STEP translation on Foot.
  const turnTimes = new Float32Array([0, 2]);
  const turnTrans = new Float32Array([0, 0, 0, 2, 1, 0]);
  const half = Math.sin(Math.PI / 4);
  const turnRot = new Float32Array([0, 0, 0, 1, 0, half, 0, half]);
  const hopTimes = new Float32Array([0, 0.5, 1]);
  const hopTrans = new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0]);

  const turnTimesB = pad4(Buffer.from(turnTimes.buffer, turnTimes.byteOffset, turnTimes.byteLength));
  const turnTransB = pad4(Buffer.from(turnTrans.buffer, turnTrans.byteOffset, turnTrans.byteLength));
  const turnRotB = pad4(Buffer.from(turnRot.buffer, turnRot.byteOffset, turnRot.byteLength));
  const hopTimesB = pad4(Buffer.from(hopTimes.buffer, hopTimes.byteOffset, hopTimes.byteLength));
  const hopTransB = pad4(Buffer.from(hopTrans.buffer, hopTrans.byteOffset, hopTrans.byteLength));
  const fullBuffer = Buffer.concat([meshBuffer, turnTimesB, turnTransB, turnRotB, hopTimesB, hopTransB]);

  const b64 = fullBuffer.toString('base64');
  const at = (offset: number): number => binLen + offset;
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'Arm', mesh: 0 },
      { name: 'Foot', mesh: 0 },
    ],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, mode: 4 },
        ],
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: box.vertices, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: box.vertices, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: box.indices.length, type: 'SCALAR' },
      { bufferView: 3, componentType: 5126, count: 2, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: 2, type: 'VEC3' },
      { bufferView: 5, componentType: 5126, count: 2, type: 'VEC4' },
      { bufferView: 6, componentType: 5126, count: 3, type: 'SCALAR' },
      { bufferView: 7, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posP.length },
      { buffer: 0, byteOffset: posP.length, byteLength: normP.length },
      { buffer: 0, byteOffset: posP.length + normP.length, byteLength: idxP.length },
      { buffer: 0, byteOffset: at(0), byteLength: turnTimesB.length },
      { buffer: 0, byteOffset: at(turnTimesB.length), byteLength: turnTransB.length },
      { buffer: 0, byteOffset: at(turnTimesB.length + turnTransB.length), byteLength: turnRotB.length },
      { buffer: 0, byteOffset: at(turnTimesB.length + turnTransB.length + turnRotB.length), byteLength: hopTimesB.length },
      { buffer: 0, byteOffset: at(turnTimesB.length + turnTransB.length + turnRotB.length + hopTimesB.length), byteLength: hopTransB.length },
    ],
    buffers: [{ uri: `data:application/octet-stream;base64,${b64}`, byteLength: fullBuffer.length }],
    animations: [
      {
        name: 'Turn',
        channels: [
          { sampler: 0, target: { node: 0, path: 'rotation' } },
          { sampler: 1, target: { node: 0, path: 'translation' } },
        ],
        samplers: [
          { input: 3, output: 5, interpolation: 'LINEAR' },
          { input: 3, output: 4, interpolation: 'LINEAR' },
        ],
      },
      {
        name: 'Hop',
        channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }],
        samplers: [{ input: 6, output: 7, interpolation: 'STEP' }],
      },
    ],
  };

  return Buffer.from(JSON.stringify(json), 'utf8');
}

function boxMesh(): { vertices: number; positions: number[][]; normals: number[][]; indices: number[] } {
  const h = 0.5;
  const positions: number[][] = [];
  const normals: number[][] = [];
  const indices: number[] = [];
  const faces: [number[], number[]][] = [
    [[1, 0, 0], [h, 0, 0]],
    [[-1, 0, 0], [-h, 0, 0]],
    [[0, 1, 0], [0, h, 0]],
    [[0, -1, 0], [0, -h, 0]],
    [[0, 0, 1], [0, 0, h]],
    [[0, 0, -1], [0, 0, -h]],
  ];
  for (const [n, c] of faces) {
    const base = positions.length;
    const [cx, cy, cz] = c;
    const [nx, ny, nz] = n;
    const tangents =
      Math.abs(ny) > 0.9 ? [1, 0, 0] : Math.abs(nx) > 0.9 ? [0, 1, 0] : [0, 1, 0];
    const [tx, ty, tz] = tangents;
    positions.push(
      [cx - tx * h, cy - ty * h, cz - tz * h],
      [cx + tx * h, cy - ty * h, cz - tz * h],
      [cx + tx * h, cy + ty * h, cz + tz * h],
      [cx - tx * h, cy + ty * h, cz + tz * h],
    );
    for (let i = 0; i < 4; i++) normals.push([nx, ny, nz]);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { vertices: 24, positions, normals, indices };
}

export async function seedAll(ctx: RouteCtx): Promise<SeedResult> {
  const app = ctx.app;
  const limits = app.limits;
  const result: SeedResult = { workspaces: {}, people: {}, projects: {} };
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');

    const wsLumen = newId('ws');
    const wsQuarry = newId('ws');
    // A re-seed on a shared database keeps the stored rows; the seed's ids
    // follow whatever is already there.
    const wsId = async (name: string, fresh: string): Promise<string> => {
      const existing = await client
        .query<{ id: string }>(`SELECT id FROM workspaces WHERE name = $1`, [name])
        .then((r) => r.rows[0]?.id)
        .catch(() => undefined);
      if (existing) return existing;
      await client.query(`INSERT INTO workspaces (id, name) VALUES ($1, $2)`, [fresh, name]);
      return fresh;
    };
    const lumenWsId = await wsId('Lumen Yard', wsLumen);
    const quarryWsId = await wsId('Quarry Hall', wsQuarry);
    result.workspaces['Lumen Yard'] = lumenWsId;
    result.workspaces['Quarry Hall'] = quarryWsId;

    const people: { name: string; email: string; password: string; ws: string }[] = [
      { name: 'Ines Okafor', email: 'ines@lumenyard.test', password: 'halation-ines-01', ws: lumenWsId },
      { name: 'Mara Lindqvist', email: 'mara@lumenyard.test', password: 'halation-mara-01', ws: lumenWsId },
      { name: 'Tomas Reyes', email: 'tomas@lumenyard.test', password: 'halation-tomas-01', ws: lumenWsId },
      { name: 'Pavel Duarte', email: 'pavel@quarryhall.test', password: 'halation-pavel-01', ws: quarryWsId },
    ];
    const ids: Record<string, string> = {};
    const sessions: Record<string, string> = {};
    for (const p of people) {
      // A re-seed on a shared database keeps the existing person rows, so the
      // seed's ids follow the stored records.
      const existing = await client
        .query<{ id: string }>(`SELECT id FROM people WHERE lower(email) = $1`, [p.email])
        .then((r) => r.rows[0]?.id)
        .catch(() => undefined);
      const id = existing ?? newId('per');
      ids[p.email] = id;
      if (!existing) {
        await client.query(
          `INSERT INTO people (id, workspace_id, name, email, password_hash) VALUES ($1, $2, $3, $4, $5)`,
          [id, p.ws, p.name, p.email, hashPassword(p.password)],
        );
      }
      const session = sessionToken();
      sessions[p.email] = session;
      await client.query(
        `INSERT INTO sessions (token, person_id, created_at) VALUES ($1, $2, now())`,
        [session, id],
      );
      result.people[p.email] = { id, name: p.name, session };
    }

    // Assets are generated now and stored per project below.
    const pngBytes = grainPlatePng();
    const gltfBytes = swingGltf();

    const mkProject = async (
      name: string,
      workspaceId: string,
      scenes: { name: string; doc: (id: string) => SceneDocument }[],
      members: { email: string; role: string }[],
      assets: { fileName: string; kind: string; bytes: Buffer; sha: string; contentType: string; width?: number; height?: number; vertices?: number; clips?: unknown }[],
      variables: Variable[] = [],
      presets: Preset[] = [],
      publishV1?: boolean,
      publishBy?: string,
    ): Promise<void> => {
      const projectId = newId('prj');
      const sceneIds: Record<string, string> = {};
      const layerIds: Record<string, string> = {};
      const assetIds: Record<string, string> = {};
      await client.query(
        `INSERT INTO projects (id, workspace_id, name, status, created_at) VALUES ($1, $2, $3, 'active', now())`,
        [projectId, workspaceId, name],
      );
      for (const m of members) {
        await client.query(
          `INSERT INTO members (project_id, person_id, role) VALUES ($1, $2, $3)`,
          [projectId, ids[m.email]!, m.role],
        );
      }
      const bundle: { scenes: SceneDocument[]; variables: Variable[]; presets: Preset[] } = {
        scenes: [],
        variables: structuredClone(variables),
        presets: structuredClone(presets),
      };
      for (let i = 0; i < scenes.length; i++) {
        const sceneId = newId('scn');
        sceneIds[scenes[i]!.name] = sceneId;
        const doc = scenes[i]!.doc(sceneId);
        for (const layer of doc.layers) {
          layerIds[layer.name] = layer.id;
        }
        bundle.scenes.push(doc);
        await client.query(
          `INSERT INTO scenes (id, project_id, name, ord, doc, variables, presets)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
          [
            sceneId,
            projectId,
            scenes[i]!.name,
            i,
            JSON.stringify(doc),
            JSON.stringify(variables),
            JSON.stringify(presets),
          ],
        );
      }
      for (const a of assets) {
        const assetId = newId('ast');
        assetIds[a.fileName] = assetId;
        await ctx.app.s3.putObject(
          `projects/${projectId}/assets/${assetId}/original`,
          a.bytes,
          a.contentType,
        );
        // A model's parsed info (nodes, clips, bounds) is stored with the
        // asset so the evaluator can sample it.
        let parsedJson: string | null = null;
        if (a.kind === 'model') {
          const { buildModelInfo } = await import('../domain/gltf');
          const info = buildModelInfo(new Uint8Array(a.bytes), 2 * 1024 * 1024, 50000);
          parsedJson = info.ok ? JSON.stringify(info.model) : null;
        }
        await client.query(
          `INSERT INTO assets (id, project_id, kind, file_name, bytes, sha256, status, content_type, width, height, vertices, clips, parsed)
           VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $8, $9, $10, $11::jsonb, $12::jsonb)`,
          [
            assetId,
            projectId,
            a.kind,
            a.fileName,
            a.bytes.length,
            a.sha,
            a.contentType,
            a.width ?? null,
            a.height ?? null,
            a.vertices ?? null,
            a.clips ? JSON.stringify(a.clips) : null,
            parsedJson,
          ],
        );
      }
      // Point asset placeholder references at the real asset ids.
      if (assetIds['swing.gltf'] || assetIds['grain-plate.png']) {
        for (const scene of bundle.scenes) {
          for (const layer of scene.layers) {
            if (layer.props.modelAssetId === '__swing__') {
              layer.props.modelAssetId = assetIds['swing.gltf'] ?? null;
            }
            if (layer.props.imageAssetId === '__plate__') {
              layer.props.imageAssetId = assetIds['grain-plate.png'] ?? null;
            }
          }
        }
        for (let i = 0; i < scenes.length; i++) {
          const sceneId = sceneIds[scenes[i]!.name]!;
          const doc = bundle.scenes[i]!;
          await client.query(`UPDATE scenes SET doc = $3 WHERE id = $1 AND project_id = $2`, [
            sceneId,
            projectId,
            JSON.stringify(doc),
          ]);
        }
      }
      const versions: number[] = [];
      if (publishV1) {
        const docBytes = Buffer.from(
          JSON.stringify({
            schemaVersion: 3,
            name,
            variables: bundle.variables,
            presets: bundle.presets,
            scenes: bundle.scenes,
          }),
          'utf8',
        );
        const sha = sha256HexSync(docBytes);
        await ctx.app.s3.putObject(
          `projects/${projectId}/versions/1/scene.json`,
          docBytes,
          'application/json',
        );
        await client.query(
          `INSERT INTO versions (project_id, number, status, published_at, published_by, sha256, bundle, doc)
           VALUES ($1, 1, 'live', now(), $2, $3, $4, $5::jsonb)`,
          [
            projectId,
            publishBy ?? ids['ines@lumenyard.test']!,
            sha,
            docBytes,
            JSON.stringify({
              schemaVersion: 3,
              name,
              variables: bundle.variables,
              presets: bundle.presets,
              scenes: bundle.scenes,
            }),
          ],
        );
        versions.push(1);
      }
      result.projects[name] = {
        id: projectId,
        scenes: sceneIds,
        layers: layerIds,
        assets: assetIds,
        versions,
      };
    };

    const ines = 'ines@lumenyard.test';
    const mara = 'mara@lumenyard.test';
    const tomas = 'tomas@lumenyard.test';

    const pngAsset = {
      fileName: 'grain-plate.png',
      kind: 'image',
      bytes: pngBytes,
      sha: sha256HexSync(pngBytes),
      contentType: 'image/png',
      width: 64,
      height: 64,
    };
    const gltfAsset = {
      fileName: 'swing.gltf',
      kind: 'model',
      bytes: gltfBytes,
      sha: sha256HexSync(gltfBytes),
      contentType: 'model/gltf+json',
      vertices: 24,
      clips: [
        { name: 'Turn', durationS: 2 },
        { name: 'Hop', durationS: 1 },
      ],
    };

    // Lumen hero
    await mkProject(
      'Lumen hero',
      lumenWsId,
      [
        {
          name: 'Main',
          doc: (sceneId) => {
            const doc = makeScene(sceneId, 'Main');
            const halo = makeLayer(newId('lay'), 'Primitive', 'Halo cube', { limits });
            halo.props.primitive = 'Cube';
            halo.props.position = { x: 1, y: 2, z: 0 };
            halo.props.rotation = { x: 0, y: 45, z: 0 };
            halo.props.scale = { x: 2, y: 1, z: 1 };
            halo.props.material = {
              kind: 'Matcap',
              matcap: 'Clay',
              color: '#FFFFFF',
              opacity: 1,
              refraction: 1,
              backFaceRefraction: false,
            };
            halo.events.tilt = { enabled: true, maxTilt: 12, sensitivity: 1, momentum: 1 };
            halo.events.appear = {
              enabled: true,
              durationMs: 600,
              delayMs: 0,
              easing: 'glide',
              from: { 'material.opacity': 0 },
            };
            halo.overrides.tablet['rotation.y'] = 30;
            halo.order = 2;
            const pebble = makeLayer(newId('lay'), 'Model', 'Pebble', { limits });
            pebble.props.preset = 'Pebble';
            pebble.props.position = { x: -2, y: 0, z: 0 };
            pebble.order = 1;
            const swing = makeLayer(newId('lay'), 'Model', 'Swing', { limits });
            swing.props.modelAssetId = '__swing__';
            swing.props.clips = [
              { name: 'Turn', play: true, loop: true, speed: 1, offsetMs: 0 },
              { name: 'Hop', play: false, loop: false, speed: 1, offsetMs: 0 },
            ];
            swing.order = 0;
            const sparks = makeLayer(newId('lay'), 'Particles', 'Sparks', { limits });
            sparks.props.seed = 7;
            sparks.props.rate = 60;
            sparks.props.burst = 0;
            sparks.props.lifetime = 2;
            sparks.props.speed = 2;
            sparks.props.gravity = 9.8;
            sparks.order = 3;
            doc.layers = [swing, pebble, halo, sparks];
            return doc;
          },
        },
      ],
      [
        { email: ines, role: 'Owner' },
        { email: mara, role: 'Editor' },
        { email: tomas, role: 'Viewer' },
      ],
      [gltfAsset],
    );

    // Orbit study
    await mkProject(
      'Orbit study',
      lumenWsId,
      [
        {
          name: 'Main',
          doc: (sceneId) => {
            const doc = makeScene(sceneId, 'Main');
            const probe = makeLayer(newId('lay'), 'Primitive', 'Probe', { limits });
            probe.props.primitive = 'Sphere';
            probe.props.position = { x: 1, y: 2, z: 0 };
            probe.events.tilt = { enabled: true, maxTilt: 12, sensitivity: 1, momentum: 1 };
            probe.order = 1;
            const arch = makeLayer(newId('lay'), 'Model', 'Arch', { limits });
            arch.props.preset = 'Arch';
            arch.props.position = { x: -2, y: 0, z: 0 };
            arch.order = 0;
            doc.orbit = { enabled: true, startAngle: 0, endAngle: 90 };
            doc.light = { enabled: true, sensitivity: 1, momentum: 1 };
            doc.layers = [arch, probe];
            return doc;
          },
        },
      ],
      [
        { email: ines, role: 'Owner' },
        { email: tomas, role: 'Viewer' },
      ],
      [],
    );

    // Logo forge
    const wordmarkId = newId('lay');
    await mkProject(
      'Logo forge',
      lumenWsId,
      [
        {
          name: 'Main',
          doc: (sceneId) => {
            const doc = makeScene(sceneId, 'Main');
            const wordmark = makeLayer(wordmarkId, 'Extrusion', 'Wordmark', { limits });
            wordmark.props.source = 'text';
            wordmark.props.text = 'HALO';
            wordmark.props.letterHeight = 1;
            wordmark.props.depth = 0.2;
            wordmark.props.bevelSize = 0.02;
            wordmark.props.bevelSegments = 1;
            wordmark.order = 0;
            const swarm = makeLayer(newId('lay'), 'Particles', 'Swarm', { limits });
            swarm.props.mode = 'emit';
            swarm.props.seed = 7;
            swarm.props.rate = 30;
            swarm.props.burst = 3;
            swarm.props.lifetime = 0.5;
            swarm.props.speed = 2;
            swarm.props.gravity = 9.8;
            swarm.props.orbit = 90;
            swarm.props.attractor = { x: 0, y: 1, z: 0, strength: 4 };
            swarm.order = 1;
            const drift = makeLayer(newId('lay'), 'Particles', 'Drift', { limits });
            drift.props.mode = 'emit';
            drift.props.seed = 7;
            drift.props.rate = 0;
            drift.props.burst = 3;
            drift.props.lifetime = 2;
            drift.props.speed = 2;
            drift.props.gravity = 9.8;
            drift.props.trailLength = 8;
            drift.order = 2;
            const formation = makeLayer(newId('lay'), 'Particles', 'Formation', { limits });
            formation.props.mode = 'form';
            formation.props.seed = 7;
            formation.props.formation = { target: wordmarkId, count: 32, durationMs: 1500 };
            formation.order = 3;
            doc.layers = [wordmark, swarm, drift, formation];
            return doc;
          },
        },
      ],
      [
        { email: ines, role: 'Owner' },
        { email: mara, role: 'Editor' },
        { email: tomas, role: 'Viewer' },
      ],
      [],
    );

    // Model bay: version 1 live, published by Ines.
    await mkProject(
      'Model bay',
      lumenWsId,
      [
        {
          name: 'Main',
          doc: (sceneId) => {
            const doc = makeScene(sceneId, 'Main');
            const swing = makeLayer(newId('lay'), 'Model', 'Swing', { limits });
            swing.props.modelAssetId = '__swing__';
            swing.props.clips = [
              { name: 'Turn', play: true, loop: false, speed: 1, offsetMs: 0 },
              { name: 'Hop', play: false, loop: false, speed: 1, offsetMs: 0 },
            ];
            swing.order = 1;
            const plate = makeLayer(newId('lay'), 'Image', 'Grain plate', { limits });
            plate.props.imageAssetId = '__plate__';
            plate.order = 0;
            doc.layers = [plate, swing];
            return doc;
          },
        },
      ],
      [
        { email: ines, role: 'Owner' },
        { email: mara, role: 'Editor' },
        { email: tomas, role: 'Viewer' },
      ],
      [pngAsset, gltfAsset],
      [],
      [],
      true,
      ids[ines]!,
    );

    // Banner test
    await mkProject(
      'Banner test',
      lumenWsId,
      [
        {
          name: 'Main',
          doc: (sceneId) => {
            const doc = makeScene(sceneId, 'Main');
            const banner = makeLayer(newId('lay'), 'Cloth', 'Banner', { limits });
            banner.props.columns = 4;
            banner.props.rows = 4;
            banner.props.clothSeed = 3;
            banner.props.pinned = 'Top';
            banner.props.windStrength = 2;
            banner.props.windDirection = 0;
            banner.order = 0;
            doc.layers = [banner];
            return doc;
          },
        },
      ],
      [
        { email: ines, role: 'Owner' },
        { email: mara, role: 'Editor' },
        { email: tomas, role: 'Viewer' },
      ],
      [],
    );

    // Easing lab
    await mkProject(
      'Easing lab',
      lumenWsId,
      [
        {
          name: 'Main',
          doc: (sceneId) => {
            const doc = makeScene(sceneId, 'Main');
            const turner = makeLayer(newId('lay'), 'Primitive', 'Turner', { limits });
            turner.keyframes = [
              { property: 'rotation.y', frame: 0, value: 0, easing: 'ease-out' },
              { property: 'rotation.y', frame: 60, value: 90, easing: 'linear' },
            ];
            turner.order = 0;
            const blank = makeLayer(newId('lay'), 'Primitive', 'Blank', { limits });
            blank.order = 1;
            doc.layers = [turner, blank];
            return doc;
          },
        },
      ],
      [
        { email: ines, role: 'Owner' },
        { email: mara, role: 'Editor' },
        { email: tomas, role: 'Viewer' },
      ],
      [],
    );

    // Variable room
    await mkProject(
      'Variable room',
      lumenWsId,
      [
        {
          name: 'Main',
          doc: (sceneId) => {
            const doc = makeScene(sceneId, 'Main');
            const spinner = makeLayer(newId('lay'), 'Primitive', 'Spinner', { limits });
            spinner.order = 0;
            doc.layers = [spinner];
            return doc;
          },
        },
      ],
      [
        { email: ines, role: 'Owner' },
        { email: mara, role: 'Editor' },
        { email: tomas, role: 'Viewer' },
      ],
      [],
      [
        { name: 'spin', type: 'Vector 3', value: { x: 0, y: 45, z: 0 } },
        { name: 'boost', type: 'Number', value: 150 },
        { name: 'tint', type: 'Colour', value: '#B7A4FF' },
      ],
      [
        { name: 'Calm', values: { spin: { x: 0, y: 0, z: 0 } } },
        {
          name: 'Lively',
          values: { spin: { x: 0, y: 90, z: 15 }, boost: 2 },
        },
      ],
    );

    // Backdrop: three scenes.
    await mkProject(
      'Backdrop',
      lumenWsId,
      [
        {
          name: 'Blend',
          doc: (sceneId) => {
            const doc = makeScene(sceneId, 'Blend');
            doc.background = '#336699';
            const veil = makeLayer(newId('lay'), 'Rectangle', 'Veil', { limits });
            veil.props.x = 0;
            veil.props.y = 0;
            veil.props.width = 720;
            veil.props.height = 810;
            veil.props.opacity = 50;
            veil.props.fill = '#FFFFFF';
            veil.visible = false;
            veil.maskAbove = false;
            veil.order = 0;
            const wash = makeLayer(newId('lay'), 'Rectangle', 'Wash', { limits });
            wash.props.x = 0;
            wash.props.y = 0;
            wash.props.width = 1440;
            wash.props.height = 810;
            wash.props.opacity = 60;
            wash.props.fill = '#CC8844';
            wash.blendMode = 'Normal';
            wash.order = 1;
            doc.layers = [veil, wash];
            return doc;
          },
        },
        {
          name: 'Ramp',
          doc: (sceneId) => {
            const doc = makeScene(sceneId, 'Ramp');
            doc.background = '#000000';
            const spectrum = makeLayer(newId('lay'), 'Gradient', 'Spectrum', { limits });
            spectrum.props.x = 0;
            spectrum.props.y = 0;
            spectrum.props.width = 1440;
            spectrum.props.height = 810;
            spectrum.props.opacity = 100;
            spectrum.props.gradient = {
              type: 'Linear',
              angle: 0,
              centerX: 50,
              centerY: 50,
              radius: 100,
              stops: [
                { color: '#FF0000', position: 0 },
                { color: '#FFFF00', position: 40 },
                { color: '#0000FF', position: 100 },
              ],
            };
            spectrum.order = 0;
            doc.layers = [spectrum];
            return doc;
          },
        },
        {
          name: 'Grain',
          doc: (sceneId) => {
            const doc = makeScene(sceneId, 'Grain');
            doc.background = '#336699';
            const grain = makeLayer(newId('lay'), 'Effect', 'Grain', { limits });
            grain.props.effect = { kind: 'Grain', enabled: true, grainAmount: 0.15, grainSeed: 7 };
            grain.order = 0;
            doc.layers = [grain];
            return doc;
          },
        },
      ],
      [
        { email: ines, role: 'Owner' },
        { email: mara, role: 'Editor' },
        { email: tomas, role: 'Viewer' },
      ],
      [],
    );

    // Phone kit: bottom to top Base, Glow, Spark, Caption.
    await mkProject(
      'Phone kit',
      lumenWsId,
      [
        {
          name: 'Main',
          doc: (sceneId) => {
            const doc = makeScene(sceneId, 'Main');
            const base = makeLayer(newId('lay'), 'Rectangle', 'Base', { limits });
            base.order = 0;
            const glow = makeLayer(newId('lay'), 'Ellipse', 'Glow', { limits });
            glow.order = 1;
            const spark = makeLayer(newId('lay'), 'Polygon', 'Spark', { limits });
            spark.order = 2;
            const caption = makeLayer(newId('lay'), 'Text', 'Caption', { limits });
            caption.props.text = 'Ship it';
            caption.order = 3;
            doc.layers = [base, glow, spark, caption];
            return doc;
          },
        },
      ],
      [
        { email: ines, role: 'Owner' },
        { email: mara, role: 'Editor' },
        { email: tomas, role: 'Viewer' },
      ],
      [],
    );

    // Quarry teaser in Quarry Hall (Pavel's workspace).
    await mkProject(
      'Quarry teaser',
      quarryWsId,
      [
        {
          name: 'Main',
          doc: (sceneId) => {
            const doc = makeScene(sceneId, 'Main');
            const slab = makeLayer(newId('lay'), 'Primitive', 'Slab', { limits });
            slab.order = 0;
            doc.layers = [slab];
            return doc;
          },
        },
      ],
      [{ email: 'pavel@quarryhall.test', role: 'Owner' }],
      [],
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    client.release();
    throw e;
  }
  client.release();
  return result;
}

function sha256HexSync(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export { makeLayer, makeScene };
