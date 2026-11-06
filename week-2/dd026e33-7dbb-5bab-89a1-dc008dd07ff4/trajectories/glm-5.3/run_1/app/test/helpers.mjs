/**
 * Shared helpers for the API test suite: a cookie client, DB reset and
 * assertions.
 */
import { Client } from 'pg';

export const base = 'http://127.0.0.1:4173';
export const SEED_PASSWORD = 'lacquer-demo-2026';

export async function resetDb() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`TRUNCATE users, owners, cars, bays, belongings, movements, stay_claims,
    condition_reports, photos, care_entries, jobs, job_lines, stages, readings,
    invoices, invoice_lines, transfers, payments, releases, release_events,
    idempotency, queue, sessions RESTART IDENTITY CASCADE`);
  await client.end();
}

export class ClientApi {
  constructor(cookies = new Map()) {
    this.cookies = cookies;
  }

  async raw(method, path, { body, key, headers } = {}) {
    const allHeaders = { ...(headers ?? {}) };
    if (body !== undefined) allHeaders['Content-Type'] = 'application/json';
    if (key) allHeaders['Idempotency-Key'] = key;
    const response = await fetch(`${base}${path}`, {
      method,
      headers: allHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const [pair] = setCookie.split(';');
      const index = pair.indexOf('=');
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    let json = null;
    const text = await response.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: response.status, body: json, headers: response.headers };
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async rawWithCookies(method, path, { body, key, headers, contentType } = {}) {
    const allHeaders = { ...(headers ?? {}), Cookie: this.cookieHeader() };
    if (contentType) allHeaders['Content-Type'] = contentType;
    else if (body !== undefined) allHeaders['Content-Type'] = 'application/json';
    if (key) allHeaders['Idempotency-Key'] = key;
    const response = await fetch(`${base}${path}`, {
      method,
      headers: allHeaders,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: response.status, body: json, headers: response.headers };
  }

  get(path) {
    return this.rawWithCookies('GET', path, {});
  }

  post(path, body, key) {
    return this.rawWithCookies('POST', path, { body, key });
  }

  postHeaders(path, body, headers) {
    return this.rawWithCookies('POST', path, { body, headers });
  }

  patch(path, body, headers) {
    return this.rawWithCookies('PATCH', path, { body, headers });
  }

  put(path, body) {
    return this.rawWithCookies('PUT', path, { body });
  }
}

export async function signIn(email, role) {
  const client = new ClientApi();
  const response = await client.raw('POST', '/api/session', { body: { email, password: SEED_PASSWORD } });
  if (response.status !== 200) {
    throw new Error(`sign in failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  void role;
  return client;
}

export async function killServer() {
  const { readdirSync, readFileSync } = await import('node:fs');
  for (const pid of readdirSync('/proc').filter((entry) => /^[0-9]+$/.test(entry))) {
    try {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (cmdline.includes('dist/server/main.js') && Number(pid) !== process.pid) {
        process.kill(Number(pid), 'SIGTERM');
      }
    } catch {
      // not ours
    }
  }
}

export async function startServer(extraEnv = {}) {
  const { spawn } = await import('node:child_process');
  const { openSync } = await import('node:fs');
  const log = openSync('/tmp/server.log', 'a');
  const child = spawn('node', ['dist/server/main.js'], {
    cwd: '/app',
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, ...extraEnv },
  });
  child.unref();
}

export async function seedViaRestart() {
  // The running server seeds on boot only into an empty database; the tests
  // reset the tables, so the seed needs one more serve start.
  await killServer();
  await new Promise((resolve) => setTimeout(resolve, 900));
  await startServer();
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('server did not come back after restart');
}

let passed = 0;
let failed = 0;
const failures = [];

export function check(name, condition, detail) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(`${name}${detail ? `: ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
    console.log(`FAIL ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
  }
}

export function summary() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('Failures:');
    for (const failure of failures) console.log(` - ${failure}`);
    process.exit(1);
  }
}

export async function mailpitMessages() {
  const response = await fetch('http://mailpit:8025/api/v1/messages?limit=50');
  const body = await response.json();
  return body.messages;
}

export async function mailpitClear() {
  await fetch('http://mailpit:8025/api/v1/messages', { method: 'DELETE' });
}

export async function parallel(count, fn) {
  return Promise.all(Array.from({ length: count }, (unused, index) => fn(index)));
}
