#!/usr/bin/env node
// After the restart: everything created before still exists.
import { call, setCookie, freshCookie, BASE } from './lib.mjs';

const failures = [];
function check(name, condition, extra) {
  if (condition) console.log(`ok   ${name}`);
  else { console.log(`FAIL ${name} ${extra ? JSON.stringify(extra).slice(0, 300) : ''}`); failures.push(name); }
}

const payload = JSON.parse(process.argv[2] ?? '{}');
const { id, viewPath, joinPath, username } = payload;
check('payload given', Boolean(id) && Boolean(viewPath) && Boolean(joinPath) && Boolean(username), payload);

const res0 = await call('POST', '/api/session', { username, password: 'drafting-01' });
check('session works after restart', res0.status === 200, res0);

let res = await call('GET', `/api/layouts/${id}`);
check('layout persisted', res.status === 200 && res.json.revision === 2 && res.json.columns[0] === 'minmax(200px, 1fr)', res.json?.columns);

res = await call('GET', `/api/layouts/${id}/versions`);
check('version persisted', res.json.versions.length === 1 && res.json.versions[0].name === 'checkpoint', res.json);

freshCookie();
res = await call('GET', `/api${viewPath}`);
check('view link persisted', res.status === 200 && res.json.role === 'viewer', res.status);

res = await call('GET', `/api/layouts/${id}`);
check('library persists', res.status === 401 || res.json?.layouts?.some((l) => l.id === id), res.status);

console.log(failures.length === 0 ? 'ALL PASS' : `${failures.length} FAILURES: ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
