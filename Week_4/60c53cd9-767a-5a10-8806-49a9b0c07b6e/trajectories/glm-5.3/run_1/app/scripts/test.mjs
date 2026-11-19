// Runs the Playwright suites against a server the script boots itself.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const suites = process.argv.filter((arg) => arg.startsWith('--suite=')).map((arg) => arg.slice('--suite='.length));
const selected = suites.length > 0 ? suites : ['api'];

const results = [];
for (const suite of selected) {
  const prefix = suite === 'api.early' ? 'api.early' : suite;
  const run = spawn('npx', ['playwright', 'test', `../public/spec/${prefix}.spec.ts`, '--config', 'playwright.config.ts'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env },
  });
  const code = await new Promise((resolve) => run.on('close', resolve));
  results.push([suite, code]);
}
const failed = results.filter(([, code]) => code !== 0);
if (failed.length > 0) {
  console.error(`failing suites: ${failed.map(([suite]) => suite).join(', ')}`);
  process.exit(1);
}
console.log('all requested suites passed');
void mkdtempSync;
void tmpdir;
