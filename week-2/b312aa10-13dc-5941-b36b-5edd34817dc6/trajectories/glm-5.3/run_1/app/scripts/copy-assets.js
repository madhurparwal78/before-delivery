import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const dist = resolve(root, 'dist', 'server');
mkdirSync(dist, { recursive: true });

// The server serves /app.css from public; a placeholder is replaced by the client build.
const publicDir = resolve(root, 'public');
mkdirSync(publicDir, { recursive: true });
const appCss = resolve(publicDir, 'app.css');
if (!existsSync(appCss)) {
  copyFileSync(resolve(root, 'src', 'client', 'app.css'), appCss);
}
console.log('assets ready');
