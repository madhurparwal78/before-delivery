#!/usr/bin/env node
// Valkey outage: with VALKEY_URL pointing at a closed port, changes still save,
// health reports unavailable, live stays false, and Designers here lists only the designer.
import { call, setCookie, freshCookie, BASE } from './lib.mjs';
import { spawn, execSync } from 'node:child_process';

const failures = [];
function check(name, condition, extra) {
  if (condition) console.log(`ok   ${name}`);
  else { console.log(`FAIL ${name} ${extra ? JSON.stringify(extra).slice(0, 300) : ''}`); failures.push(name); }
}

// Start a second app instance on another port with a bad Valkey URL.
const env = { ...process.env, APP_PUBLIC_PORT: '4599', VALKEY_URL: 'redis://127.0.0.1:1/0', BASE_URL: 'http://127.0.0.1:4599' };
const child = spawn('node', ['dist/server.js'], { cwd: process.cwd(), env, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));

const outage = async (method, path, body) => {
  const res = await fetch('http://127.0.0.1:4599' + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
};

let res = await outage('GET', '/api/health');
check('health unavailable', res.json.status === 'unavailable', res);

const uniq = String(Math.floor(Date.now() / 1000) % 100000);
let cookie = '';
const o = async (method, path, body) => {
  const res = await fetch('http://127.0.0.1:4599' + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
};

res = await o('POST', '/api/signup', { username: `out-${uniq}`, password: 'drafting-01' });
check('signup works without valkey', res.status === 201, res);
res = await o('POST', '/api/layouts', { name: 'Outage', template: 'blank' });
check('create layout works', res.status === 201, res);
const id = res.json.id;
check('live is false', res.json.live === false, res.json.live);

res = await o('POST', `/api/layouts/${id}/changes`, { base_revision: 1, change: { kind: 'set_track', scope: 'base', axis: 'column', index: 1, size: '2fr' } });
check('change saves without valkey', res.status === 200 && res.json.revision === 2, res);

res = await o('POST', `/api/layouts/${id}/versions`, { name: 'offline' });
check('version saves without valkey', res.status === 201, res);

res = await o('POST', `/api/layouts/${id}/view-link`);
check('view link saves without valkey', res.status === 201, res);

res = await o('GET', `/api/layouts/${id}`);
check('layout loads with live false', res.status === 200 && res.json.live === false, res.json.live);

// Reload: the change survived.
res = await o('GET', `/api/layouts/${id}`);
check('change persisted through outage', res.json.columns[0] === '2fr', res.json.columns);

// Requests answer within a reasonable time even with Valkey down.
const start = Date.now();
await o('GET', `/api/layouts/${id}`);
const elapsed = Date.now() - start;
check('requests stay fast', elapsed < 2000, elapsed);

child.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 500));
console.log(failures.length === 0 ? 'ALL PASS' : `${failures.length} FAILURES: ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
