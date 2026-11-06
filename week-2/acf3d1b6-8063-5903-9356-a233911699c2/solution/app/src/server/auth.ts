import { Body, Controller, Get, HttpCode, Injectable, Post, Req, Res } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { planOf } from '../shared/catalog.js';
import { checkSignup } from '../shared/rules.js';
import { config } from './config.js';
import { CreditsService } from './credits.js';
import { Database, isUniqueViolation, type Queryable } from './database.js';
import { invalid, refuse } from './errors.js';
import { SESSION_COOKIE, type Member, type SignedInRequest } from './session.js';

const WRONG_CREDENTIALS = 'Email or password is incorrect.';
const SESSION_DAYS = 30;
/** How many signed-in browsers one person keeps; a newer sign in ends the oldest beyond this. */
const SESSIONS_KEPT = 20;

/** Paths that need a signed-in member; checked before any body is read. */
const STUDIO_PATHS = ['/api/me', '/api/projects', '/api/generations', '/api/credits', '/api/team', '/api/auth/logout'];

/** Passwords are stored as bcrypt hashes, never as typed. */
export const hashPassword = (password: string) => bcrypt.hash(password, 10);

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const userJson = (member: Pick<Member, 'id' | 'name' | 'email' | 'role'>) => ({
  id: member.id,
  name: member.name,
  email: member.email,
  role: member.role,
});

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly credits: CreditsService,
  ) {}

  /**
   * Starts a session for the user and returns its bearer token. Only the token's hash is stored, on the user's row,
   * which keeps the user's newest sessions.
   */
  async startSession(client: Queryable, userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await client.query(
      `UPDATE users SET session_hashes = (array_append(session_hashes, $1))[greatest(1, cardinality(session_hashes) + 2 - $3):]
        WHERE id = $2`,
      [hashToken(token), userId, SESSIONS_KEPT],
    );
    return token;
  }

  async memberForToken(token: string): Promise<Member | null> {
    const { rows } = await this.db.query<Member & { workspace_id: string; workspace_name: string; plan: Member['workspace']['plan'] }>(
      `SELECT u.id, u.name, u.email, u.role, w.id AS workspace_id, w.name AS workspace_name, w.plan
         FROM users u
         JOIN workspaces w ON w.id = u.workspace_id
        WHERE u.session_hashes @> ARRAY[$1::text] AND u.removed_at IS NULL`,
      [hashToken(token)],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      workspace: { id: row.workspace_id, name: row.workspace_name, plan: row.plan },
      tokenHash: hashToken(token),
    };
  }

  async signup(body: Record<string, unknown>) {
    const checked = checkSignup(body);
    if (!checked.ok) throw invalid(checked.errors);
    const { name, email, password } = checked.value;
    const passwordHash = await hashPassword(password);
    try {
      return await this.db.transaction(async (client) => {
        const workspace = await client.query<{ id: string }>(
          `INSERT INTO workspaces (name, plan) VALUES ($1, 'free') RETURNING id`,
          [`${name}'s workspace`],
        );
        const workspaceId = workspace.rows[0].id;
        const user = await client.query<{ id: string; name: string; email: string; role: 'owner' }>(
          `INSERT INTO users (workspace_id, name, email, password_hash, role)
           VALUES ($1, $2, $3, $4, 'owner') RETURNING id, name, email, role`,
          [workspaceId, name, email, passwordHash],
        );
        const owner = user.rows[0];
        await this.credits.record(client, {
          workspaceId,
          kind: 'plan',
          amount: planOf('free').credits,
          userId: owner.id,
        });
        await client.query(`INSERT INTO projects (workspace_id, name) VALUES ($1, 'My first project')`, [workspaceId]);
        return { token: await this.startSession(client, owner.id), user: userJson(owner) };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_key')) throw refuse(409, 'email_taken');
      throw error;
    }
  }

  async login(body: Record<string, unknown>) {
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const { rows } = await this.db.query<{ id: string; name: string; email: string; role: 'owner' | 'member'; password_hash: string }>(
      `SELECT id, name, email, role, password_hash FROM users WHERE lower(email) = lower($1) AND removed_at IS NULL`,
      [email],
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw refuse(401, WRONG_CREDENTIALS);
    }
    return { token: await this.startSession(this.db, user.id), user: userJson(user) };
  }

  /** What `/api/me` returns: the person, their workspace and its balance. */
  async profile(member: Member) {
    return {
      user: userJson(member),
      workspace: member.workspace,
      balance: await this.credits.balance(this.db, member.workspace.id),
    };
  }

  async logout(member: Member): Promise<void> {
    await this.db.query('UPDATE users SET session_hashes = array_remove(session_hashes, $1) WHERE id = $2', [
      member.tokenHash,
      member.id,
    ]);
  }

  /** The bearer token from `Authorization`, or else the session cookie the studio pages carry. */
  tokenOf(req: Request): string | null {
    const header = req.headers.authorization;
    if (header !== undefined) {
      const match = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(header);
      return match ? match[1] : null;
    }
    const cookie = req.cookies?.[SESSION_COOKIE];
    return typeof cookie === 'string' && cookie ? cookie : null;
  }

  /** Express middleware: every studio path answers 401 without a live session, before its body is parsed. */
  readonly authenticate = async (req: Request, res: Response, next: NextFunction) => {
    const path = req.path;
    if (!STUDIO_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return next();
    try {
      const token = this.tokenOf(req);
      const member = token ? await this.memberForToken(token) : null;
      if (!member) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      (req as SignedInRequest).member = member;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicUrl.startsWith('https://'),
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('auth/signup')
  async signup(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.signup(body ?? {});
    setSessionCookie(res, result.token);
    return result;
  }

  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(body ?? {});
    setSessionCookie(res, result.token);
    return result;
  }

  @Post('auth/logout')
  @HttpCode(200)
  async logout(@Req() req: SignedInRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.member);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return {};
  }

  @Get('me')
  me(@Req() req: SignedInRequest) {
    return this.auth.profile(req.member);
  }
}
