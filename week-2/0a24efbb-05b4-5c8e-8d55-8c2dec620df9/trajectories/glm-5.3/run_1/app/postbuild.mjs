// Copy the server bootstrap next to the React Router build output so that
// `node build/server.js` serves the desk in production. The bootstrap lives
// one directory deeper in the source tree, so its relative imports are
// rewritten for its new location.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
let src = fs.readFileSync(path.join(root, 'src/server/server.js'), 'utf8');
src = src.replace(/from '(\.\.\/)/g, "from '../src/");
src = src.replace(/from '\.\/(config|readiness|bridge|sessions|api|api2|keycloak|people|calendar|rules)\.js'/g, "from '../src/server/$1.js'");
src = src.replace(/from '\.\/server\/index\.js'/g, "from './server/index.js'");
fs.writeFileSync(path.join(root, 'build/server.js'), src);
console.log('wrote build/server.js');
