import { copyFileSync, existsSync, mkdirSync, cpSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
copyFileSync(`${root}src/db/schema.sql`, `${root}dist/db/schema.sql`);

const src = `${root}public`;
const dst = `${root}dist/public`;
if (existsSync(src)) {
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
}
console.log('build-ui done');
