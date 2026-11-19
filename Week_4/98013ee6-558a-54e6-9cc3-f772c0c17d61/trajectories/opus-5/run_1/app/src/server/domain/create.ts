import type { Queryable } from '../db.js';
import { conflict, storageUnavailable } from '../errors.js';
import { extractTags } from '../../shared/text.js';
import {
  contentTypeFor,
  extensionFor,
  processImage,
  type ImageFormat,
} from '../images.js';
import { StorageError, headObject, putObject, storageHealthy } from '../storage.js';
import { now } from '../clock.js';
import { makeRoom } from './pins.js';

export interface StoredImage {
  id: number;
  width: number;
  height: number;
  sha256: string;
  variants: number[];
}

function keyFor(imageId: number, name: string, format: ImageFormat): string {
  return `images/${imageId}/${name}.${extensionFor(format)}`;
}

/**
 * Stores the image files and confirms every one of them. The caller runs inside a
 * transaction, so a failure leaves no image row and no pin behind.
 */
export async function storeImage(
  db: Queryable,
  bytes: Buffer,
  format: ImageFormat,
): Promise<StoredImage> {
  if (!storageHealthy()) throw storageUnavailable();
  const processed = await processImage(bytes, format);
  const inserted = await db.query<{ id: number }>(
    `insert into images (sha256, width, height, format, variants, created_at)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      processed.sha256,
      processed.width,
      processed.height,
      format,
      processed.variants.map((variant) => variant.width),
      now().toISOString(),
    ],
  );
  const imageId = inserted.rows[0].id;
  const files: { key: string; body: Buffer }[] = [
    { key: keyFor(imageId, 'original', format), body: processed.original },
    ...processed.variants.map((variant) => ({
      key: keyFor(imageId, `w${variant.width}`, format),
      body: variant.body,
    })),
  ];
  try {
    for (const file of files) {
      await putObject(file.key, file.body, contentTypeFor(format));
    }
    for (const file of files) {
      if (!(await headObject(file.key))) throw new StorageError('missing object');
    }
  } catch (error) {
    if (error instanceof StorageError) throw storageUnavailable();
    throw error;
  }
  return {
    id: imageId,
    width: processed.width,
    height: processed.height,
    sha256: processed.sha256,
    variants: processed.variants.map((variant) => variant.width),
  };
}

export interface NewPin {
  ownerId: number;
  boardId: number;
  sectionId: number | null;
  title: string;
  description: string;
  alt: string;
  source: string | null;
  imageId: number;
  rootPinId: number | null;
  at: Date;
}

export async function insertPin(
  db: Queryable,
  input: NewPin,
  position?: number,
): Promise<number> {
  const tags = extractTags(input.title, input.description);
  const searchText = `${input.title}\n${input.description}\n${tags.join(' ')}`;
  if (position === undefined) await makeRoom(db, input.boardId, input.sectionId, 1);
  const inserted = await db.query<{ id: number }>(
    `insert into pins (owner_id, board_id, section_id, position, title, description, alt, source,
                       image_id, root_pin_id, state, version, search_text, created_at)
     values ($1, $2, $3, $12, $4, $5, $6, $7, $8, $9, 'draft', 1, $10, $11)
     returning id`,
    [
      input.ownerId,
      input.boardId,
      input.sectionId,
      input.title,
      input.description,
      input.alt,
      input.source,
      input.imageId,
      input.rootPinId,
      searchText,
      input.at.toISOString(),
      position ?? 1,
    ],
  );
  const pinId = inserted.rows[0].id;
  await writeTags(db, pinId, tags);
  return pinId;
}

export async function writeTags(db: Queryable, pinId: number, tags: string[]): Promise<void> {
  await db.query('delete from pin_tags where pin_id = $1', [pinId]);
  for (const [index, tag] of tags.entries()) {
    await db.query('insert into pin_tags (pin_id, tag, ord) values ($1, $2, $3)', [
      pinId,
      tag,
      index,
    ]);
  }
}

export async function publishPin(db: Queryable, pinId: number): Promise<void> {
  await db.query(`update pins set state = 'live' where id = $1`, [pinId]);
}

export async function findDuplicate(
  db: Queryable,
  ownerId: number,
  sha256: string,
): Promise<{ pin_id: number; board_id: number; board_name: string } | null> {
  const rows = await db.query<{ pin_id: number; board_id: number; board_name: string }>(
    `select p.id as pin_id, b.id as board_id, b.name as board_name
       from pins p
       join images i on i.id = p.image_id
       join boards b on b.id = p.board_id
      where p.owner_id = $1 and p.state = 'live' and i.sha256 = $2 and b.deleted_at is null
      order by p.created_at, p.id
      limit 1`,
    [ownerId, sha256],
  );
  return rows.rows[0] ?? null;
}

export async function requireNoDuplicate(
  db: Queryable,
  ownerId: number,
  sha256: string,
): Promise<void> {
  const duplicate = await findDuplicate(db, ownerId, sha256);
  if (duplicate) {
    throw conflict('duplicate_image', {
      pin_id: duplicate.pin_id,
      board: { id: duplicate.board_id, name: duplicate.board_name },
    });
  }
}

/** One save of a root original per board. */
export async function boardHoldsRoot(
  db: Queryable,
  boardId: number,
  rootId: number,
  exclude: number[],
): Promise<boolean> {
  const rows = await db.query<{ id: number }>(
    `select id from pins
      where board_id = $1 and state = 'live'
        and (id = $2 or root_pin_id = $2)
        and not (id = any($3::bigint[]))
      limit 1`,
    [boardId, rootId, exclude],
  );
  return rows.rows.length > 0;
}

export async function rootOf(db: Queryable, pinId: number): Promise<number> {
  const rows = await db.query<{ root_pin_id: number | null }>(
    'select root_pin_id from pins where id = $1',
    [pinId],
  );
  return rows.rows[0]?.root_pin_id ?? pinId;
}
