import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname ?? '.', '..');
const outDir = path.join(root, 'browser-dist');
const srcDir = path.join(root, 'src', 'browser-src');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'fonts'), { recursive: true });
for (const name of fs.readdirSync(path.join(root, 'fonts'))) {
    fs.copyFileSync(path.join(root, 'fonts', name), path.join(outDir, 'fonts', name));
}
fs.copyFileSync(path.join(srcDir, 'app.css'), path.join(outDir, 'app.css'));
const files = ['api.js', 'dom.js', 'stage.js', 'screens.js', 'app.js'];
let js = '(function(){\n"use strict";\n';
for (const f of files) {
    js += fs.readFileSync(path.join(srcDir, f), 'utf8') + '\n';
}
js += '})();\n';
fs.writeFileSync(path.join(outDir, 'app.js'), js);
console.log('browser-dist written');
