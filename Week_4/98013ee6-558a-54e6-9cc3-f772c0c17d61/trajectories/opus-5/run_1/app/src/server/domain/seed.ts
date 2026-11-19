import { clockBase, now } from '../clock.js';
import { query, tx, type Queryable } from '../db.js';
import { notFound, validation } from '../errors.js';
import { hashPassword } from '../routes/accounts.js';
import { solidImage, type ImageFormat } from '../images.js';
import { insertPin, storeImage } from './create.js';
import {
  requireAlt,
  requireBoardName,
  requireComment,
  requireDescription,
  requireEmail,
  requireHandle,
  requireName,
  requirePassword,
  requireReaction,
  requireRole,
  requireSource,
  requireTitle,
  requireVisibility,
} from './validate.js';

export interface SeedUser {
  key: string;
  email: string;
  password: string;
  name: string;
  handle: string;
}

export interface SeedBoard {
  key: string;
  owner: string;
  name: string;
  visibility: string;
  members?: { user: string; role: string }[];
  sections?: { key: string; name: string }[];
  cover?: string | null;
  at?: string;
}

export interface SeedImage {
  width: number;
  height: number;
  format: ImageFormat;
  color: string;
}

export interface SeedPin {
  key: string;
  owner: string;
  board: string;
  section?: string | null;
  title: string;
  description?: string;
  alt: string;
  source?: string | null;
  image: SeedImage;
  at?: string;
}

export interface SeedSave {
  key: string;
  of: string;
  by: string;
  board: string;
  section?: string | null;
  at?: string;
}

export interface SeedFollow {
  follower: string;
  user?: string;
  board?: string;
}

export interface SeedComment {
  key: string;
  pin: string;
  author: string;
  parent?: string | null;
  text: string;
  at?: string;
}

export interface SeedReaction {
  pin: string;
  user: string;
  type: string;
  at?: string;
}

export interface SeedBody {
  users?: SeedUser[];
  boards?: SeedBoard[];
  pins?: SeedPin[];
  saves?: SeedSave[];
  follows?: SeedFollow[];
  comments?: SeedComment[];
  reactions?: SeedReaction[];
}

type Ids = Record<string, number>;

function list<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function at(value: string | undefined): Date {
  if (value === undefined) return now();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw validation('at');
  return parsed;
}

function resolve(ids: Ids, key: string | undefined | null, field: string): number {
  if (typeof key !== 'string' || !(key in ids)) throw validation(field);
  return ids[key];
}

export async function runSeed(body: SeedBody): Promise<Ids> {
  const ids: Ids = {};
  const positions = new Map<string, number>();
  const sectionBoards = new Map<number, number>();

  await tx(async (db) => {
    for (const user of list(body.users)) {
      const email = requireEmail(user.email);
      const password = requirePassword(user.password);
      const name = requireName(user.name);
      const handle = requireHandle(user.handle);
      const inserted = await db.query<{ id: number }>(
        `insert into users (email, email_lower, password_hash, name, handle, created_at)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [email, email.toLowerCase(), hashPassword(password), name, handle, now().toISOString()],
      );
      ids[user.key] = inserted.rows[0].id;
    }

    for (const board of list(body.boards)) {
      const ownerId = resolve(ids, board.owner, 'owner');
      const name = requireBoardName(board.name);
      const visibility = requireVisibility(board.visibility);
      const created = at(board.at);
      const inserted = await db.query<{ id: number }>(
        `insert into boards (owner_id, name, name_lower, visibility, seq, created_at)
         values ($1, $2, $3, $4, 0, $5) returning id`,
        [ownerId, name, name.toLowerCase(), visibility, created.toISOString()],
      );
      const boardId = inserted.rows[0].id;
      ids[board.key] = boardId;
      for (const member of list(board.members)) {
        const role = requireRole(member.role);
        await db.query(
          `insert into board_members (board_id, user_id, role, created_at) values ($1, $2, $3, $4)
           on conflict (board_id, user_id) do update set role = excluded.role`,
          [boardId, resolve(ids, member.user, 'members'), role, created.toISOString()],
        );
      }
      for (const [index, section] of list(board.sections).entries()) {
        const sectionName = requireBoardName(section.name);
        const row = await db.query<{ id: number }>(
          `insert into sections (board_id, name, name_lower, position) values ($1, $2, $3, $4)
           returning id`,
          [boardId, sectionName, sectionName.toLowerCase(), index + 1],
        );
        ids[section.key] = row.rows[0].id;
        sectionBoards.set(row.rows[0].id, boardId);
      }
    }

    for (const pin of list(body.pins)) {
      const ownerId = resolve(ids, pin.owner, 'owner');
      const boardId = resolve(ids, pin.board, 'board');
      const sectionId =
        pin.section === undefined || pin.section === null
          ? null
          : resolve(ids, pin.section, 'section');
      if (sectionId !== null && sectionBoards.get(sectionId) !== boardId) throw notFound();
      const title = requireTitle(pin.title);
      const description = requireDescription(pin.description ?? '');
      const alt = requireAlt(pin.alt);
      const source = requireSource(pin.source ?? null);
      const created = at(pin.at);
      const bytes = await seedImageBytes(pin.image);
      const image = await storeImage(db, bytes, pin.image.format);
      const key = `${boardId}:${sectionId ?? 0}`;
      const position = (positions.get(key) ?? 0) + 1;
      positions.set(key, position);
      const pinId = await insertPin(
        db,
        {
          ownerId,
          boardId,
          sectionId,
          title,
          description,
          alt,
          source,
          imageId: image.id,
          rootPinId: null,
          at: created,
        },
        position,
      );
      await db.query(`update pins set state = 'live' where id = $1`, [pinId]);
      ids[pin.key] = pinId;
      await bumpLastSaved(db, boardId, created);
    }

    for (const save of list(body.saves)) {
      const sourceId = resolve(ids, save.of, 'of');
      const byId = resolve(ids, save.by, 'by');
      const boardId = resolve(ids, save.board, 'board');
      const sectionId =
        save.section === undefined || save.section === null
          ? null
          : resolve(ids, save.section, 'section');
      const created = at(save.at);
      const source = await db.query<{
        title: string;
        description: string;
        alt: string;
        source: string | null;
        image_id: number;
        root_pin_id: number | null;
      }>('select title, description, alt, source, image_id, root_pin_id from pins where id = $1', [
        sourceId,
      ]);
      const row = source.rows[0];
      if (!row) throw validation('of');
      const key = `${boardId}:${sectionId ?? 0}`;
      const position = (positions.get(key) ?? 0) + 1;
      positions.set(key, position);
      const saveId = await insertPin(
        db,
        {
          ownerId: byId,
          boardId,
          sectionId,
          title: row.title,
          description: row.description,
          alt: row.alt,
          source: row.source,
          imageId: row.image_id,
          rootPinId: row.root_pin_id ?? sourceId,
          at: created,
        },
        position,
      );
      await db.query(`update pins set state = 'live' where id = $1`, [saveId]);
      ids[save.key] = saveId;
      await bumpLastSaved(db, boardId, created);
    }

    for (const board of list(body.boards)) {
      if (board.cover === undefined || board.cover === null) continue;
      const boardId = ids[board.key];
      await db.query('update boards set cover_pin_id = $2 where id = $1', [
        boardId,
        resolve(ids, board.cover, 'cover'),
      ]);
    }

    for (const follow of list(body.follows)) {
      const followerId = resolve(ids, follow.follower, 'follower');
      if (typeof follow.user === 'string') {
        await db.query(
          `insert into follows_users (follower_id, user_id, created_at) values ($1, $2, $3)
           on conflict do nothing`,
          [followerId, resolve(ids, follow.user, 'user'), now().toISOString()],
        );
      } else if (typeof follow.board === 'string') {
        await db.query(
          `insert into follows_boards (follower_id, board_id, created_at) values ($1, $2, $3)
           on conflict do nothing`,
          [followerId, resolve(ids, follow.board, 'board'), now().toISOString()],
        );
      } else {
        throw validation('follows');
      }
    }

    for (const comment of list(body.comments)) {
      const pinId = resolve(ids, comment.pin, 'pin');
      const authorId = resolve(ids, comment.author, 'author');
      const text = requireComment(comment.text);
      let parentId: number | null = null;
      if (typeof comment.parent === 'string') {
        const parent = resolve(ids, comment.parent, 'parent');
        const row = await db.query<{ parent_id: number | null }>(
          'select parent_id from comments where id = $1',
          [parent],
        );
        parentId = row.rows[0]?.parent_id ?? parent;
      }
      const inserted = await db.query<{ id: number }>(
        `insert into comments (pin_id, author_id, parent_id, text, created_at)
         values ($1, $2, $3, $4, $5) returning id`,
        [pinId, authorId, parentId, text, at(comment.at).toISOString()],
      );
      ids[comment.key] = inserted.rows[0].id;
    }

    for (const reaction of list(body.reactions)) {
      const pinId = resolve(ids, reaction.pin, 'pin');
      const userId = resolve(ids, reaction.user, 'user');
      const type = requireReaction(reaction.type);
      await db.query(
        `insert into reactions (pin_id, user_id, type, created_at) values ($1, $2, $3, $4)
         on conflict (pin_id, user_id) do update set type = excluded.type`,
        [pinId, userId, type, at(reaction.at).toISOString()],
      );
    }
  });

  return ids;
}

async function bumpLastSaved(db: Queryable, boardId: number, when: Date): Promise<void> {
  await db.query(
    `update boards set last_saved_at = greatest(coalesce(last_saved_at, $2), $2) where id = $1`,
    [boardId, when.toISOString()],
  );
}

async function seedImageBytes(image: SeedImage): Promise<Buffer> {
  if (image.format !== 'png' && image.format !== 'jpeg') throw validation('image');
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < 1 ||
    image.height < 1
  ) {
    throw validation('image');
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(image.color)) throw validation('image');
  return solidImage(image.width, image.height, image.format, image.color);
}

const NIGHT_SIZES = [
  [600, 900],
  [800, 800],
  [1200, 600],
  [600, 1200],
  [900, 600],
  [700, 1000],
  [1000, 1000],
  [640, 960],
];

const FERN_SIZES = [
  [800, 1200],
  [1000, 800],
  [1200, 700],
  [900, 900],
];

const DEMO_COLORS = [
  '#1d2b24',
  '#26382c',
  '#2f4435',
  '#37503d',
  '#405c46',
  '#48684e',
  '#517457',
  '#5a805f',
  '#163026',
  '#1e3a2d',
  '#274434',
  '#2f4e3b',
];

/** The demo collectors, boards and pins, created once on an empty database. */
export async function seedDemoContent(): Promise<void> {
  const people = await query<{ n: number }>('select count(*)::int as n from users');
  if ((people[0]?.n ?? 0) > 0) return;
  const flag = await query<{ value: string }>(`select value from app_flags where key = 'demo'`);
  if (flag.length > 0) return;
  const start = clockBase();
  const hoursBefore = (hours: number): string =>
    new Date(start.getTime() - hours * 3600 * 1000).toISOString();

  const body: SeedBody = {
    users: [
      {
        key: 'wren',
        email: 'wren@demo.mothlight.example',
        password: 'mothlight-demo-2027',
        name: 'Wren Hollis',
        handle: 'wren_hollis',
      },
      {
        key: 'odile',
        email: 'odile@demo.mothlight.example',
        password: 'mothlight-demo-2027',
        name: 'Odile Marsh',
        handle: 'odile_marsh',
      },
    ],
    boards: [
      { key: 'night', owner: 'wren', name: 'Night studies', visibility: 'public' },
      { key: 'fern', owner: 'odile', name: 'Fern room', visibility: 'public' },
    ],
    pins: [
      ...NIGHT_SIZES.map((size, index) => ({
        key: `night_${index + 1}`,
        owner: 'wren',
        board: 'night',
        title: `Night study ${index + 1}`,
        alt: `Night study ${index + 1}, a generated print`,
        image: {
          width: size[0],
          height: size[1],
          format: 'png' as ImageFormat,
          color: DEMO_COLORS[index],
        },
        at: hoursBefore(4 + index + 1),
      })),
      ...FERN_SIZES.map((size, index) => ({
        key: `fern_${index + 1}`,
        owner: 'odile',
        board: 'fern',
        title: `Fern study ${index + 1}`,
        alt: `Fern study ${index + 1}, a generated print`,
        image: {
          width: size[0],
          height: size[1],
          format: 'png' as ImageFormat,
          color: DEMO_COLORS[8 + index],
        },
        at: hoursBefore(index + 1),
      })),
    ],
    follows: [{ follower: 'wren', user: 'odile' }],
  };
  await runSeed(body);
  await query(`insert into app_flags (key, value) values ('demo', 'done') on conflict do nothing`);
}
