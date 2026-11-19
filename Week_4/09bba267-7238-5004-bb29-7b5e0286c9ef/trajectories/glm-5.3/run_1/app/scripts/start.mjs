#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const child = spawn('node', ['dist/main.mjs'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
});

const rl = createInterface({ input: child.stdout });
const rlErr = createInterface({ input: child.stderr });
rl.on('line', (line) => process.stdout.write(`${line}\n`));
rlErr.on('line', (line) => process.stderr.write(`${line}\n`));

child.on('exit', (code, signal) => {
  process.exitCode = code !== null ? code : signal ? 1 : 0;
});
