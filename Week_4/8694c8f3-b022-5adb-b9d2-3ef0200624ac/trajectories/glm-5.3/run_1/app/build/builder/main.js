// Bundles the UI from ui/main.ts into build/public/app.js plus the HTML, CSS,
// fonts and GLSL sources, without a runtime bundler. Each returned entry is one
// output file: `in` is the source path relative to the UI root, `out` is the
// output path relative to the public directory, and `read()` returns its bytes.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import * as ts from 'typescript';
const TARGET = ts.ScriptTarget.ES2022;
const ASSET_FILES = [
    'index.html',
    'style.css',
    'favicon.svg',
    'fonts/Arimo-Regular.ttf',
    'fonts/PTSans-Regular.ttf',
    'fonts/PTSans-Bold.ttf',
    'fonts/JetBrainsMono-Regular.ttf',
];
export async function build(options) {
    const rootDir = options.rootDir;
    const read = (inPath) => readFile(rootDir + '/' + inPath);
    const code = await new Bundler(rootDir).run(rootDir + '/main.ts');
    const files = ASSET_FILES.map((inPath) => ({ in: inPath, out: inPath, read: () => read(inPath) }));
    files.push({ in: 'main.ts', out: 'app.js', read: async () => Buffer.from(code, 'utf8') });
    return files;
}
// Bundles the module graph into one file: a CommonJS-style registry with a
// require shim, so the browser needs no module loading at runtime.
class Bundler {
    rootDir;
    compiled = new Map();
    order = [];
    visiting = new Set();
    constructor(rootDir) {
        this.rootDir = rootDir;
    }
    async run(entryPath) {
        await this.visit(entryPath);
        const factories = [];
        for (const path of this.order) {
            factories.push('__define(' + JSON.stringify(this.specFor(path)) + ', function (require, module, exports) {\n' + (this.compiled.get(path) ?? '') + '\n});');
        }
        return 'const __registry = new Map();\n'
            + 'const __cache = new Map();\n'
            + 'function __define (spec, factory) { __registry.set(spec, factory); }\n'
            + 'function __require (spec) {\n'
            + '  const cached = __cache.get(spec);\n'
            + '  if (cached !== undefined) return cached.exports;\n'
            + '  const factory = __registry.get(spec);\n'
            + '  if (factory === undefined) throw new Error("Module not found: " + spec);\n'
            + '  const module = { exports: {} };\n'
            + '  __cache.set(spec, module);\n'
            + '  factory(__require, module, module.exports);\n'
            + '  return module.exports;\n'
            + '}\n'
            + factories.join('\n') + '\n'
            + '__require(' + JSON.stringify(this.specFor(entryPath)) + ');\n';
    }
    // The canonical id keeps the .js extension of the import specifier, so the
    // transpiled require() calls line up with the registry keys.
    specFor(path) {
        let rel = path.slice(this.rootDir.length);
        if (rel.startsWith('/'))
            rel = rel.slice(1);
        return rel.endsWith('.ts') ? rel.slice(0, -3) + '.js' : rel;
    }
    async visit(path) {
        if (this.order.includes(path))
            return;
        if (this.visiting.has(path))
            throw new Error('Circular import: ' + path);
        this.visiting.add(path);
        const source = await readFile(path, 'utf8');
        const imports = extractImports(source, path);
        const ids = new Map();
        for (const { spec, file } of imports) {
            ids.set(spec, this.specFor(file));
            await this.visit(file);
        }
        this.visiting.delete(path);
        this.order.push(path);
        this.compiled.set(path, transpile(source, ids));
    }
}
function specFor(path, rootDir) {
    let rel = path.slice(rootDir.length);
    if (rel.startsWith('/'))
        rel = rel.slice(1);
    return rel;
}
function extractImports(source, path) {
    const sf = ts.createSourceFile('entry' + extname(path), source, TARGET, true, ts.ScriptKind.TS);
    const deps = [];
    const add = (spec) => {
        if (spec.startsWith('.') || spec.startsWith('/'))
            deps.push({ spec, file: resolve(path, spec) });
    };
    for (const statement of sf.statements) {
        if (ts.isImportDeclaration(statement)) {
            add(statement.moduleSpecifier.text);
        }
        else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
            add(statement.moduleSpecifier.text);
        }
    }
    return deps;
}
function resolve(fromPath, spec) {
    // UI imports use .js specifiers that name .ts sources.
    const stripped = spec.endsWith('.js') ? spec.slice(0, -3) : spec;
    const dir = dirname(fromPath);
    const base = join(dir, stripped);
    const candidates = [base + '.ts', base, base + '/index.ts'];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (found === undefined)
        throw new Error('Cannot resolve import "' + spec + '" from ' + fromPath);
    return found;
}
function transpile(source, idMap) {
    const result = ts.transpileModule(source, {
        compilerOptions: { target: TARGET, module: ts.ModuleKind.CommonJS, isolatedModules: true },
    });
    let js = result.outputText.trim();
    for (const [spec, id] of idMap) {
        js = js.split('require("' + spec + '")').join('require("' + id + '")');
    }
    return js;
}
function dirname(path) {
    const i = path.lastIndexOf('/');
    if (i === -1)
        return '.';
    return i === 0 ? '/' : path.slice(0, i);
}
function join(dir, spec) {
    const absolute = dir.startsWith('/');
    const stack = (dir === '.' || dir === '/' ? [] : dir.split('/')).filter((p) => p !== '');
    for (const seg of spec.split('/')) {
        if (seg === '' || seg === '.')
            continue;
        if (seg === '..')
            stack.pop();
        else
            stack.push(seg);
    }
    return (absolute ? '/' : '') + stack.join('/');
}
