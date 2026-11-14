import http from 'node:http';
import { config } from './config.ts';
import { applySchema, checkPostgres } from './db.ts';
import { registerOwnerRoutes } from './owner.ts';
import { registerGradingRoutes } from './grading.ts';
import { currentSession, signIn, signOut, signUp } from './auth.ts';
import { dispatchApi, route, sendJson } from './http.ts';
import { internalError } from './errors.ts';
import { servePage } from './pages.ts';
import { acceptUpgrade } from './socket.ts';
import { checkValkey, startValkey } from './valkey.ts';
import { checkMinio } from './s3.ts';
import { checkMailpit } from './smtp.ts';
import { startOutbox } from './outbox.ts';
import { followClock, loadClock } from './time.ts';
import { handleChannel, keepPresenceAlive } from './hub.ts';
import { followFormStates } from './lifecycle.ts';
import {
  backPage, commitAnswers, getResponse, nextPage, publicForm, resume, saveForLater, startResponse,
} from './respondent.ts';
import { submit } from './submit.ts';
import { putFile, removeFile } from './uploads.ts';

// One Node server serves the API, the /ws socket, the browser client and the font on one port.

const SERVICE_CACHE_MS = 2_000;
let services: { at: number; value: Record<string, 'up' | 'down'> } | null = null;

async function serviceStates(): Promise<Record<string, 'up' | 'down'>> {
  if (services && Date.now() - services.at < SERVICE_CACHE_MS) return services.value;
  const [postgres, valkey, minio, mailpit] = await Promise.all([checkPostgres(), checkValkey(), checkMinio(), checkMailpit()]);
  const word = (up: boolean): 'up' | 'down' => (up ? 'up' : 'down');
  const value = { postgres: word(postgres), valkey: word(valkey), minio: word(minio), mailpit: word(mailpit) };
  services = { at: Date.now(), value };
  return value;
}

function registerRoutes(): void {
  route('GET', '/api/health', async (ctx) => sendJson(ctx, 200, { status: 'ok' }));
  route('GET', '/api/services', async (ctx) => sendJson(ctx, 200, await serviceStates()));
  route('POST', '/api/account', signUp);
  route('POST', '/api/session', signIn);
  route('GET', '/api/session', currentSession);
  route('DELETE', '/api/session', signOut);
  registerOwnerRoutes();
  registerGradingRoutes();
  route('GET', '/api/f/:slug', publicForm);
  route('POST', '/api/f/:slug/responses', startResponse);
  route('GET', '/api/responses/:id', getResponse);
  route('POST', '/api/responses/:id/answers', commitAnswers);
  route('POST', '/api/responses/:id/next', nextPage);
  route('POST', '/api/responses/:id/back', backPage);
  route('POST', '/api/responses/:id/save', saveForLater);
  route('POST', '/api/responses/:id/submit', submit);
  route('PUT', '/api/responses/:id/files/:key', putFile, { body: 'raw', limit: config.uploadMaxBytes + 1, truncate: true });
  route('DELETE', '/api/responses/:id/files/:key', removeFile);
  route('POST', '/api/resume/:token', resume);
}

registerRoutes();

let booted: Promise<void> = Promise.resolve();

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const handle = async (): Promise<void> => {
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname !== '/api/health') await booted;
      return dispatchApi(req, res, url);
    }
    await booted;
    return servePage(req, res, url.pathname);
  };
  handle().catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(internalError().toBody()));
  });
});
server.on('upgrade', (req, socket, head) => { void booted.then(() => acceptUpgrade(req, socket, head)); });

// Bind first so health answers while Postgres is still being waited for; the services connect after.
server.listen(config.port, '0.0.0.0', () => {
  booted = (async () => {
    await applySchema();
    await loadClock();
    followClock();
    startValkey(handleChannel);
    startOutbox();
    keepPresenceAlive();
    followFormStates();
  })();
});
