/**
 * Browser bundle builder. Compiles the client to CommonJS then wraps each module
 * in a registry so public/app.js needs no bundler dependency at runtime.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

execSync('npx tsc -p tsconfig.client.json', { stdio: 'inherit' });

const OUT = path.join('buildclient');
const modules = new Map();

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

for (const file of walk(OUT)) {
  const rel = path.relative(OUT, file).replace(/\\/g, '/').replace(/\.js$/, '');
  modules.set(rel, fs.readFileSync(file, 'utf8'));
}

const wanted = [...modules.keys()].filter(k => k.startsWith('client/') || k.startsWith('shared/'));
let bundle = '(function(){\n';
bundle += 'var __registry = {};\n';
bundle += 'function __define(name, fn){ __registry[name] = fn; }\n';
bundle += 'function __require(name){\n';
bundle += '  if (__registry[name]) {\n';
bundle += '    if (__registry[name].cache) return __registry[name].cache.exports;\n';
bundle += '    var mod = { exports: {} };\n';
bundle += '    __registry[name].cache = mod;\n';
bundle += '    __registry[name](mod.exports, __require, mod, name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "");\n';
bundle += '    return mod.exports;\n';
bundle += '  }\n';
bundle += "  if (name === 'react' || name.startsWith('node:') || !name.startsWith('.')) return {};\n";
bundle += '  var resolved = __resolve(name);\n';
bundle += '  if (!resolved) throw new Error("module not found: " + name);\n';
bundle += '  return __require(resolved);\n';
bundle += '}\n';
bundle += 'function __resolve(name){\n';
bundle += '  return null;\n';
bundle += '}\n';

const order = [...wanted].sort((a, b) => (a.startsWith('shared') ? -1 : 0) - (b.startsWith('shared') ? -1 : 0));
for (const name of order) {
  const src = modules.get(name);
  const dir = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
  const wrapped = `(function(exports, require, module, dir){\nvar __req = function(n){\n  if (n.startsWith('.')) {\n    var parts = (n.startsWith('/') ? n.slice(1) : (dir ? dir + '/' : '') + n).split('/');\n    var stack = [];\n    for (var p of parts) {\n      if (p === '' ) continue;\n      if (p === '.') continue;\n      if (p === '..') { stack.pop(); continue; }\n      stack.push(p);\n    }\n    n = stack.join('/');\n  }\n  return require(n);\n};\n${src.replace(/require\(/g, '__req(')}\n})`;
  bundle += `__define(${JSON.stringify(name)}, ${wrapped});\n`;
}
bundle += '__require("client/main");\n';
bundle += '})();\n';

fs.mkdirSync('public', { recursive: true });
fs.writeFileSync(path.join('public', 'app.js'), bundle);
console.log('bundled', order.length, 'modules into public/app.js');
