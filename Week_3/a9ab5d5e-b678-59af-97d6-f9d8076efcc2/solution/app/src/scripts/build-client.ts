import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';

const sourceRoot = join(__dirname, '..', '..', 'src');
const outputRoot = join(__dirname, '..', 'public');

async function run(): Promise<void> {
  await mkdir(join(outputRoot, 'fonts'), { recursive: true });
  await build({
    entryPoints: [join(sourceRoot, 'web', 'client', 'main.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minify: true,
    outfile: join(outputRoot, 'app.js'),
  });
  await cp(join(sourceRoot, 'web', 'static', 'app.css'), join(outputRoot, 'app.css'));
  await cp(join(sourceRoot, 'web', 'static', 'fonts'), join(outputRoot, 'fonts'), { recursive: true });
}

void run();
