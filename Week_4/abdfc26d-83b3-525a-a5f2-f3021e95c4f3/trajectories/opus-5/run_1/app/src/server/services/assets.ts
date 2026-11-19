import type { PieceAsset } from '../../shared/api.js';
import { transaction } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { objectKeys, putObject, StorageUnavailable } from '../providers/storage.js';
import type { Principal } from '../auth/identity.js';
import type { UploadBody } from '../http/boundary.js';
import { loadPieceBySlugFor, requireOwnedPiece } from './pieceRows.js';

type AssetKind = 'font' | 'model' | 'audio';

const ALLOWED_EXTENSIONS: Readonly<Record<AssetKind, readonly string[]>> = {
  font: ['.woff2', '.ttf'],
  model: ['.glb'],
  audio: ['.wav', '.mp3'],
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

function isAssetKind(value: string): value is AssetKind {
  return value === 'font' || value === 'model' || value === 'audio';
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

export async function uploadAsset(
  owner: Principal,
  slug: string,
  upload: UploadBody | undefined,
): Promise<PieceAsset> {
  const kindField = upload?.fields.kind ?? '';
  const file = upload?.file ?? null;

  const piece = await transaction(async (client) => {
    const row = requireOwnedPiece(await loadPieceBySlugFor(client, slug, false), owner.id);
    if (row.state !== 'draft') {
      throw ApiError.invalidTransition('Only a draft piece can take new assets.');
    }
    return row;
  });

  if (!isAssetKind(kindField)) {
    throw ApiError.validation({ kind: 'Choose font, model or audio.' });
  }
  if (!file || file.filename === '') {
    throw ApiError.validation({ file: 'Choose a file to upload.' });
  }

  const extension = extensionOf(file.filename);
  if (!ALLOWED_EXTENSIONS[kindField].includes(extension)) {
    throw ApiError.validation({
      file: `A ${kindField} must be ${ALLOWED_EXTENSIONS[kindField].join(' or ')}.`,
    });
  }

  const asset = await transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO piece_assets (piece_id, kind, filename, bytes, object_key)
       VALUES ($1, $2, $3, $4, '')
       RETURNING id`,
      [piece.id, kindField, file.filename, file.bytes.length],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('Asset insert returned no id');
    const key = objectKeys.pieceAsset(piece.slug, id, file.filename);
    await client.query('UPDATE piece_assets SET object_key = $2 WHERE id = $1', [id, key]);
    return { id, kind: kindField, filename: file.filename, bytes: file.bytes.length, key };
  });

  try {
    await putObject(asset.key, file.bytes, CONTENT_TYPES[extension] ?? 'application/octet-stream');
  } catch (error) {
    await transaction((client) =>
      client.query('DELETE FROM piece_assets WHERE id = $1', [asset.id]),
    );
    if (error instanceof StorageUnavailable) throw ApiError.storageUnavailable();
    throw error;
  }

  return { id: asset.id, kind: asset.kind, filename: asset.filename, bytes: asset.bytes };
}
