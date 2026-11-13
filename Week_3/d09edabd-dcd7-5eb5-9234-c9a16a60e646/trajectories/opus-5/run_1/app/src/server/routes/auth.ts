import { randomUUID } from 'node:crypto';
import { errors } from '../errors.js';
import type { Route } from '../http.js';
import { hashPassword, verifyPassword } from '../domain/passwords.js';
import { clearSessionCookie, requireMember, setSessionCookie } from '../domain/session.js';
import { starterRooms } from '../../shared/starter.js';
import { FieldCollector, asRecord, email, text } from '../domain/validate.js';
import { insertStarterRoom } from '../repo/rooms.js';
import { one, tx } from '../services/db.js';
import { reply } from './support.js';

export const authRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/auth/signup',
    body: 'json',
    async handler(ctx) {
      const body = asRecord(ctx.body);
      const collector = new FieldCollector();
      const address = email(body, 'email', collector);
      const password = text(body, 'password', 10, 200, collector);
      const displayName = text(body, 'displayName', 1, 60, collector);
      const venueName = text(body, 'venueName', 1, 60, collector);
      if (address !== null) {
        const taken = await one<{ id: string }>(`select id from users where email_lower = $1`, [
          address.toLowerCase(),
        ]);
        if (taken) throw errors.emailTaken();
      }
      collector.throwIfAny();
      const workspaceId = randomUUID();
      const userId = randomUUID();
      const hash = await hashPassword(password as string);
      await tx(async (client) => {
        await client.query(`insert into workspaces (id, name) values ($1, $2)`, [
          workspaceId,
          venueName,
        ]);
        await client.query(
          `insert into users (id, workspace_id, email, email_lower, password_hash,
             display_name, role)
           values ($1,$2,$3,$4,$5,$6,'owner')`,
          [userId, workspaceId, address, (address as string).toLowerCase(), hash, displayName],
        );
        for (const room of starterRooms) {
          await insertStarterRoom(client, workspaceId, room);
        }
      });
      setSessionCookie(ctx.res, userId);
      return reply(201, {
        user: { id: userId, email: address, displayName, role: 'owner' },
        workspace: { id: workspaceId, name: venueName },
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/login',
    body: 'json',
    async handler(ctx) {
      const body = asRecord(ctx.body);
      const address = typeof body.email === 'string' ? body.email : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const row = await one<{
        id: string;
        email: string;
        display_name: string;
        role: 'owner' | 'co_designer';
        password_hash: string;
      }>(
        `select id, email, display_name, role, password_hash from users where email_lower = $1`,
        [address.trim().toLowerCase()],
      );
      if (!row || !(await verifyPassword(password, row.password_hash))) {
        throw errors.invalidCredentials();
      }
      setSessionCookie(ctx.res, row.id);
      return {
        user: {
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          role: row.role,
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/logout',
    body: 'none',
    handler(ctx) {
      clearSessionCookie(ctx.res);
      return undefined;
    },
  },
  {
    method: 'GET',
    pattern: '/api/me',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      return {
        user: {
          id: member.id,
          email: member.email,
          displayName: member.displayName,
          role: member.role,
        },
        workspace: { id: member.workspaceId, name: member.workspaceName },
      };
    },
  },
];
