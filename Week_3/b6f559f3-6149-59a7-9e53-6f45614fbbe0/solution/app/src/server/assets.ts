/** Uploads: validate, keep the original bytes in storage, confirm by reading the object back, then record the asset. */
import { createHash } from 'node:crypto';
import { imageDimensions, imageTooLarge, fileTooLarge, MESSAGES } from '../shared/messages';
import { parseModel } from '../shared/gltf';
import { parseSvgOutline } from '../shared/geometry';
import type { AssetInfo, ModelSummary, OutlinePoint } from '../shared/types';
import { assertActive, findProject, openProject, refuseTrashed, requireEditor } from './access';
import { now } from './clock';
import { config } from './config';
import { query, transaction } from './db';
import { assetOf } from './documents';
import { ASSET_HEADERS, invalid, json, newId, notFound, router, storageDown, type Ctx, type Reply } from './http';
import { assetKey, StorageUnavailable } from './s3';
import { storage } from './services';

type UploadKind = AssetInfo['kind'];
const UPLOAD_KINDS: readonly UploadKind[] = ['image', 'svg', 'model'];
const isUploadKind = (value: string | undefined): value is UploadKind => UPLOAD_KINDS.some((kind) => kind === value);

interface UploadInput {
  projectId: string;
  kind: UploadKind;
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

type UploadResult = { asset: AssetInfo } | { refusal: string } | { unavailable: true };

interface Parsed {
  width: number | null;
  height: number | null;
  vertices: number | null;
  clips: { name: string; durationS: number }[];
  model: ModelSummary | null;
  outline: OutlinePoint[] | null;
}

type Checked = { parsed: Parsed } | { refusal: string };

const NONE: Parsed = { width: null, height: null, vertices: null, clips: [], model: null, outline: null };

/** Width and height from the header of a PNG, JPEG or WebP, or null when the bytes are none of them. */
function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1] as number;
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      const length = bytes.readUInt16BE(at + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
      at += 2 + length;
    }
    return null;
  }
  if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  return null;
}

function check(kind: UploadKind, bytes: Buffer): Checked {
  if (kind === 'image') {
    const size = imageSize(bytes);
    if (!size) return { refusal: MESSAGES.notAnImage };
    if (bytes.length > config.imageMaxBytes) return { refusal: imageTooLarge(bytes.length, config.imageMaxBytes) };
    if (size.width > config.imageMaxDimension || size.height > config.imageMaxDimension) {
      return { refusal: imageDimensions(size.width, size.height, config.imageMaxDimension) };
    }
    return { parsed: { ...NONE, width: size.width, height: size.height } };
  }
  if (kind === 'svg') {
    const result = parseSvgOutline(bytes.toString('utf8'));
    return 'error' in result ? { refusal: result.error } : { parsed: { ...NONE, outline: result.outline } };
  }
  if (bytes.length > config.modelMaxBytes) return { refusal: fileTooLarge(bytes.length, config.modelMaxBytes) };
  const result = parseModel(bytes, config.modelMaxVertices);
  if ('error' in result) return { refusal: result.error };
  const { summary } = result.model;
  return {
    parsed: {
      ...NONE,
      vertices: summary.vertices,
      clips: summary.clips.map((clip) => ({ name: clip.name, durationS: clip.durationS })),
      model: summary,
    },
  };
}

/**
 * Validates an upload, then keeps it: the asset row is written pending inside a transaction that only commits once
 * storage has confirmed the object, so nothing is visible to the project before that.
 */
export async function uploadAsset(input: UploadInput): Promise<UploadResult> {
  const checked = check(input.kind, input.bytes);
  if ('refusal' in checked) return checked;
  const { parsed } = checked;
  const id = newId('a');
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const key = assetKey(input.projectId, id);
  try {
    return await transaction(async (client) => {
      await client.query(
        `INSERT INTO assets (id, project_id, kind, file_name, content_type, bytes, sha256, status, width, height, vertices, clips, model, outline, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11, $12, $13, $14)`,
        [
          id,
          input.projectId,
          input.kind,
          input.fileName,
          input.contentType,
          input.bytes.length,
          sha256,
          parsed.width,
          parsed.height,
          parsed.vertices,
          JSON.stringify(parsed.clips),
          parsed.model ? JSON.stringify(parsed.model) : null,
          parsed.outline ? JSON.stringify(parsed.outline) : null,
          (await now(client)).toISOString(),
        ],
      );
      let status: AssetInfo['status'] = 'confirmed';
      try {
        await storage.put(key, input.bytes, input.contentType);
        const head = await storage.head(key);
        if (!head || head.size !== input.bytes.length) status = 'failed';
      } catch (error) {
        if (!(error instanceof StorageUnavailable)) throw error;
        status = 'failed';
      }
      if (status === 'confirmed') await assertActive(client, input.projectId);
      await client.query('UPDATE assets SET status = $2 WHERE id = $1', [id, status]);
      if (status === 'failed') return { unavailable: true as const };
      const rows = await client.query(
        `SELECT id, kind, file_name, bytes, sha256, status, width, height, vertices, clips, model, outline FROM assets WHERE id = $1`,
        [id],
      );
      return { asset: assetOf(rows.rows[0]) };
    });
  } catch (error) {
    if (error instanceof StorageUnavailable) return { unavailable: true };
    throw error;
  }
}

async function postAsset(ctx: Ctx): Promise<Reply> {
  const { project } = await openProject(ctx, ctx.param('id'));
  requireEditor(project);
  refuseTrashed(project.status);
  const form = await ctx.multipart();
  const kind = form.fields['kind'];
  if (!isUploadKind(kind)) invalid('kind', MESSAGES.invalidValue);
  const file = form.files['file'];
  if (!file) invalid('file', MESSAGES.invalidValue);
  const result = await uploadAsset({ projectId: project.id, kind, fileName: file.fileName, contentType: file.contentType, bytes: file.bytes });
  if ('refusal' in result) return invalid('file', result.refusal);
  if ('unavailable' in result) return storageDown(MESSAGES.storageUploads);
  return json(201, { asset: result.asset });
}

async function getOriginal(ctx: Ctx): Promise<Reply> {
  const person = await ctx.requirePerson();
  const rows = await query<{ project_id: string; content_type: string; status: string }>(
    'SELECT project_id, content_type, status FROM assets WHERE id = $1',
    [ctx.param('assetId')],
  );
  const asset = rows[0];
  if (!asset || asset.status !== 'confirmed' || !(await findProject(person.id, asset.project_id))) return notFound();
  let bytes: Buffer | null;
  try {
    bytes = await storage.get(assetKey(asset.project_id, ctx.param('assetId')));
  } catch (error) {
    if (error instanceof StorageUnavailable) return storageDown(MESSAGES.storageUploads);
    throw error;
  }
  if (!bytes) return notFound();
  return { status: 200, raw: bytes, contentType: asset.content_type, headers: ASSET_HEADERS };
}

export function registerAssetRoutes(): void {
  router.post('/api/projects/:id/assets', postAsset);
  router.get('/api/assets/:assetId/original', getOriginal);
}
