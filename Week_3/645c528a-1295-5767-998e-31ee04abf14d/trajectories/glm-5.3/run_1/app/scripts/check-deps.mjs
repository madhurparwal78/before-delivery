#!/usr/bin/env node
// Verifies runtime dependencies so a broken environment is reported, never silently skipped.
import { access } from 'node:fs/promises';
for (const name of ['pg', 'nodemailer']) {
  try {
    await access(new URL(`../node_modules/${name}/package.json`, import.meta.url));
  } catch {
    console.warn(`warning: package ${name} is not installed; the server will report the matching service as unreachable`);
  }
}
