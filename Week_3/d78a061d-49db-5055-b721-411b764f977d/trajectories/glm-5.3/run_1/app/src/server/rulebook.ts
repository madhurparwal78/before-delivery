import {
  humanoidBones, allowedExtensions, rulebookVersion, validatorVersion,
  roundHalfUpSigned, type Locale,
} from '../shared/domain.js';
import { tr } from '../shared/i18n.js';

export type RuleStatus = 'pass' | 'fail' | 'skipped';
export type RuleId = 'R01' | 'R02' | 'R03' | 'R04' | 'R05' | 'R06' | 'R07' | 'R08' | 'R09' | 'R10';
export const ruleIds: RuleId[] = ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10'];

export type RuleResult = {
  id: RuleId;
  status: RuleStatus;
  measured: number | string | [number, number, number, number] | null;
  limit: number | null;
};

export type Report = {
  rulebook_version: string;
  failed_count: number;
  rules: RuleResult[];
};

export type GlTfJson = {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: {
    name?: string;
    mesh?: number;
    skin?: number;
    rotation?: [number, number, number, number];
    matrix?: number[];
    children?: number[];
  }[];
  meshes?: { primitives: { mode?: number; indices?: number; attributes?: { POSITION?: number } }[] }[];
  accessors?: { count: number }[];
  skins?: { joints: number[] }[];
  materials?: unknown[];
  images?: { uri?: string }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
};

/** R04's triangle count, decided in this one function (DP-66). */
export function countTriangles(gltf: GlTfJson): number {
  const sceneIndex = gltf.scene ?? 0;
  const scene = gltf.scenes?.[sceneIndex];
  if (!scene) return 0;
  const nodes = gltf.nodes ?? [];
  const meshes = gltf.meshes ?? [];
  const accessors = gltf.accessors ?? [];
  let total = 0;
  const visit = (nodeIndex: number, seen: Set<number>) => {
    if (seen.has(nodeIndex)) return;
    seen.add(nodeIndex);
    const node = nodes[nodeIndex];
    if (!node) return;
    if (node.mesh !== undefined) {
      const mesh = meshes[node.mesh];
      if (mesh) {
        for (const primitive of mesh.primitives) {
          let count = 0;
          if (primitive.indices !== undefined) count = accessors[primitive.indices]?.count ?? 0;
          else if (primitive.attributes?.POSITION !== undefined) count = accessors[primitive.attributes.POSITION]?.count ?? 0;
          const mode = primitive.mode ?? 4;
          if (mode === 4) total += Math.floor(count / 3);
          else if (mode === 5 || mode === 6) total += Math.max(0, count - 2);
          // points, lines and every other mode draw no triangles
        }
      }
    }
    for (const child of node.children ?? []) visit(child, seen);
  };
  const seen = new Set<number>();
  for (const root of scene.nodes ?? []) visit(root, seen);
  return total;
}

function parseGlb(buf: Buffer): { json: GlTfJson; ok: boolean } {
  if (buf.length < 20) return { json: {}, ok: false };
  const magic = buf.subarray(0, 4).toString('ascii');
  if (magic !== 'glTF') return { json: {}, ok: false };
  const version = buf.readUInt32LE(4);
  const length = buf.readUInt32LE(8);
  if (version !== 2 || length !== buf.length) return { json: {}, ok: false };
  const chunkLength = buf.readUInt32LE(12);
  const chunkType = buf.subarray(16, 20).toString('ascii');
  if (chunkType !== 'JSON') return { json: {}, ok: false };
  try {
    const jsonText = buf.subarray(20, 20 + chunkLength).toString('utf8');
    return { json: JSON.parse(jsonText) as GlTfJson, ok: true };
  } catch {
    return { json: {}, ok: false };
  }
}

async function runValidator(buf: Buffer): Promise<{ errors: number; ok: boolean }> {
  try {
    const validator = (await import('gltf-validator')) as unknown as {
      validateBytes: (data: Uint8Array, options?: Record<string, unknown>) => Promise<{ issues: { numErrors: number } }>;
    };
    const result = await validator.validateBytes(new Uint8Array(buf), { maxIssues: 100000 });
    return { errors: result.issues.numErrors, ok: true };
  } catch {
    // Bytes the validator cannot even read are counted as errors, matching its own report.
    return { errors: 1, ok: false };
  }
}

export async function judgeModel(buf: Buffer): Promise<Report> {
  const results: RuleResult[] = [];
  const push = (id: RuleId, status: RuleStatus, measured: RuleResult['measured'], limit: number | null) => {
    results.push({ id, status, measured, limit });
  };
  let failed = false;
  const fail = (id: RuleId, measured: RuleResult['measured'], limit: number | null) => {
    push(id, 'fail', measured, limit);
    failed = true;
  };
  const skipFrom = (id: RuleId) => push(id, 'skipped', null, null);
  const pass = (id: RuleId, measured: RuleResult['measured'], limit: number | null) => push(id, 'pass', measured, limit);

  // R01
  const parsed = parseGlb(buf);
  if (!parsed.ok) {
    fail('R01', null, null);
    for (const id of ruleIds.slice(1)) skipFrom(id);
    return report(results);
  }
  pass('R01', null, null);
  const gltf = parsed.json;

  // R02
  const validation = await runValidator(buf);
  if (!validation.ok || validation.errors > 0) {
    fail('R02', validation.errors, 0);
    for (const id of ruleIds.slice(2)) skipFrom(id);
    return report(results);
  }
  pass('R02', validation.errors, 0);

  // R03
  const used = [...(gltf.extensionsUsed ?? []), ...(gltf.extensionsRequired ?? [])];
  const badExtensions = [...new Set(used.filter((e) => !allowedExtensions.includes(e)))];
  if (badExtensions.length > 0) fail('R03', badExtensions.length, 0);
  else pass('R03', badExtensions.length, 0);

  // R04
  const triangles = countTriangles(gltf);
  if (triangles > 20000) fail('R04', triangles, 20000);
  else pass('R04', triangles, 20000);

  // R05
  const skins = gltf.skins ?? [];
  let r05Failed = false;
  if (skins.length !== 1) {
    fail('R05', skins.length, 1);
    r05Failed = true;
  } else {
    const joints = skins[0]?.joints.length ?? 0;
    if (joints > 64) {
      fail('R05', joints, 64);
      r05Failed = true;
    } else pass('R05', joints, 64);
  }

  // R06
  if (r05Failed) {
    skipFrom('R06');
  } else {
    const joints = skins[0]?.joints ?? [];
    const names = joints
      .map((i) => gltf.nodes?.[i]?.name)
      .filter((n): n is string => typeof n === 'string');
    const present = new Set(names);
    const missing = humanoidBones.filter((b) => !present.has(b));
    if (missing.length > 0) fail('R06', missing.join(', '), null);
    else pass('R06', '', null);
  }

  // R07
  const materials = gltf.materials ?? [];
  if (materials.length > 8) fail('R07', materials.length, 8);
  else pass('R07', materials.length, 8);

  // R08
  const images = gltf.images ?? [];
  const notEmbedded = images.filter((img) => typeof img.uri === 'string' && img.uri !== '').length;
  if (notEmbedded > 0) fail('R08', notEmbedded, 0);
  else pass('R08', notEmbedded, 0);

  // R09
  if (notEmbedded > 0) {
    skipFrom('R09');
  } else {
    const largest = await largestImageSize(buf);
    if (largest > 2048) fail('R09', largest, 2048);
    else pass('R09', largest, 2048);
  }

  // R10 (skipped when R01, R02, R05 or R06 failed)
  const r06 = results.find((r) => r.id === 'R06');
  if (r05Failed || (r06 && r06.status === 'fail')) {
    skipFrom('R10');
  } else {
    const hips = (gltf.skins ?? [])[0]?.joints
      .map((i) => gltf.nodes?.[i])
      .find((n) => n?.name === 'hips');
    if (!hips) {
      skipFrom('R10');
    } else if (hips.matrix) {
      fail('R10', null, null);
    } else {
      const rotation = hips.rotation ?? [0, 0, 0, 1];
      const measured: [number, number, number, number] = [
        roundHalfUpSigned(rotation[0] ?? 0, 4),
        roundHalfUpSigned(rotation[1] ?? 0, 4),
        roundHalfUpSigned(rotation[2] ?? 0, 4),
        roundHalfUpSigned(rotation[3] ?? 1, 4),
      ];
      if (Math.abs(measured[3]) < 0.9999) fail('R10', measured, null);
      else pass('R10', measured, null);
    }
  }

  return report(results);
}

function report(results: RuleResult[]): Report {
  const failedCount = results.filter((r) => r.status === 'fail').length;
  return { rulebook_version: rulebookVersion, failed_count: failedCount, rules: results };
}

async function largestImageSize(buf: Buffer): Promise<number> {
  // Only embedded images count; parse PNG/JPEG dimensions from the binary chunk.
  const glb = buf;
  let offset = 12;
  let largest = 0;
  while (offset + 8 <= glb.length) {
    const chunkLength = glb.readUInt32LE(offset);
    const chunkType = glb.subarray(offset + 4, offset + 8).toString('ascii');
    if (chunkType === 'BIN') {
      const data = glb.subarray(offset + 8, offset + 8 + chunkLength);
      let pos = 0;
      while (pos < data.length) {
        if (data.subarray(pos, pos + 8).toString('hex') === '89504e470d0a1a0a') {
          const w = data.readUInt32BE(pos + 16);
          const h = data.readUInt32BE(pos + 20);
          largest = Math.max(largest, w, h);
          const chunkLen = data.readUInt32BE(pos + 8);
          pos += chunkLen + 12;
        } else if (data.subarray(pos, pos + 3).toString('hex') === 'ffd8ff') {
          let p = pos + 2;
          while (p + 9 < data.length) {
            if (data[p] !== 0xff) { p++; continue; }
            const marker = data[p + 1] ?? 0;
            const len = data.readUInt16BE(p + 2);
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
              const h = data.readUInt16BE(p + 5);
              const w = data.readUInt16BE(p + 7);
              largest = Math.max(largest, w, h);
              break;
            }
            p += 2 + len;
          }
          break;
        } else {
          break;
        }
      }
    }
    offset += 8 + chunkLength;
    if (chunkLength === 0) break;
  }
  return largest;
}

export function ruleTitle(id: string, locale: Locale): string {
  return tr(locale, 'rules', id);
}

export const ruleLimits: Record<string, number | null> = {
  R01: null, R02: 0, R03: 0, R04: 20000, R05: 64, R06: null, R07: 8, R08: 0, R09: 2048, R10: null,
};

export const validatorName = validatorVersion;
