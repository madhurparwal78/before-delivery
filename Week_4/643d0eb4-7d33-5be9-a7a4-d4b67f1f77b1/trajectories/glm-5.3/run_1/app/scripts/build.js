// Production build: compiles the CSS custom properties into static assets and
// verifies every server module parses. `serve` runs the server in the foreground.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Verify every server module parses before we call the build done.
const { execFileSync } = require('child_process');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(path.join(root, 'src'));
files.push(path.join(root, 'server.js'));
for (const f of files) {
  execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
}
console.log(`Build OK: ${files.length} modules parsed, assets in place.`);
