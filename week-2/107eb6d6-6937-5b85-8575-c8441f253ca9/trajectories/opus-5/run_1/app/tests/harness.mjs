import pg from 'pg';
import { applySeed } from '../src/seed.js';

export const BASE = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:4173';
export const PASSWORD = 'deku-demo-pw-2026';

const results = { passed: 0, failed: [] };

export function check(name, condition, detail = '') {
  if (condition) {
    results.passed += 1;
  } else {
    results.failed.push(`${name}${detail ? ` :: ${detail}` : ''}`);
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ''}`);
  }
}

export const equal = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

export function summary() {
  console.log(`\n${results.passed} checks passed, ${results.failed.length} failed`);
  for (const failure of results.failed) console.log(`  - ${failure}`);
  return results.failed.length === 0;
}

export async function resetDatabase() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(
    'TRUNCATE members, sessions, sign_in_attempts, trucks, logistics_requests, stops, assignments, activity RESTART IDENTITY CASCADE'
  );
  await applySeed(client);
  await client.end();
}

export async function api(path, { method = 'GET', token, body, headers = {}, raw = false } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.authorization = `Bearer ${token}`;
  if (body !== undefined) {
    init.headers['content-type'] = init.headers['content-type'] ?? 'application/json';
    init.body = raw ? body : JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, body: json, text };
}

export async function login(email, password = PASSWORD) {
  const response = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  return response.body?.token;
}

export async function page(path, { cookie, method = 'GET', body, headers = {} } = {}) {
  const init = { method, headers: { ...headers }, redirect: 'manual' };
  if (cookie) init.headers.cookie = cookie;
  if (body !== undefined) {
    init.headers['content-type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(body).toString();
  }
  const response = await fetch(`${BASE}${path}`, init);
  return { status: response.status, headers: response.headers, text: await response.text() };
}

export async function pageLogin(email, password = PASSWORD) {
  const response = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password }).toString(),
    redirect: 'manual'
  });
  const setCookie = response.headers.get('set-cookie') ?? '';
  return setCookie.split(';')[0];
}

export const stopsPayload = (overrides = {}) => ({
  pickup: {
    date: '2026-04-10',
    address: '12 Quarry Lane',
    city: 'Ottawa',
    region: 'ON',
    postal_code: 'K1A 0B1',
    country: 'Canada',
    ...(overrides.pickup ?? {})
  },
  delivery: {
    date: '2026-04-11',
    address: '40 Arena Way',
    city: 'Toronto',
    region: 'ON',
    postal_code: 'M5V 2T6',
    country: 'Canada',
    ...(overrides.delivery ?? {})
  },
  first_show: {
    date: '2026-04-12',
    address: '40 Arena Way',
    city: 'Toronto',
    region: 'ON',
    postal_code: 'M5V 2T6',
    country: 'Canada',
    ...(overrides.first_show ?? {})
  },
  last_show: {
    date: '2026-04-30',
    address: '9 Riverside Drive',
    city: 'Chicago',
    region: 'IL',
    postal_code: '60601',
    country: 'USA',
    ...(overrides.last_show ?? {})
  }
});

export const requestPayload = (overrides = {}) => ({
  tour_name: 'Midnight Static spring tour',
  transport_type: 'tour',
  trucks_requested: 2,
  stops: stopsPayload(),
  ...overrides
});
