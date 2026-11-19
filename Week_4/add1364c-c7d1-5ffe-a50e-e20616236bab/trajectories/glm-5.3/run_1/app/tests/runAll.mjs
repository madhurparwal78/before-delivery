#!/usr/bin/env node
/* Full verification: reset the database, boot a fresh server, and run every suite. */

import { spawn } from 'node:child_process';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? '';

async function resetDatabase() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  for (const table of tables.rows) {
    await pool.query(`DROP TABLE IF EXISTS "${table.tablename}" CASCADE`);
  }
  await pool.query('DROP SEQUENCE IF EXISTS row_seq_seq CASCADE');
  await pool.end();
}

// finalchecks asserts the seeded state, so it runs before the mutating journeys suite.
const runSuites = [
  { file: 'tests/finalchecks.mjs', stripTypes: false },
  { file: 'tests/edgeChecks.mjs', stripTypes: false },
  { file: 'tests/flowsCheck.mjs', stripTypes: false },
  { file: 'tests/journeys.mts', stripTypes: true }
];

function run(cmd, stripTypes) {
  return new Promise((resolve) => {
    const args = stripTypes ? ['--experimental-strip-types', cmd] : [cmd];
    const child = spawn('node', args, { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

await resetDatabase();
console.log('== database cleared ==');

const server = spawn('node', ['dist/server.js'], {
  env: { ...process.env, OFFICE_KEY: process.env.OFFICE_KEY ?? 'bl' },
  stdio: ['ignore', 'ignore', 'pipe']
});
server.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

let healthy = false;
for (let attempt = 0; attempt < 60 && !healthy; attempt++) {
  try {
    const res = await fetch('http://localhost:4173/api/health');
    if (res.ok) healthy = true;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
if (!healthy) {
  console.error('server did not become healthy');
  server.kill('SIGKILL');
  process.exit(1);
}
console.log('== server healthy ==');

// wait for seeded sign-in (Keycloak users created, seats confirmed)
let ready = false;
for (let attempt = 0; attempt < 90 && !ready; attempt++) {
  try {
    const res = await fetch('http://localhost:4173/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'marta', password: 'KeysKept-2026' })
    });
    if (res.status === 201) ready = true;
    else await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
if (!ready) {
  console.error('seeded sign-in never became ready');
  server.kill('SIGKILL');
  process.exit(1);
}
console.log('== seeded sign-in ready ==');

let failed = 0;
for (const suite of runSuites) {
  console.log(`\n== ${suite.file} ==`);
  const code = await run(suite.file, suite.stripTypes);
  if (code !== 0) failed += 1;
}

// client render suite, then the timer suite (which needs the same server)
console.log('\n== tests/clientRender.mjs ==');
const clientCode = await run('tests/clientRender.mjs', false);
if (clientCode !== 0) failed += 1;

console.log('\n== tests/timersCheck.mjs ==');
const timersCode = await run('tests/timersCheck.mjs', false);
if (timersCode !== 0) failed += 1;

server.kill('SIGKILL');

// boundary suite: needs its own clock-shifted server
console.log('\n== boundaries ==');
await resetDatabase();
const clockServer = spawn('node', ['dist/server.js'], {
  env: {
    ...process.env,
    OFFICE_KEY: process.env.OFFICE_KEY ?? 'bl',
    APP_PUBLIC_PORT: '4174',
    LOCKSET_CLOCK_START: '2026-11-13T08:00:00-06:00'
  },
  stdio: ['ignore', 'ignore', 'pipe']
});
clockServer.stderr.on('data', (chunk) => process.stderr.write(`[clock] ${chunk}`));
let clockHealthy = false;
for (let attempt = 0; attempt < 60 && !clockHealthy; attempt++) {
  try {
    const res = await fetch('http://localhost:4174/api/health');
    if (res.ok) clockHealthy = true;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
let clockReady = false;
for (let attempt = 0; attempt < 90 && !clockReady; attempt++) {
  try {
    const res = await fetch('http://localhost:4174/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'marta', password: 'KeysKept-2026' })
    });
    if (res.status === 201) clockReady = true;
    else await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
const boundaryCode = await run('tests/boundaries.mjs', false);
if (boundaryCode !== 0) failed += 1;
clockServer.kill('SIGKILL');

console.log(`\n${failed === 0 ? 'ALL SUITES PASSED' : `${failed} SUITES FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
