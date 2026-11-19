/**
 * End-to-end checks over HTTP against the running app.
 * Run with: node test/api.mjs
 */

const BASE = `http://127.0.0.1:${process.env.APP_PUBLIC_PORT}`;
const PASSWORD = 'gambit-demo-pw-2026';

let passed = 0;
let failed = 0;
const failures = [];

export function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

export function equal(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export async function call(method, path, { token, body, headers = {}, raw = false } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let data = text;
  if (!raw) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: response.status, data, headers: response.headers, text };
}

export async function login(username, password = PASSWORD) {
  const out = await call('POST', '/api/auth/login', { body: { email: username, password } });
  if (out.status !== 200) throw new Error(`login for ${username} failed: ${out.status} ${out.text}`);
  return out.data.token;
}

export function summary(label) {
  console.log(`\n${label}: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('Failures:');
    for (const failure of failures) console.log(` - ${failure}`);
  }
  return failed === 0;
}

export { BASE, PASSWORD };
