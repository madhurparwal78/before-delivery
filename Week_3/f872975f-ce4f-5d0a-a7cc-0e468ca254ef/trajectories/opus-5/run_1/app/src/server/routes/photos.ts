import { MAX_PHOTOS_PER_BOARD } from '../../shared/constants';
import { pool, query, rows, transaction } from '../db/pool';
import { isPubliclyVisible, isRetired, loadBoard, photoShape } from '../domain/boards';
import { ApiError } from '../errors';
import { Reply, RequestContext, STAFF, headerOf, jsonReply, pathParam, requireRole } from '../http';
import { PhotoType, extensionFor, hasDeclaredSignature, preparePhoto } from '../services/image';
import { deleteObject, getObject, putObject } from '../services/s3';
import { Route, route } from './types';

interface PhotoRecord {
  id: string;
  board_tag: string;
  content_type: string;
  original_key: string;
  display_key: string;
  thumb_key: string;
}

function declaredPhotoType(context: RequestContext): PhotoType {
  const raw = (headerOf(context, 'content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (raw === 'image/jpeg' || raw === 'image/png') return raw;
  throw new ApiError('unsupported_media_type');
}

async function uploadPhoto(context: RequestContext): Promise<Reply> {
  requireRole(context, STAFF);
  const tag = pathParam(context, 'tag');
  const board = await loadBoard(pool, tag);
  if (board === null) throw new ApiError('not_found');
  if (isRetired(board.status)) throw new ApiError('board_state');

  const type = declaredPhotoType(context);
  if (!hasDeclaredSignature(context.body, type)) throw new ApiError('unsupported_media_type');
  const prepared = preparePhoto(context.body, type);

  const existing = await query<{ count: string }>('SELECT count(*)::text AS count FROM photos WHERE board_tag = $1', [tag]);
  if (Number(existing[0]?.count ?? '0') >= MAX_PHOTOS_PER_BOARD) {
    throw new ApiError('validation', { photo: `A board takes at most ${MAX_PHOTOS_PER_BOARD} photos.` });
  }

  const allocated = await query<{ value: string }>("SELECT nextval('photo_id_seq')::text AS value");
  const sequence = allocated[0]?.value;
  if (sequence === undefined) throw new Error('photo id was not allocated');
  const id = `PH-${sequence.padStart(4, '0')}`;
  const extension = extensionFor(type);
  const base = `photos/${tag}/${id}`;
  const originalKey = `${base}/original.${extension}`;
  const displayKey = `${base}/display.${extension}`;
  const thumbKey = `${base}/thumb.${extension}`;

  const written: string[] = [];
  try {
    await putObject(originalKey, context.body, type);
    written.push(originalKey);
    await putObject(displayKey, prepared.display, type);
    written.push(displayKey);
    await putObject(thumbKey, prepared.thumb, type);
    written.push(thumbKey);
  } catch (error) {
    for (const key of written) await deleteObject(key).catch(() => undefined);
    throw error;
  }

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO photos (id, board_tag, content_type, extension, width, height, original_key, display_key, thumb_key, created_at, sequence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, tag, type, extension, prepared.width, prepared.height, originalKey, displayKey, thumbKey, context.now, Number(sequence)]
    );
  });

  return jsonReply(201, {
    photo: { ...photoShape({ id, width: prepared.width, height: prepared.height }), original_url: `/api/photos/${id}/original`, key: originalKey }
  });
}

async function loadPhotoRecord(id: string): Promise<PhotoRecord> {
  const found = await rows<PhotoRecord>(
    pool,
    'SELECT id, board_tag, content_type, original_key, display_key, thumb_key FROM photos WHERE id = $1',
    [id]
  );
  const photo = found[0];
  if (photo === undefined) throw new ApiError('not_found');
  return photo;
}

async function servePhotoCopy(context: RequestContext, which: 'display' | 'thumb'): Promise<Reply> {
  const photo = await loadPhotoRecord(pathParam(context, 'id'));
  const staff = context.user !== null && context.user.role !== 'maker';
  if (!staff) {
    const board = await loadBoard(pool, photo.board_tag);
    if (board === null || !isPubliclyVisible(board.status)) throw new ApiError('not_found');
  }
  const key = which === 'display' ? photo.display_key : photo.thumb_key;
  const stored = await getObject(key);
  if (stored === null) throw new ApiError('not_found');
  return {
    status: 200,
    body: stored.body,
    headers: { 'content-type': photo.content_type, 'x-content-type-options': 'nosniff' }
  };
}

async function serveOriginal(context: RequestContext): Promise<Reply> {
  const photo = await loadPhotoRecord(pathParam(context, 'id'));
  if (context.user === null || context.user.role === 'maker') throw new ApiError('not_found');
  const stored = await getObject(photo.original_key);
  if (stored === null) throw new ApiError('not_found');
  return {
    status: 200,
    body: stored.body,
    headers: { 'content-type': photo.content_type, 'x-content-type-options': 'nosniff' }
  };
}

export const photoRoutes: Route[] = [
  route('POST', '/api/boards/:tag/photos', true, uploadPhoto, 'photo'),
  route('GET', '/api/photos/:id', false, (context) => servePhotoCopy(context, 'display')),
  route('GET', '/api/photos/:id/thumb', false, (context) => servePhotoCopy(context, 'thumb')),
  route('GET', '/api/photos/:id/original', true, serveOriginal)
];
