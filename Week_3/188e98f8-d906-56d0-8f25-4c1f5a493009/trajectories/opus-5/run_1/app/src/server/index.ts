/** Boot: apply the schema and seed, make sure the bucket is there, then serve. */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './api.js';
import type { App } from './app.js';
import { readConfig } from './config.js';
import { applySchemaAndSeed, openDb } from './db.js';
import { startNoteRetries } from './disputes.js';
import { failureReply, sendReply } from './http.js';
import { MailSink } from './mail.js';
import { servePage } from './pages.js';
import { settleRounds } from './rounds.js';
import { readSession } from './sessions.js';
import { SheetStore } from './storage.js';

const NOTE_RETRY_MS = 10_000;
const SETTLE_MS = 1000;

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

async function main(): Promise<void> {
  const config = readConfig();
  const { db } = openDb(config.databaseUrl);
  const store = new SheetStore(config.s3);
  const mail = new MailSink(config.smtpHost, config.smtpPort, config.mailFrom);
  let ready = false;

  const app: App = { config, db, store, mail, ready: () => ready };

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void answer(app, request, response);
  });
  server.listen(config.port, '0.0.0.0');

  while (!ready) {
    try {
      await applySchemaAndSeed(db);
      ready = true;
    } catch {
      await new Promise((wait) => setTimeout(wait, 1000));
    }
  }

  await store.ensureBucket().catch(() => {
    /* storage may be unreachable at boot; sheet uploads then answer 503 */
  });

  startNoteRetries(db, mail, NOTE_RETRY_MS);
  const settle = setInterval(() => {
    void settleRounds(db).catch(() => {
      /* the next turn closes the round */
    });
  }, SETTLE_MS);
  settle.unref();
}

async function answer(app: App, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    try {
      sendReply(request, response, await handleApi(app, request, url));
    } catch (failure) {
      sendReply(request, response, failureReply(failure));
    }
    return;
  }
  const session = app.ready() ? await readSession(app.db, request.headers.cookie) : null;
  await servePage({ publicDir }, request, response, url.pathname, session);
}

await main();
