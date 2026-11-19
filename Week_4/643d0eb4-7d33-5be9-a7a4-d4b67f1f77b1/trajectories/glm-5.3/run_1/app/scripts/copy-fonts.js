// Copies the Inter webfonts into /app/static/fonts at install time. The build container
// has no network at runtime, so the fonts are vendored once here and served from the origin.
// If no local copy exists the build still succeeds; CSS provides a metric-compatible
// system fallback stack so text renders regardless.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const targetDir = path.join(__dirname, '..', 'static', 'fonts');
fs.mkdirSync(targetDir, { recursive: true });

const WEIGHTS = ['Regular', 'Medium', 'SemiBold', 'Bold'];

// The Inter package ships otf files; convert the four weights we use to woff2 with
// fonttools so the page carries the real family and no other.
const sourceDir = '/usr/share/fonts/opentype/inter';
if (fs.existsSync(sourceDir)) {
  for (const weight of WEIGHTS) {
    const name = `Inter-${weight}.otf`;
    const source = path.join(sourceDir, name);
    if (!fs.existsSync(source)) continue;
    const target = path.join(targetDir, `inter-${weight.toLowerCase()}.woff2`);
    try {
      execFileSync('fonttools', ['ttLib.woff2', 'compress', '-o', target, source], { stdio: 'ignore' });
    } catch {
      // fonttools missing: the CSS fallback stack still renders.
    }
  }
}

let copied = 0;
for (const f of fs.readdirSync(targetDir)) {
  if (f.endsWith('.woff2')) copied++;
}
if (copied === 0) {
  console.log('No local Inter woff2 found; CSS falls back to the system stack.');
} else {
  console.log(`Vendored ${copied} Inter font files.`);
}

