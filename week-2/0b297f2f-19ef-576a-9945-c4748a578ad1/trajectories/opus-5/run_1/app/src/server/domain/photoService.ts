import { createHash, randomUUID } from 'node:crypto';
import type { ConditionPhoto, Staff } from '../../shared/types';
import { withClient, withTransaction } from '../db/pool';
import { errors } from '../http/errors';
import { getObjectBytes, putObject } from '../services/imageStore';
import { writeEvent } from './events';
import { rowToPhoto } from './repository';
import { assertRole } from './transitions';

const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export async function attachConditionPhoto(
  staff: Staff,
  objectId: string,
  contentType: string | undefined,
  body: Buffer,
): Promise<{ photo: ConditionPhoto; seq: number }> {
  const objectRow = await withClient(
    async (client) =>
      (await client.query('select id, title from loan_objects where id = $1', [objectId])).rows[0],
  );
  if (!objectRow) throw errors.notFound();
  assertRole(staff, 'registrar');

  const mediaType = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const extension = extensions[mediaType];
  if (!extension) throw errors.unsupportedMediaType();
  if (body.byteLength === 0) {
    throw errors.validationFailed({ photo: 'Attach a JPEG or PNG photo.' });
  }

  const photoId = `photo-${randomUUID()}`;
  const key = `condition/${objectId}/${photoId}.${extension}`;
  await putObject(key, body, mediaType);

  return withTransaction(async (client) => {
    await client.query(
      `insert into condition_photos (id, object_id, key, bytes, sha256, content_type)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        photoId,
        objectId,
        key,
        body.byteLength,
        createHash('sha256').update(body).digest('hex'),
        mediaType,
      ],
    );
    const row = (
      await client.query(
        `select id, object_id, key, bytes, sha256, content_type, attached_at
         from condition_photos where id = $1`,
        [photoId],
      )
    ).rows[0];
    if (!row) throw errors.notFound();
    const seq = await writeEvent(client, {
      kind: 'photo.attached',
      actorId: staff.id,
      objectId,
      title: String(objectRow['title']),
    });
    return { photo: rowToPhoto(row), seq };
  });
}

export async function readConditionPhoto(
  objectId: string,
  photoId: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const row = await withClient(
    async (client) =>
      (
        await client.query(
          'select key, content_type from condition_photos where id = $1 and object_id = $2',
          [photoId, objectId],
        )
      ).rows[0],
  );
  if (!row) return null;
  const stored = await getObjectBytes(String(row['key']));
  if (!stored) throw errors.notFound();
  return { bytes: stored.bytes, contentType: String(row['content_type']) };
}
