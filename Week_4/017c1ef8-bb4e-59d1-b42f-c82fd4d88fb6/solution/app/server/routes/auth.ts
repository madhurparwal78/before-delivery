import type { FastifyInstance } from 'fastify';
import { clearedSessionCookie, sessionCookie, sessionToken } from '../auth.js';
import { confirmAccount, signIn, signOut, signUp } from '../domain/accounts.js';

interface Credentials {
  email?: unknown;
  password?: unknown;
  name?: unknown;
  handle?: unknown;
  code?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: Credentials | null }>('/api/auth/signup', async (request, reply) => {
    const body = request.body ?? {};
    await signUp({ email: text(body.email).trim(), password: text(body.password), name: text(body.name).trim(), handle: text(body.handle) });
    return reply.status(201).send({ status: 'confirmation_sent' });
  });

  app.post<{ Body: Credentials | null }>('/api/auth/confirm', async (request, reply) => {
    const body = request.body ?? {};
    const session = await confirmAccount(text(body.email).trim(), text(body.code).trim());
    return reply.header('Set-Cookie', sessionCookie(session.token)).send({ member: session.member });
  });

  app.post<{ Body: Credentials | null }>('/api/auth/signin', async (request, reply) => {
    const body = request.body ?? {};
    const session = await signIn(text(body.email).trim(), text(body.password));
    return reply.header('Set-Cookie', sessionCookie(session.token)).send({ member: session.member });
  });

  app.post('/api/auth/signout', async (request, reply) => {
    const token = sessionToken(request);
    if (token) await signOut(token);
    return reply.header('Set-Cookie', clearedSessionCookie).status(204).send();
  });
}
