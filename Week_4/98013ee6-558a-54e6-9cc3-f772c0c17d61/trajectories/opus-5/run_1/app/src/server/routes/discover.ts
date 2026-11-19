import { now } from '../clock.js';
import { pool, query } from '../db.js';
import { notFound, validation } from '../errors.js';
import { numericParam, requireViewer, route, sendJson } from '../http.js';
import { publish } from '../live.js';
import { loadPins } from '../domain/pins.js';
import { visiblePinClause } from '../domain/visibility.js';
import { queryWords } from '../../shared/text.js';
import type {
  BoardCount,
  FeedPin,
  ProfileBoard,
  ProfileResponse,
  SearchResponse,
  TagCount,
} from '../../shared/types.js';

const FEED_MAX = 60;

route('GET', '/api/feed', async (ctx) => {
  const viewer = requireViewer(ctx);
  const rows = await query<{
    id: number;
    root_pin_id: number | null;
    owner_name: string;
  }>(
    `select p.id, p.root_pin_id, o.name as owner_name
       from pins p
       join boards bd on bd.id = p.board_id
       join users o on o.id = p.owner_id
      where p.state = 'live' and bd.deleted_at is null
        and (
          (bd.visibility = 'public' and (
             exists (select 1 from follows_users f where f.follower_id = $1 and f.user_id = bd.owner_id)
             or exists (select 1 from follows_boards f where f.follower_id = $1 and f.board_id = bd.id)
          ))
          or bd.owner_id = $1
          or exists (select 1 from board_members m where m.board_id = bd.id and m.user_id = $1)
          or p.owner_id = $1
        )
      order by p.created_at desc, p.id asc
      limit 1000`,
    [viewer.id],
  );

  const groups = new Map<number, { newest: number; size: number; owners: string[] }>();
  const order: number[] = [];
  for (const row of rows) {
    const root = row.root_pin_id ?? row.id;
    const existing = groups.get(root);
    if (!existing) {
      groups.set(root, { newest: row.id, size: 1, owners: [row.owner_name] });
      order.push(root);
    } else {
      existing.size += 1;
      if (!existing.owners.includes(row.owner_name)) existing.owners.push(row.owner_name);
    }
  }
  const chosen = order.slice(0, FEED_MAX).map((root) => groups.get(root)!);
  const pins = await loadPins(pool, chosen.map((group) => group.newest), viewer.id);
  const feed: FeedPin[] = [];
  for (const group of chosen) {
    const pin = pins.get(group.newest);
    if (!pin) continue;
    feed.push({ ...pin, group: { size: group.size, owners: group.owners } });
  }
  sendJson(ctx.res, 200, { pins: feed });
});

function wordClauses(words: string[], params: unknown[]): string {
  return words
    .map((word) => {
      params.push(word);
      return `lower(p.search_text) ~ ('(^|[^[:alnum:]])' || $${params.length})`;
    })
    .join(' and ');
}

route('GET', '/api/search', async (ctx) => {
  const viewer = requireViewer(ctx);
  const rawQuery = (ctx.url.searchParams.get('q') ?? '').trim();
  const tag = (ctx.url.searchParams.get('tag') ?? '').trim().toLowerCase();
  const boardParam = ctx.url.searchParams.get('board');
  const boardId = boardParam === null || boardParam === '' ? null : Number(boardParam);
  const words = queryWords(rawQuery);

  const base = (params: unknown[]): string => {
    params.push(viewer.id);
    return `from pins p join boards bd on bd.id = p.board_id where ${visiblePinClause(`$${params.length}`)}`;
  };

  let pins: SearchResponse['pins'] = [];
  if (words.length > 0 || tag.length > 0) {
    const params: unknown[] = [];
    let sql = `select p.id ${base(params)}`;
    if (words.length > 0) sql += ` and ${wordClauses(words, params)}`;
    if (tag.length > 0) {
      params.push(tag);
      sql += ` and exists (select 1 from pin_tags t where t.pin_id = p.id and t.tag = $${params.length})`;
    }
    if (boardId !== null) {
      params.push(boardId);
      sql += ` and p.board_id = $${params.length}`;
    }
    sql += ' order by p.created_at desc, p.id asc limit 60';
    const rows = await query<{ id: number }>(sql, params);
    const loaded = await loadPins(pool, rows.map((row) => row.id), viewer.id);
    pins = rows.map((row) => loaded.get(row.id)).filter((pin): pin is SearchResponse['pins'][number] => pin !== undefined);
  }

  const facetParams: unknown[] = [];
  let facetSql = `select p.id ${base(facetParams)}`;
  if (words.length > 0) facetSql += ` and ${wordClauses(words, facetParams)}`;

  const tagParams = [...facetParams];
  let tagSql = facetSql;
  if (boardId !== null) {
    tagParams.push(boardId);
    tagSql += ` and p.board_id = $${tagParams.length}`;
  }
  const tagRows = await query<TagCount>(
    `select t.tag, count(*)::int as count
       from pin_tags t
      where t.pin_id in (${tagSql})
      group by t.tag
      having count(*) >= 1
      order by count(*) desc, t.tag asc`,
    tagParams,
  );

  const boardParams = [...facetParams];
  let boardSql = facetSql;
  if (tag.length > 0) {
    boardParams.push(tag);
    boardSql += ` and exists (select 1 from pin_tags t where t.pin_id = p.id and t.tag = $${boardParams.length})`;
  }
  const boardRows = await query<BoardCount>(
    `select b.id, b.name, count(*)::int as count
       from pins q join boards b on b.id = q.board_id
      where q.id in (${boardSql})
      group by b.id, b.name
      order by count(*) desc, lower(b.name) asc, b.id asc`,
    boardParams,
  );

  const body: SearchResponse = { pins, tags: tagRows, boards: boardRows };
  sendJson(ctx.res, 200, body);
});

route('GET', '/api/tags/suggest', async (ctx) => {
  const viewer = requireViewer(ctx);
  const prefix = ctx.url.searchParams.get('prefix') ?? '';
  if (!/^[A-Za-z0-9_]{1,30}$/.test(prefix)) throw validation('prefix');
  const rows = await query<TagCount>(
    `select t.tag, count(*)::int as count
       from pin_tags t join pins p on p.id = t.pin_id
      where p.owner_id = $1 and p.state = 'live' and t.tag like $2 || '%'
      group by t.tag
      order by count(*) desc, t.tag asc
      limit 5`,
    [viewer.id, prefix.toLowerCase()],
  );
  sendJson(ctx.res, 200, { tags: rows });
});

route('GET', '/api/users/:handle', async (ctx) => {
  const viewer = requireViewer(ctx);
  const rows = await query<{ id: number; name: string; handle: string }>(
    'select id, name, handle from users where handle = $1',
    [ctx.params.handle],
  );
  const user = rows[0];
  if (!user) throw notFound();
  const sort = ctx.url.searchParams.get('sort') ?? 'last_saved';
  const orderBy =
    sort === 'az'
      ? 'order by lower(b.name) asc, b.id asc'
      : sort === 'newest'
        ? 'order by b.created_at desc, b.id asc'
        : 'order by b.last_saved_at desc nulls last, b.id asc';
  const boards = await query<ProfileBoard & { cover_pin_id: number | null }>(
    `select b.id, b.name, b.visibility, b.cover_pin_id,
            (select count(*)::int from pins p where p.board_id = b.id and p.state = 'live') as pin_count
       from boards b
      where b.owner_id = $1 and b.deleted_at is null
        and (b.visibility = 'public' or b.owner_id = $2
             or exists (select 1 from board_members m where m.board_id = b.id and m.user_id = $2))
      ${orderBy}`,
    [user.id, viewer.id],
  );
  const covers = await query<{ board_id: number; pin_id: number }>(
    `select p.board_id, p.id as pin_id
       from pins p
       left join sections s on s.id = p.section_id
      where p.board_id = any($1::bigint[]) and p.state = 'live'
      order by p.board_id,
               (case when p.section_id is null then 0 else 1 end),
               coalesce(s.position, 0), p.position, p.id`,
    [boards.map((board) => board.id)],
  );
  const firstPin = new Map<number, number>();
  for (const row of covers) {
    if (!firstPin.has(row.board_id)) firstPin.set(row.board_id, row.pin_id);
  }
  const chosenCovers = await query<{ id: number; board_id: number }>(
    `select id, board_id from pins
      where id = any($1::bigint[]) and state = 'live'`,
    [boards.map((board) => board.cover_pin_id).filter((id): id is number => id !== null)],
  );
  const chosen = new Map(chosenCovers.map((row) => [row.board_id, row.id]));
  const counts = await query<{ followers: number; following: number; pin_total: number }>(
    `select (select count(*)::int from follows_users where user_id = $1) as followers,
            (select count(*)::int from follows_users where follower_id = $1) as following,
            (select count(*)::int from pins p join boards bd on bd.id = p.board_id
              where p.owner_id = $1 and ${visiblePinClause('$2')}) as pin_total`,
    [user.id, viewer.id],
  );
  const followingUser = await query<{ n: number }>(
    'select count(*)::int as n from follows_users where follower_id = $1 and user_id = $2',
    [viewer.id, user.id],
  );
  const body: ProfileResponse = {
    user,
    followers: counts[0]?.followers ?? 0,
    following: counts[0]?.following ?? 0,
    pin_total: counts[0]?.pin_total ?? 0,
    board_total: boards.length,
    boards: boards.map((board) => {
      const coverPin = chosen.get(board.id) ?? firstPin.get(board.id) ?? null;
      return {
        id: board.id,
        name: board.name,
        visibility: board.visibility,
        pin_count: board.pin_count,
        cover: coverPin === null ? null : { pin_id: coverPin, url: `/media/${coverPin}/236` },
      };
    }),
    following_user: (followingUser[0]?.n ?? 0) > 0,
  };
  sendJson(ctx.res, 200, body);
});

route('GET', '/api/users/:handle/pins', async (ctx) => {
  const viewer = requireViewer(ctx);
  const rows = await query<{ id: number }>(
    'select id from users where handle = $1',
    [ctx.params.handle],
  );
  const user = rows[0];
  if (!user) throw notFound();
  const pinRows = await query<{ id: number }>(
    `select p.id from pins p join boards bd on bd.id = p.board_id
      where p.owner_id = $2 and ${visiblePinClause('$1')}
      order by p.created_at desc, p.id asc
      limit 200`,
    [viewer.id, user.id],
  );
  const loaded = await loadPins(pool, pinRows.map((row) => row.id), viewer.id);
  sendJson(ctx.res, 200, {
    pins: pinRows.map((row) => loaded.get(row.id)).filter((pin) => pin !== undefined),
  });
});

async function userFollowers(userId: number): Promise<number> {
  const rows = await query<{ n: number }>(
    'select count(*)::int as n from follows_users where user_id = $1',
    [userId],
  );
  return rows[0]?.n ?? 0;
}

async function boardFollowers(boardId: number): Promise<number> {
  const rows = await query<{ n: number }>(
    'select count(*)::int as n from follows_boards where board_id = $1',
    [boardId],
  );
  return rows[0]?.n ?? 0;
}

for (const method of ['PUT', 'DELETE'] as const) {
  route(method, '/api/follows/users/:id', async (ctx) => {
    const viewer = requireViewer(ctx);
    const targetId = numericParam(ctx, 'id');
    const target = await query<{ id: number }>('select id from users where id = $1', [targetId]);
    if (!target[0]) throw notFound();
    if (targetId === viewer.id) throw validation('user');
    if (method === 'PUT') {
      await query(
        `insert into follows_users (follower_id, user_id, created_at) values ($1, $2, $3)
         on conflict do nothing`,
        [viewer.id, targetId, now().toISOString()],
      );
    } else {
      await query('delete from follows_users where follower_id = $1 and user_id = $2', [
        viewer.id,
        targetId,
      ]);
    }
    await publish({ k: 'follow', target: 'user', id: targetId });
    sendJson(ctx.res, 200, {
      following: method === 'PUT',
      followers: await userFollowers(targetId),
    });
  });

  route(method, '/api/follows/boards/:id', async (ctx) => {
    const viewer = requireViewer(ctx);
    const boardId = numericParam(ctx, 'id');
    const rows = await query<{ id: number; owner_id: number; visibility: string }>(
      `select b.id, b.owner_id, b.visibility from boards b
        where b.id = $1 and b.deleted_at is null
          and (b.visibility = 'public' or b.owner_id = $2
               or exists (select 1 from board_members m where m.board_id = b.id and m.user_id = $2))`,
      [boardId, viewer.id],
    );
    const board = rows[0];
    if (!board) throw notFound();
    if (board.owner_id === viewer.id || board.visibility === 'secret') throw validation('board');
    if (method === 'PUT') {
      await query(
        `insert into follows_boards (follower_id, board_id, created_at) values ($1, $2, $3)
         on conflict do nothing`,
        [viewer.id, boardId, now().toISOString()],
      );
    } else {
      await query('delete from follows_boards where follower_id = $1 and board_id = $2', [
        viewer.id,
        boardId,
      ]);
    }
    await publish({ k: 'follow', target: 'board', id: boardId });
    sendJson(ctx.res, 200, {
      following: method === 'PUT',
      followers: await boardFollowers(boardId),
    });
  });
}
