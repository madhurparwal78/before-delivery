import type { FastifyReply } from 'fastify';
import type { AppClock } from './app-clock';
import type { Config } from './config';
import type { Db } from './db';
import type { Mail } from './mail';
import type { Outbox } from './outbox';
import type { Storage } from './storage';

export interface AppServices {
  db: Db;
  clock: AppClock;
  config: Config;
  storage: Storage;
  mail: Mail;
  outbox: Outbox;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: AppServices;
  }
}

/** Manual cookie writes: no extra dependency, same attributes as spec. */
export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.header(
    'Set-Cookie',
    `rimewire_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
  );
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header(
    'Set-Cookie',
    `rimewire_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}
