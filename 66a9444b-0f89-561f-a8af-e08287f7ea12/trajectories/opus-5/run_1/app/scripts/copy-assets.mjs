import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist/server/db', { recursive: true });
await cp('src/server/db/schema.sql', 'dist/server/db/schema.sql');
