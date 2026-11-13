import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

for (const project of ['tsconfig.server.json', 'tsconfig.client.json']) {
  const typecheck = spawnSync('npx', ['tsc', '--noEmit', '-p', project], { stdio: 'inherit' })
  if (typecheck.status !== 0) process.exit(typecheck.status ?? 1)
}

rmSync('dist', { recursive: true, force: true })
mkdirSync('dist/client', { recursive: true })

await build({
  entryPoints: ['src/server/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
})

await build({
  entryPoints: ['src/client/main.ts'],
  outfile: 'dist/client/app.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari17'],
  minify: true,
  sourcemap: false,
})

await build({
  entryPoints: ['src/client/styles.css'],
  outfile: 'dist/client/app.css',
  bundle: true,
  minify: true,
  loader: { '.woff2': 'file' },
  external: ['/fonts/*'],
})

cpSync('public/fonts', 'dist/client/fonts', { recursive: true })
writeFileSync('dist/client/index.html', readFileSync('src/client/index.html', 'utf8'))
