import { env } from '../env.js';
import { now } from '../clock.js';
import { one, pool, query, tx } from '../db.js';
import { conflict, forbidden, notFound, tooLarge, unsupportedType, validation, versionConflict } from '../errors.js';
import {
  MULTIPART_LIMIT,
  numericParam,
  readBody,
  requireViewer,
  route,
  sendJson,
} from '../http.js';
import { fileField, parseMultipart, textField } from '../multipart.js';
import { detectFormat, hashPixels, uprightSize } from '../images.js';
import { publish } from '../live.js';
import { recordBoardChange, setLastSaved } from '../domain/changes.js';
import {
  boardHoldsRoot,
  findDuplicate,
  insertPin,
  publishPin,
  storeImage,
  writeTags,
} from '../domain/create.js';
import { loadPins } from '../domain/pins.js';
import { createOperation, undoOperation } from '../domain/operations.js';
import {
  canEditBoard,
  findBoard,
  requireEditableBoard,
  requireVisibleBoard,
  boardVisible,
} from '../domain/visibility.js';
import {
  hasKey,
  readNumber,
  readString,
  readValue,
  requireAlt,
  requireComment,
  requireDescription,
  requireReaction,
  requireSource,
  requireTitle,
} from '../domain/validate.js';
import { extractTags } from '../../shared/text.js';
import type { CommentNode, Pin } from '../../shared/types.js';

async function requirePin(pinId: number, viewerId: number): Promise<Pin> {
  const pins = await loadPins(pool, [pinId], viewerId);
  const pin = pins.get(pinId);
  if (!pin) throw notFound();
  const state = await one<{ state: string }>('select state from pins where id = $1', [pinId]);
  if (!state || state.state !== 'live') throw notFound();
  const board = await findBoard(pool, pin.board.id, viewerId);
  if (!board || !boardVisible(board, viewerId)) throw notFound();
  return pin;
}

async function sectionOnBoard(boardId: number, raw: unknown): Promise<number | null> {
  if (raw === null || raw === undefined || raw === '') return null;
  const sectionId = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(sectionId) || sectionId <= 0) throw notFound();
  const section = await one<{ id: number }>(
    'select id from sections where id = $1 and board_id = $2 and deleted_at is null',
    [sectionId, boardId],
  );
  if (!section) throw notFound();
  return sectionId;
}

route(
  'POST',
  '/api/pins',
  async (ctx) => {
    const viewer = requireViewer(ctx);
    const contentType = ctx.req.headers['content-type'] ?? '';
    const declared = Number(ctx.req.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > MULTIPART_LIMIT) {
      throw tooLarge(env.limits.imageMaxBytes);
    }
    let raw: Buffer;
    try {
      raw = await readBody(ctx.req, MULTIPART_LIMIT);
    } catch {
      throw tooLarge(env.limits.imageMaxBytes);
    }
    const fields = parseMultipart(raw, contentType);
    const boardRaw = textField(fields, 'board');
    const boardId = Number(boardRaw);
    if (!Number.isInteger(boardId) || boardId <= 0) throw notFound();
    const board = await requireVisibleBoard(pool, boardId, viewer.id);
    if (!canEditBoard(board, viewer.id)) throw forbidden();
    const sectionId = await sectionOnBoard(boardId, textField(fields, 'section'));

    const file = fileField(fields, 'image');
    const bytes = file?.data ?? null;
    const format = bytes && bytes.length > 0 ? detectFormat(bytes) : null;
    if (bytes === null || bytes.length === 0) throw validation('image');
    if (format === null) throw unsupportedType();
    if (bytes.length > env.limits.imageMaxBytes) throw tooLarge(env.limits.imageMaxBytes);

    const size = await uprightSize(bytes);
    const pixelsOk = size !== null && size.width * size.height <= env.limits.imageMaxPixels;
    const ratio = size === null ? 0 : size.width / size.height;
    const shapeOk = size !== null && ratio >= 0.5 && ratio <= 2;
    if (pixelsOk && shapeOk) {
      const sha256 = await hashPixels(bytes);
      const duplicate = await findDuplicate(pool, viewer.id, sha256);
      if (duplicate) {
        throw conflict('duplicate_image', {
          pin_id: duplicate.pin_id,
          board: { id: duplicate.board_id, name: duplicate.board_name },
        });
      }
    }

    const title = requireTitle(textField(fields, 'title'));
    const description = requireDescription(textField(fields, 'description'));
    const alt = requireAlt(textField(fields, 'alt'));
    const source = requireSource(textField(fields, 'source'));
    if (size === null || !pixelsOk || !shapeOk) throw validation('image');

    const at = now();
    const pinId = await tx(async (db) => {
      const image = await storeImage(db, bytes, format);
      const created = await insertPin(db, {
        ownerId: viewer.id,
        boardId,
        sectionId,
        title,
        description,
        alt,
        source,
        imageId: image.id,
        rootPinId: null,
        at,
      });
      await publishPin(db, created);
      await setLastSaved(db, boardId, at);
      await recordBoardChange(db, boardId, viewer, 'added', { id: created, title });
      await publish({ k: 'feed', pin_id: created }, db);
      return created;
    });
    const pins = await loadPins(pool, [pinId], viewer.id);
    sendJson(ctx.res, 201, pins.get(pinId));
  },
  { raw: true },
);

route('GET', '/api/pins/:id', async (ctx) => {
  const viewer = requireViewer(ctx);
  const pin = await requirePin(numericParam(ctx, 'id'), viewer.id);
  sendJson(ctx.res, 200, pin);
});

route('PATCH', '/api/pins/:id', async (ctx) => {
  const viewer = requireViewer(ctx);
  const pinId = numericParam(ctx, 'id');
  const pin = await requirePin(pinId, viewer.id);
  if (pin.owner.id !== viewer.id) throw forbidden();
  const version = readNumber(ctx.body, 'version');
  if (version !== pin.version) throw versionConflict(pin);
  const title = hasKey(ctx.body, 'title') ? requireTitle(readString(ctx.body, 'title')) : pin.title;
  const description = hasKey(ctx.body, 'description')
    ? requireDescription(readString(ctx.body, 'description'))
    : pin.description;
  const alt = hasKey(ctx.body, 'alt') ? requireAlt(readString(ctx.body, 'alt')) : pin.alt;
  const source = hasKey(ctx.body, 'source')
    ? requireSource(readValue(ctx.body, 'source') === null ? null : readString(ctx.body, 'source'))
    : pin.source;
  const tags = extractTags(title, description);
  await tx(async (db) => {
    await db.query(
      `update pins set title = $2, description = $3, alt = $4, source = $5,
              version = version + 1, search_text = $6
        where id = $1`,
      [pinId, title, description, alt, source, `${title}\n${description}\n${tags.join(' ')}`],
    );
    await writeTags(db, pinId, tags);
    await recordBoardChange(db, pin.board.id, viewer, 'updated', { id: pinId, title });
    await publish({ k: 'pin_changed', pin_id: pinId, version: pin.version + 1 }, db);
  });
  const updated = await loadPins(pool, [pinId], viewer.id);
  sendJson(ctx.res, 200, updated.get(pinId));
});

route('DELETE', '/api/pins/:id', async (ctx) => {
  const viewer = requireViewer(ctx);
  const pinId = numericParam(ctx, 'id');
  const pin = await requirePin(pinId, viewer.id);
  const board = await findBoard(pool, pin.board.id, viewer.id);
  if (!board) throw notFound();
  if (!canEditBoard(board, viewer.id) && pin.owner.id !== viewer.id) throw forbidden();
  const operation = await createOperation(viewer, {
    kind: 'delete',
    pinIds: [pinId],
    boardId: null,
    sectionId: null,
  });
  sendJson(ctx.res, 200, operation);
});

route('POST', '/api/pins/:id/saves', async (ctx) => {
  const viewer = requireViewer(ctx);
  const pinId = numericParam(ctx, 'id');
  const pin = await requirePin(pinId, viewer.id);
  const boardId = readNumber(ctx.body, 'board');
  if (boardId === null) throw notFound();
  const target = await requireEditableBoard(pool, boardId, viewer.id);
  const sectionId = await sectionOnBoard(boardId, readValue(ctx.body, 'section'));
  const root = await rootIdOf(pinId);
  if (await boardHoldsRoot(pool, boardId, root, [])) {
    throw conflict('already_on_board', { board: { id: target.id, name: target.name } });
  }
  const source = await one<{ image_id: number }>('select image_id from pins where id = $1', [pinId]);
  if (!source) throw notFound();
  const at = now();
  const saveId = await tx(async (db) => {
    const created = await insertPin(db, {
      ownerId: viewer.id,
      boardId,
      sectionId,
      title: pin.title,
      description: pin.description,
      alt: pin.alt,
      source: pin.source,
      imageId: source.image_id,
      rootPinId: root,
      at,
    });
    await publishPin(db, created);
    await setLastSaved(db, boardId, at);
    await recordBoardChange(db, boardId, viewer, 'added', { id: created, title: pin.title });
    await publish({ k: 'counts', pin_id: root }, db);
    await publish({ k: 'feed', pin_id: created }, db);
    return created;
  });
  const saved = await loadPins(pool, [saveId], viewer.id);
  sendJson(ctx.res, 201, saved.get(saveId));
});

async function rootIdOf(pinId: number): Promise<number> {
  const row = await one<{ root_pin_id: number | null }>(
    'select root_pin_id from pins where id = $1',
    [pinId],
  );
  return row?.root_pin_id ?? pinId;
}

interface CommentRow {
  id: number;
  parent_id: number | null;
  text: string;
  deleted: boolean;
  created_at: Date;
  author_id: number;
  author_name: string;
  author_handle: string;
}

function commentNode(row: CommentRow): CommentNode {
  return {
    id: row.id,
    author: { id: row.author_id, name: row.author_name, handle: row.author_handle },
    text: row.deleted ? null : row.text,
    deleted: row.deleted,
    created_at: row.created_at.toISOString(),
  };
}

route('GET', '/api/pins/:id/comments', async (ctx) => {
  const viewer = requireViewer(ctx);
  const pinId = numericParam(ctx, 'id');
  await requirePin(pinId, viewer.id);
  const rows = await query<CommentRow>(
    `select c.id, c.parent_id, c.text, c.deleted, c.created_at,
            u.id as author_id, u.name as author_name, u.handle as author_handle
       from comments c join users u on u.id = c.author_id
      where c.pin_id = $1
      order by c.created_at, c.id`,
    [pinId],
  );
  const tops = rows.filter((row) => row.parent_id === null);
  const comments: CommentNode[] = tops.map((row) => ({
    ...commentNode(row),
    replies: rows.filter((reply) => reply.parent_id === row.id).map(commentNode),
  }));
  const count = rows.filter((row) => !row.deleted).length;
  sendJson(ctx.res, 200, { count, comments });
});

route('POST', '/api/pins/:id/comments', async (ctx) => {
  const viewer = requireViewer(ctx);
  const pinId = numericParam(ctx, 'id');
  await requirePin(pinId, viewer.id);
  const parentRaw = readValue(ctx.body, 'parent');
  let parentId: number | null = null;
  if (typeof parentRaw === 'number') {
    const parent = await one<{ id: number; parent_id: number | null }>(
      'select id, parent_id from comments where id = $1 and pin_id = $2',
      [parentRaw, pinId],
    );
    if (!parent) throw notFound();
    parentId = parent.parent_id ?? parent.id;
  }
  const text = requireComment(readString(ctx.body, 'text'));
  const created = await one<CommentRow>(
    `with inserted as (
       insert into comments (pin_id, author_id, parent_id, text, created_at)
       values ($1, $2, $3, $4, $5) returning *
     )
     select i.id, i.parent_id, i.text, i.deleted, i.created_at,
            u.id as author_id, u.name as author_name, u.handle as author_handle
       from inserted i join users u on u.id = i.author_id`,
    [pinId, viewer.id, parentId, text, now().toISOString()],
  );
  if (!created) throw validation('text');
  await publish({ k: 'counts', pin_id: pinId });
  sendJson(ctx.res, 201, commentNode(created));
});

route('DELETE', '/api/comments/:id', async (ctx) => {
  const viewer = requireViewer(ctx);
  const commentId = numericParam(ctx, 'id');
  const comment = await one<{ id: number; pin_id: number; author_id: number }>(
    'select id, pin_id, author_id from comments where id = $1',
    [commentId],
  );
  if (!comment) throw notFound();
  const pin = await requirePin(comment.pin_id, viewer.id);
  if (comment.author_id !== viewer.id && pin.owner.id !== viewer.id) throw forbidden();
  const replies = await one<{ n: number }>(
    'select count(*)::int as n from comments where parent_id = $1',
    [commentId],
  );
  if ((replies?.n ?? 0) > 0) {
    await query('update comments set deleted = true where id = $1', [commentId]);
  } else {
    await query('delete from comments where id = $1', [commentId]);
  }
  await publish({ k: 'counts', pin_id: comment.pin_id });
  ctx.res.writeHead(204).end();
});

route('PUT', '/api/pins/:id/reaction', async (ctx) => {
  const viewer = requireViewer(ctx);
  const pinId = numericParam(ctx, 'id');
  await requirePin(pinId, viewer.id);
  const type = requireReaction(readString(ctx.body, 'type'));
  const existing = await one<{ type: string }>(
    'select type from reactions where pin_id = $1 and user_id = $2',
    [pinId, viewer.id],
  );
  if (existing && existing.type === type) {
    await query('delete from reactions where pin_id = $1 and user_id = $2', [pinId, viewer.id]);
  } else {
    await query(
      `insert into reactions (pin_id, user_id, type, created_at) values ($1, $2, $3, $4)
       on conflict (pin_id, user_id) do update set type = excluded.type, created_at = excluded.created_at`,
      [pinId, viewer.id, type, now().toISOString()],
    );
  }
  const mine = await one<{ type: string }>(
    'select type from reactions where pin_id = $1 and user_id = $2',
    [pinId, viewer.id],
  );
  const total = await one<{ n: number }>(
    'select count(*)::int as n from reactions where pin_id = $1',
    [pinId],
  );
  await publish({ k: 'counts', pin_id: pinId });
  sendJson(ctx.res, 200, { mine: mine?.type ?? null, reactions: total?.n ?? 0 });
});

route('POST', '/api/operations', async (ctx) => {
  const viewer = requireViewer(ctx);
  const kind = readString(ctx.body, 'kind');
  if (kind !== 'move' && kind !== 'copy' && kind !== 'delete') throw validation('kind');
  const rawPins = readValue(ctx.body, 'pins');
  if (!Array.isArray(rawPins)) throw validation('pins');
  const pinIds: number[] = [];
  for (const value of rawPins) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw validation('pins');
    }
    pinIds.push(value);
  }
  const boardId = readNumber(ctx.body, 'board');
  const sectionRaw = readValue(ctx.body, 'section');
  const sectionId = typeof sectionRaw === 'number' ? sectionRaw : null;
  const operation = await createOperation(viewer, { kind, pinIds, boardId, sectionId });
  sendJson(ctx.res, 201, operation);
});

route('POST', '/api/operations/:id/undo', async (ctx) => {
  const viewer = requireViewer(ctx);
  const operation = await undoOperation(viewer, numericParam(ctx, 'id'));
  sendJson(ctx.res, 200, operation);
});
