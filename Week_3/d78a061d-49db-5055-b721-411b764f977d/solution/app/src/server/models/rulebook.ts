import { validateBytes } from 'gltf-validator';
import { RULEBOOK_VERSION } from '../../shared/constants.js';
import { roundHalfAway } from '../../shared/pose.js';
import type { Measured, Report, RuleId, RuleResult, RuleStatus } from '../../shared/types.js';
import { readGlb, type GltfJson } from './glb.js';
import { countSceneTriangles } from './triangles.js';
import { imageSize } from './imagesize.js';

const ALLOWED_EXTENSIONS = [
  'KHR_materials_unlit',
  'KHR_texture_transform',
  'KHR_materials_emissive_strength',
] as const;

const REQUIRED_BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
] as const;

export const RULE_LIMITS: Record<RuleId, number | null> = {
  R01: null,
  R02: 0,
  R03: 0,
  R04: 20000,
  R05: 64,
  R06: null,
  R07: 8,
  R08: 0,
  R09: 2048,
  R10: null,
};

const RULE_IDS: readonly RuleId[] = ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10'];

interface Judged {
  status: RuleStatus;
  measured: Measured;
  limit: number | null;
}

const skipped: Judged = { status: 'skipped', measured: null, limit: null };

async function countValidatorErrors(bytes: Buffer): Promise<number> {
  try {
    const report = await validateBytes(new Uint8Array(bytes));
    return report.issues.numErrors;
  } catch {
    return 1;
  }
}

function judgeExtensions(json: GltfJson): Judged {
  const names = new Set<string>([...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])]);
  let outside = 0;
  for (const name of names) {
    if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(name)) outside += 1;
  }
  return { status: outside > 0 ? 'fail' : 'pass', measured: outside, limit: 0 };
}

function judgeSkin(json: GltfJson): Judged {
  const skins = json.skins ?? [];
  if (skins.length !== 1) {
    return { status: 'fail', measured: skins.length, limit: 1 };
  }
  const joints = skins[0].joints ?? [];
  return { status: joints.length > 64 ? 'fail' : 'pass', measured: joints.length, limit: 64 };
}

function jointNames(json: GltfJson): Map<string, number> {
  const nodes = json.nodes ?? [];
  const joints = json.skins?.[0]?.joints ?? [];
  const byName = new Map<string, number>();
  for (const jointIndex of joints) {
    const name = nodes[jointIndex]?.name;
    if (typeof name === 'string' && !byName.has(name)) byName.set(name, jointIndex);
  }
  return byName;
}

function judgeBones(json: GltfJson): Judged {
  const names = jointNames(json);
  const missing = REQUIRED_BONES.filter((bone) => !names.has(bone));
  return {
    status: missing.length > 0 ? 'fail' : 'pass',
    measured: missing.join(', '),
    limit: null,
  };
}

function judgeImagesEmbedded(json: GltfJson): Judged {
  const images = json.images ?? [];
  const notEmbedded = images.filter((image) => typeof image.uri === 'string').length;
  return { status: notEmbedded > 0 ? 'fail' : 'pass', measured: notEmbedded, limit: 0 };
}

function judgeImageSize(json: GltfJson, bin: Buffer | null): Judged {
  const images = json.images ?? [];
  const bufferViews = json.bufferViews ?? [];
  let largest = 0;
  for (const image of images) {
    if (image.bufferView === undefined || bin === null) continue;
    const view = bufferViews[image.bufferView];
    if (view === undefined) continue;
    const start = view.byteOffset ?? 0;
    const end = start + (view.byteLength ?? 0);
    const size = imageSize(bin.subarray(start, end));
    if (size === null) continue;
    largest = Math.max(largest, size.width, size.height);
  }
  return { status: largest > 2048 ? 'fail' : 'pass', measured: largest, limit: 2048 };
}

function judgeHips(json: GltfJson): Judged {
  const nodes = json.nodes ?? [];
  const hipsIndex = jointNames(json).get('hips');
  const hips = hipsIndex === undefined ? undefined : nodes[hipsIndex];
  if (hips === undefined || Array.isArray(hips.matrix)) {
    return { status: 'fail', measured: null, limit: null };
  }
  const rotation = Array.isArray(hips.rotation) ? hips.rotation : [0, 0, 0, 1];
  const measured: [number, number, number, number] = [
    roundHalfAway(rotation[0] ?? 0, 4),
    roundHalfAway(rotation[1] ?? 0, 4),
    roundHalfAway(rotation[2] ?? 0, 4),
    roundHalfAway(rotation[3] ?? 0, 4),
  ];
  return {
    status: Math.abs(measured[3]) < 0.9999 ? 'fail' : 'pass',
    measured,
    limit: null,
  };
}

/** Judges one upload against rulebook 2026.11-r1 in rule order. */
export async function judgeUpload(bytes: Buffer): Promise<Report> {
  const glb = readGlb(bytes);
  const results = new Map<RuleId, Judged>();

  results.set('R01', {
    status: glb.headerValid ? 'pass' : 'fail',
    measured: null,
    limit: null,
  });

  if (!glb.headerValid) {
    for (const id of RULE_IDS.slice(1)) results.set(id, skipped);
    return toReport(results);
  }

  const validatorErrors = await countValidatorErrors(bytes);
  results.set('R02', {
    status: validatorErrors > 0 ? 'fail' : 'pass',
    measured: validatorErrors,
    limit: 0,
  });

  if (validatorErrors > 0) {
    for (const id of RULE_IDS.slice(2)) results.set(id, skipped);
    return toReport(results);
  }

  const json = glb.json ?? {};
  results.set('R03', judgeExtensions(json));
  results.set('R04', {
    status: countSceneTriangles(json) > 20000 ? 'fail' : 'pass',
    measured: countSceneTriangles(json),
    limit: 20000,
  });

  const skin = judgeSkin(json);
  results.set('R05', skin);
  results.set('R06', skin.status === 'fail' ? skipped : judgeBones(json));

  const materials = (json.materials ?? []).length;
  results.set('R07', {
    status: materials > 8 ? 'fail' : 'pass',
    measured: materials,
    limit: 8,
  });

  const embedded = judgeImagesEmbedded(json);
  results.set('R08', embedded);
  results.set('R09', embedded.status === 'fail' ? skipped : judgeImageSize(json, glb.bin));

  const bones = results.get('R06');
  const hipsSkipped = skin.status === 'fail' || bones === undefined || bones.status !== 'pass';
  results.set('R10', hipsSkipped ? skipped : judgeHips(json));

  return toReport(results);
}

function toReport(results: Map<RuleId, Judged>): Report {
  const rules: RuleResult[] = RULE_IDS.map((id) => {
    const judged = results.get(id) ?? skipped;
    return { id, status: judged.status, measured: judged.measured, limit: judged.limit };
  });
  return {
    rulebook_version: RULEBOOK_VERSION,
    failed_count: rules.filter((rule) => rule.status === 'fail').length,
    rules,
  };
}
