import { spawn } from 'node:child_process';
import { check, summary } from './harness.mjs';

const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn('node', ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: {
    ...process.env,
    APP_PUBLIC_PORT: String(PORT),
    DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:5999/missing'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

const ready = await new Promise((resolve) => {
  const started = Date.now();
  const poll = setInterval(async () => {
    try {
      const response = await fetch(`${BASE}/api/health`);
      clearInterval(poll);
      resolve(response);
    } catch {
      if (Date.now() - started > 15000) {
        clearInterval(poll);
        resolve(null);
      }
    }
  }, 400);
});

check('the server listens even though the database is unreachable', ready !== null);
if (ready) {
  check('health answers 503 unavailable', ready.status === 503);
  const body = await ready.json();
  check('health body', JSON.stringify(body) === JSON.stringify({ status: 'unavailable' }), JSON.stringify(body));

  const apiCall = await fetch(`${BASE}/api/requests`, { headers: { authorization: 'Bearer anything' } });
  const apiBody = await apiCall.json();
  check('API answers 503 with the desk copy', apiCall.status === 503 &&
    apiBody.error === 'unavailable' &&
    apiBody.message === 'The desk cannot reach its records right now. Try again shortly.',
    `${apiCall.status} ${JSON.stringify(apiBody)}`);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'deku-demo-pw-2026' })
  });
  check('login answers 503 while the records are out of reach', login.status === 503, String(login.status));

  const pageCall = await fetch(`${BASE}/requests`, { redirect: 'manual' });
  const pageText = await pageCall.text();
  check('a full page renders the 503 message', pageCall.status === 503 &&
    pageText.includes('The desk cannot reach its records right now. Try again shortly.'),
    `${pageCall.status}`);

  const signInPage = await fetch(`${BASE}/login`);
  check('the sign-in page still renders', signInPage.status === 200);
}

server.kill();
process.exit(summary() ? 0 : 1);
