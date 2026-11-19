/**
 * Part three: the seed, the logs, renaming, the record page and the admin
 * journey.
 */

import fs from 'node:fs/promises';
import { call, login, check, equal, summary, PASSWORD } from './api.mjs';
import { pool } from '../src/db.js';

const LOG = '/tmp/server.log';

// --- DP-05 the seed ---------------------------------------------------------

{
  const members = await pool.query('select username, rating, rated_games, role, email from members order by username');
  const seeded = members.rows.filter((row) => row.email.endsWith('@example.com')
    && ['mira_kade', 'tobin_reyes', 'wren_oyelaran', 'jules_amari', 'nadia_serrano', 'ivo_lindqvist'].includes(row.username));
  equal('DP-05 the six seeded members exist exactly once', seeded.length, 6);
  const expected = {
    mira_kade: [1480, 42, 'administrator'],
    tobin_reyes: [1515, 37, 'member'],
    wren_oyelaran: [2412, 64, 'member'],
    jules_amari: [1190, 6, 'member'],
    nadia_serrano: [108, 31, 'member'],
    ivo_lindqvist: [112, 33, 'member'],
  };
  for (const row of seeded) {
    equal(`DP-05 ${row.username} carries its rating, count and role`,
      [row.rating, row.rated_games, row.role], expected[row.username]);
    equal(`DP-05 ${row.username} holds its email`, row.email, `${row.username}@example.com`);
  }

  const clubs = await pool.query('select name, slug, private from clubs order by slug');
  equal('DP-05 two clubs', clubs.rows, [
    { name: 'Open Hall', slug: 'open-hall', private: false },
    { name: 'Quiet Room', slug: 'quiet-room', private: true },
  ]);
  const open = await pool.query(
    `select count(*)::int as count from club_memberships cm join clubs c on c.id = cm.club_id where c.slug = 'open-hall'`,
  );
  equal('DP-05 every member is in the open hall', open.rows[0].count, 6);
  const owner = await pool.query(
    `select m.username from club_memberships cm join clubs c on c.id = cm.club_id
      join members m on m.id = cm.member_id where c.slug = 'open-hall' and cm.role = 'owner'`,
  );
  equal('DP-05 mira_kade owns the open hall', owner.rows.map((r) => r.username), ['mira_kade']);
  const quiet = await pool.query(
    `select m.username, cm.role, cm.banned from club_memberships cm join clubs c on c.id = cm.club_id
      join members m on m.id = cm.member_id where c.slug = 'quiet-room' order by m.username`,
  );
  equal('DP-05 the quiet room carries its roles and its ban', quiet.rows, [
    { username: 'jules_amari', role: 'member', banned: false },
    { username: 'mira_kade', role: 'owner', banned: false },
    { username: 'nadia_serrano', role: 'member', banned: true },
    { username: 'tobin_reyes', role: 'moderator', banned: false },
  ]);

  const games = await pool.query(
    `select g.status, g.result, g.rated, g.level, g.end_reason, g.opening,
            w.username as white, b.username as black, c.slug as club,
            (select count(*)::int from moves where game_id = g.id) as plies
       from games g left join members w on w.id = g.white_id
       left join members b on b.id = g.black_id left join clubs c on c.id = g.club_id
      order by g.created_at`,
  );
  equal('DP-05 four games', games.rows.length, 4);
  const finished = games.rows.find((row) => row.status === 'finished');
  equal('DP-05 the finished rated game is mira as White over wren, won by White',
    [finished.white, finished.black, finished.result, finished.rated, finished.end_reason],
    ['mira_kade', 'wren_oyelaran', '1-0', true, 'checkmate']);
  check('DP-05 the finished game has its moves and its opening named',
    finished.plies > 0 && typeof finished.opening === 'string' && finished.opening.length > 0,
    `${finished.plies} plies, opening ${finished.opening}`);
  const hall = games.rows.find((row) => row.club === 'open-hall');
  equal('DP-05 the open hall game is mira against tobin, rated, White to move',
    [hall.white, hall.black, hall.rated, hall.status], ['mira_kade', 'tobin_reyes', true, 'in_progress']);
  equal('DP-05 five moves have been played in it', hall.plies / 2, 5);
  const quietGame = games.rows.find((row) => row.club === 'quiet-room');
  equal('DP-05 the quiet room game is tobin against jules, rated, in progress',
    [quietGame.white, quietGame.black, quietGame.rated, quietGame.status],
    ['tobin_reyes', 'jules_amari', true, 'in_progress']);
  const house = games.rows.find((row) => row.level !== null);
  equal('DP-05 the house game is jules at steady, unrated',
    [house.white, house.black, house.level, house.rated], ['jules_amari', null, 'steady', false]);

  const challenges = await pool.query(
    `select f.username as from_name, t.username as to_name, c.rated, c.status from challenges c
       join members f on f.id = c.from_id join members t on t.id = c.to_id`,
  );
  equal('DP-05 one pending rated challenge from mira to tobin', challenges.rows, [
    { from_name: 'mira_kade', to_name: 'tobin_reyes', rated: true, status: 'pending' },
  ]);
  const blocks = await pool.query(
    `select a.username as blocker, b.username as blocked from blocks x
       join members a on a.id = x.blocker_id join members b on b.id = x.blocked_id`,
  );
  equal('DP-05 one block: nadia has blocked jules', blocks.rows,
    [{ blocker: 'nadia_serrano', blocked: 'jules_amari' }]);
  const chat = await pool.query(
    `select g.id, count(*)::int as messages from chat_messages c join games g on g.id = c.game_id
      group by g.id order by messages`,
  );
  equal('DP-05 two chat messages in each of the two in-progress member games',
    chat.rows.map((row) => row.messages), [2, 2]);
}

// --- DP-02 one line per request ---------------------------------------------

{
  const before = (await fs.readFile(LOG, 'utf8')).split('\n').length;
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const out = await call('GET', '/api/health');
    ids.push(out.headers.get('x-request-id'));
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  const lines = (await fs.readFile(LOG, 'utf8')).split('\n').filter(Boolean);
  const fresh = lines.slice(before - 1);
  const parsed = fresh.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  for (const id of ids) {
    const matching = parsed.filter((line) => line.request_id === id);
    equal(`DP-02 exactly one structured line carries ${id.slice(0, 8)}`, matching.length, 1);
    check('DP-02 the line carries the method, path and status',
      matching[0] && matching[0].method === 'GET' && matching[0].path === '/api/health' && matching[0].status === 200,
      JSON.stringify(matching[0]));
  }
  check('DP-02 no two requests share one identifier', new Set(ids).size === ids.length);
}

// --- DP-10 a rename shows everywhere ---------------------------------------

{
  const name = `rn_${Date.now().toString(36)}`.slice(0, 18);
  const made = await call('POST', '/api/auth/register', {
    body: { username: name, email: `${name}@example.com`, password: PASSWORD },
  });
  check('a member joins', made.status === 201, `${made.status} ${made.text}`);
  const token = await login(name);
  const tobin = await login('tobin_reyes');
  const challenge = await call('POST', '/api/challenges', {
    token, body: { opponent: 'tobin_reyes', colour: 'White', rated: false },
  });
  const game = await call('POST', `/api/challenges/${challenge.data.id}/accept`, {
    token: tobin, headers: { 'Idempotency-Key': `rn-${challenge.data.id}` },
  });
  await call('POST', `/api/games/${game.data.id}/chat`, { token, body: { text: 'A word before we start.' } });
  const renamed = `${name}_2`.slice(0, 20);
  const change = await call('PATCH', '/api/profile', { token, body: { username: renamed } });
  equal('DP-10 the rename takes', change.data.username, renamed);
  const after = await call('GET', `/api/games/${game.data.id}`, { token });
  equal('DP-10 the game header carries the new name', after.data.white.username, renamed);
  const chat = await call('GET', `/api/games/${game.data.id}/chat`, { token });
  equal('DP-10 every message the member sent carries the new name', chat.data[0].username, renamed);
  const record = await call('GET', `/api/games/${game.data.id}/record`, { token, raw: true });
  check('DP-10 the White and Black record tags carry the new name',
    record.text.includes(`[White "${renamed}"]`), record.text.split('\n')[4]);
}

// --- journey 7: an administrator voids a rated game -------------------------

{
  const admin = await login('mira_kade');
  const page = await fetch(`http://127.0.0.1:${process.env.APP_PUBLIC_PORT}/admin/games`, {
    headers: { Authorization: `Bearer ${admin}` },
  });
  const html = await page.text();
  check('journey 7 the admin page lists rated games to void',
    page.status === 200 && html.includes('Void a rated game') && html.includes('data-void='),
    `${page.status}`);

  const member = await login('tobin_reyes');
  const refused = await fetch(`http://127.0.0.1:${process.env.APP_PUBLIC_PORT}/admin/games`, {
    headers: { Authorization: `Bearer ${member}` },
  });
  const memberHtml = await refused.text();
  check('journey 7 a member asking for the admin page is told nothing is there',
    refused.status === 404 && memberHtml.includes('That game is not here.'), `${refused.status}`);
}

console.log('');
const ok = summary('Part three');
await pool.end();
process.exit(ok ? 0 : 1);
