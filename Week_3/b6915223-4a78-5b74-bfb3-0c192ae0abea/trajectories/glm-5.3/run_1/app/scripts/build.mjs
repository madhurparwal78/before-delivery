import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(process.cwd());
const clientEntry = path.join(rootDir, 'src/client/app.ts');
const outDir = path.join(rootDir, 'public/assets');

fs.mkdirSync(outDir, { recursive: true });

const result = await esbuild.build({
  entryPoints: [clientEntry],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  outfile: path.join(outDir, 'app.js'),
  sourcemap: false,
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});

const outputs = Object.entries(result.metafile.outputs);
const packages = new Set();
for (const [, output] of outputs) {
  for (const input of Object.keys(output.inputs ?? {})) {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
    if (match !== null) packages.add(match[1]);
  }
}
console.log(`Client bundled: ${path.join(outDir, 'app.js')}`);
console.log('Bundled packages:', Array.from(packages).join(', '));
