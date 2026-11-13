import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as pg from 'pg';
import { loadConfig } from './config';
import { BroadcastHub } from './hub';
import { PocketBaseClient } from './pocketbase';
import { StorageClient } from './storage';
import { seedDatabase } from './seedRunner';
import { Accounts, OPERATOR_EMAIL, OPERATOR_PASSWORD, OPERATOR_TEAM_NAME } from './accounts';
import { findRoute } from './routes';
import { buildContext, serializeSessionCookie, SESSION_COOKIE } from './httpKernel';
import { sendJson, sendError } from './respond';
import { fetchUndelivered, markDelivered } from './noticeOutbox';
import { lockGameweek, snapshotKey } from './gameweeks';
import { fetchGameweekLive } from './routes';
import { createSession, deleteSession } from './sessions';
import { ApiError, validationError } from './errors';

const CLIENT_ROUTES = ['/', '/signin', '/team', '/transfers', '/leagues', '/history', '/operator'];
const CLIENT_ASSET_DIR = path.join(process.cwd(), 'public');

async function waitForPostgres(connectionString: string): Promise<pg.Pool> {
  const deadline = Date.now() + 60000;
  for (;;) {
    const pool = new pg.Pool({ connectionString, max: 10 });
    try {
      await pool.query('SELECT 1');
      return pool;
    } catch {
      await pool.end().catch(() => undefined);
      if (Date.now() > deadline) {
        console.error('Postgres did not become reachable within 60 seconds.');
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = await waitForPostgres(config.databaseUrl);
  await seedDatabase(pool);

  const hub = new BroadcastHub();
  const pocketbase = new PocketBaseClient(config);
  const storage = new StorageClient(config);
  const accounts = new Accounts(pool, pocketbase, storage, hub);

  const publicOrigin = new URL(config.publicUrl);

  let pocketbaseReady = false;
  let storageReady = false;
  const bootPocketbase = async (): Promise<void> => {
    try {
      await pocketbase.ensureNoticesCollection();
      await accounts.ensureOperatorAccount();
      pocketbaseReady = true;
    } catch {
      pocketbaseReady = false;
    }
  };
  const bootStorage = async (): Promise<void> => {
    try {
      await storage.createBucketIfMissing();
      storageReady = true;
    } catch {
      storageReady = false;
    }
  };
  void bootPocketbase();
  void bootStorage();

  const deliverNotices = async (): Promise<void> => {
    if (!pocketbaseReady) return;
    const pending = await fetchUndelivered(pool, 50);
    for (const row of pending) {
      try {
        await pocketbase.createNotice({
          manager: row.pocketbase_user_id,
          kind: row.kind,
          gameweek: row.gameweek,
          message: row.message,
        });
        await markDelivered(pool, row.id, row.pocketbase_user_id);
        hub.broadcastToManagers({
          notice: {
            id: `${row.id}:${Date.now()}`,
            kind: row.kind,
            gameweek: row.gameweek,
            message: row.message,
            read: false,
            created: new Date().toISOString(),
          },
        });
      } catch {
        await bootPocketbase();
        return;
      }
    }
  };

  const deliverSnapshots = async (): Promise<void> => {
    const { rows } = await pool.query<{ manager_id: string; team_name: string; gameweek: number }>(
      `SELECT lt.manager_id, m.team_name, lt.gameweek
         FROM locked_teams lt JOIN managers m ON m.id = lt.manager_id
        WHERE lt.receipt = 'pending'
        ORDER BY lt.gameweek, lt.manager_id
        LIMIT 50`,
    );
    for (const row of rows) {
      const storedAlready = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM locked_teams WHERE manager_id = $1 AND gameweek = $2 AND receipt = 'stored'",
        [row.manager_id, row.gameweek],
      );
      if (storedAlready.rows[0].count !== '0') continue;
      try {
        const contents = await pool.query<{ starting: string[]; bench: string[]; captain: string | null; vice_captain: string | null; chip: string | null; bank_tenths: number; squad: unknown; locked_at: Date }>(
          'SELECT starting, bench, captain, vice_captain, chip, bank_tenths, squad, locked_at FROM locked_teams WHERE manager_id = $1 AND gameweek = $2',
          [row.manager_id, row.gameweek],
        );
        const row2 = contents.rows[0];
        const payload = JSON.stringify({
          gameweek: row.gameweek,
          manager_id: row.manager_id,
          team_name: row.team_name,
          locked_at: row2.locked_at.toISOString(),
          starting: row2.starting,
          bench: row2.bench,
          captain: row2.captain,
          vice_captain: row2.vice_captain,
          chip: row2.chip,
          bank_tenths: row2.bank_tenths,
          squad: row2.squad,
        }, null, 2);
        await storage.put(snapshotKey(row.gameweek, row.manager_id), payload);
        await pool.query(
          "UPDATE locked_teams SET receipt = 'stored' WHERE manager_id = $1 AND gameweek = $2 AND receipt = 'pending'",
          [row.manager_id, row.gameweek],
        );
        hub.broadcastToManagers({ receipt: { manager_id: row.manager_id, gameweek: row.gameweek, receipt: 'stored' } });
      } catch {
        return;
      }
    }
  };

  const ensureLocked = async (): Promise<void> => {
    const current = await fetchGameweekLive(pool);
    if (current === null) return;
    if (current.status !== 'open' || current.deadline === null) return;
    if (Date.now() < current.deadline.getTime()) return;
    await lockGameweek(pool, current.number, hub);
    await deliverSnapshots();
  };

  const ensureStarted = async (): Promise<void> => {
    const current = await fetchGameweekLive(pool);
    if (current === null || current.status !== 'locked') return;
    const fixtures = await pool.query<{ kickoff: Date }>(
      'SELECT kickoff FROM fixtures WHERE gameweek = $1 ORDER BY kickoff LIMIT 1',
      [current.number],
    );
    if (fixtures.rows.length === 0) return;
    if (Date.now() < fixtures.rows[0].kickoff.getTime()) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const status = await client.query<{ status: string }>('SELECT status FROM gameweeks WHERE number = $1 FOR UPDATE', [current.number]);
      if (status.rows[0].status === 'locked') {
        await client.query("UPDATE gameweeks SET status = 'live' WHERE number = $1", [current.number]);
      }
      await client.query('COMMIT');
      hub.broadcastToManagers({ gameweekStatus: { number: current.number, status: 'live' } });
    } catch {
      await client.query('ROLLBACK').catch(() => undefined);
    } finally {
      client.release();
    }
  };

  setInterval(() => {
    void ensureLocked().catch(() => undefined);
    void ensureStarted().catch(() => undefined);
  }, 1000);
  setInterval(() => {
    if (!pocketbaseReady) void bootPocketbase();
    void deliverNotices();
  }, 2000);
  setInterval(() => {
    if (!storageReady) void bootStorage();
    void deliverSnapshots();
  }, 5000);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', publicOrigin);
      if (url.pathname.startsWith('/api/')) {
        const found = findRoute(req.method ?? 'GET', url.pathname);
        if (found === null) {
          sendJson(res, 404, { error: 'not_found', message: 'Nothing lives at this address.' });
          return;
        }
        const ctx = await buildContext(req, res, pool, publicOrigin);
        if (url.pathname === '/api/auth/signup' || url.pathname === '/api/auth/signin') {
          try {
            const result = await handleAuth(url.pathname, ctx.body, accounts, pool);
            res.setHeader('Set-Cookie', serializeSessionCookie(result.sessionId));
            sendJson(res, result.status, result.body);
          } catch (error) {
            sendError(res, error);
          }
          return;
        }
        if (url.pathname === '/api/auth/signout') {
          const cookieHeader = req.headers.cookie ?? '';
          const match = /elevens_session=([^;]+)/.exec(cookieHeader);
          if (match !== null) {
            const client = await pool.connect();
            try {
              await deleteSession(client, match[1]);
            } finally {
              client.release();
            }
          }
          res.setHeader('Set-Cookie', serializeSessionCookie(null));
          sendJson(res, 204, undefined);
          return;
        }
        try {
          const result = await found.handler(ctx, { pool, hub, storage, pocketbase }, found.params);
          if (result.raw !== undefined) {
            res.writeHead(result.status, {
              'Content-Type': 'application/json',
              'Content-Disposition': `attachment; filename="${result.raw.filename}"`,
              'Cache-Control': 'no-store',
              ...result.headers,
            });
            res.end(result.raw.bytes);
            return;
          }
          sendJson(res, result.status, result.body, result.headers);
        } catch (error) {
          sendError(res, error);
        }
        return;
      }
      if (url.pathname === '/healthz') {
        sendJson(res, 200, { status: 'ok' });
        return;
      }
      serveClient(res, url.pathname);
    } catch (error) {
      sendError(res, error);
    }
  });

  hub.attach(server);
  server.listen(config.publicPort, '0.0.0.0', () => {
    console.log(`Elevens serving on 0.0.0.0:${config.publicPort}`);
  });
}

interface AuthOutcome {
  status: number;
  body: unknown;
  sessionId: string;
}

async function handleAuth(pathname: string, body: unknown, accounts: Accounts, pool: pg.Pool): Promise<AuthOutcome> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'validation', 'Send a JSON object.', { fields: { body: 'Send a JSON object.' } });
  }
  const record = body as Record<string, unknown>;
  const email = typeof record.email === 'string' ? record.email.trim() : '';
  const password = typeof record.password === 'string' ? record.password : '';
  const client = await pool.connect();
  let accountId: string;
  let teamName: string;
  let role: 'manager' | 'operator' = 'manager';
  let status: number;
  let emailOut = email;
  try {
    if (pathname === '/api/auth/signup') {
      const name = typeof record.team_name === 'string' ? record.team_name.trim() : '';
      const fields: Record<string, string> = {};
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.email = 'Send a valid email address.';
      if (password.length < 10 || password.length > 72) fields.password = 'Send a password of 10 to 72 characters.';
      if (name.length < 3 || name.length > 30) fields.team_name = 'Send a team name of 3 to 30 characters.';
      if (Object.keys(fields).length > 0) throw validationError(fields);
      try {
        const account = await accounts.signUp(email, password, name);
        accountId = account.id;
        teamName = account.team_name;
        status = 201;
      } catch (error) {
        if (error instanceof Error && (error as Error & { code?: string }).code === 'email_taken') {
          throw new ApiError(409, 'email_taken', 'An account with this email already exists.');
        }
        if (error instanceof ApiError && error.body.error === 'validation') {
          throw new ApiError(422, 'validation', 'Some fields need a second look.', { fields: error.body.fields });
        }
        throw error;
      }
    } else {
      try {
        const account = await accounts.signIn(email, password);
        accountId = account.id;
        teamName = account.team_name;
        role = account.role;
        emailOut = account.email;
        status = 200;
      } catch {
        throw new ApiError(401, 'bad_credentials', 'Email or password is wrong.');
      }
    }
    const sessionId = await createSession(client, accountId);
    void teamName;
    return { status, body: { id: accountId, email: emailOut, team_name: teamName, role }, sessionId };
  } finally {
    client.release();
  }
}

function serveClient(res: http.ServerResponse, pathname: string): void {
  if (pathname.startsWith('/assets/') || pathname.startsWith('/fonts/')) {
    const filePath = path.join(CLIENT_ASSET_DIR, pathname);
    if (!filePath.startsWith(CLIENT_ASSET_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', message: 'Nothing lives at this address.' }));
      return;
    }
    const ext = path.extname(filePath);
    const types: Record<string, string> = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.ttf': 'font/ttf',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
    };
    res.writeHead(200, {
      'Content-Type': types[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  if (CLIENT_ROUTES.includes(pathname)) {
    const index = path.join(CLIENT_ASSET_DIR, 'index.html');
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
      res.end(fs.readFileSync(index, 'utf8'));
      return;
    }
  }
  if (pathname.startsWith('/leagues/')) {
    const index = path.join(CLIENT_ASSET_DIR, 'index.html');
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
      res.end(fs.readFileSync(index, 'utf8'));
      return;
    }
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found', message: 'Nothing lives at this address.' }));
}

void main();
