#!/usr/bin/env node
// Restart survival: layout, revision, version, links and collaborator survive a restart.
import { call, setCookie, freshCookie, BASE } from './lib.mjs';

const failures = [];
function check(name, condition, extra) {
  if (condition) console.log(`ok   ${name}`);
  else { console.log(`FAIL ${name} ${extra ? JSON.stringify(extra).slice(0, 300) : ''}`); failures.push(name); }
}

const uniq = String(Math.floor(Date.now() / 1000) % 100000);
await call('POST', '/api/signup', { username: `sv-${uniq}`, password: 'drafting-01' });
let res = await call('POST', '/api/layouts', { name: 'Survival', template: 'dashboard-shell' });
const id = res.json.id;
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: 1, change: { kind: 'set_track', scope: 'base', axis: 'column', index: 1, size: 'minmax(200px, 1fr)' } });
check('change applied', res.status === 200 && res.json.revision === 2, res);
res = await call('POST', `/api/layouts/${id}/versions`, { name: 'checkpoint' });
const versionNumber = res.json.number;
check('version saved', versionNumber === 1, res);
res = await call('POST', `/api/layouts/${id}/view-link`);
const viewPath = res.json.view_path;
res = await call('GET', `/api/layouts/${id}/share`);
const joinPath = res.json.join_path;
check('links exist', Boolean(viewPath) && Boolean(joinPath), { viewPath, joinPath });

console.log('RESTART-REQUIRED', JSON.stringify({ id, viewPath, joinPath, username: `sv-${uniq}` }));
if (failures.length) process.exit(1);
