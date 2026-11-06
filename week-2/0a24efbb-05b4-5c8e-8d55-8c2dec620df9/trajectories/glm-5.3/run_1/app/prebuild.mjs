// Keeps the build directory tidy before a fresh build.
import fs from 'node:fs';
fs.rmSync('build', { recursive: true, force: true });
