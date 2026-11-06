import { mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { build } from 'esbuild'

rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
}

await build({
  ...shared,
  entryPoints: ['src/client/main.ts'],
  outfile: 'dist/public/app.js',
})

await build({
  ...shared,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  entryPoints: ['src/server/main.ts'],
  outfile: 'dist/server/main.cjs',
})
copyFileSync('src/client/index.html', 'dist/public/index.html')
copyFileSync('src/client/styles.css', 'dist/public/styles.css')

mkdirSync('dist/public/fonts', { recursive: true })
const wanted = [
  ['instrument-serif', 'latin-400-normal'],
  ['instrument-sans', 'latin-400-normal'],
  ['instrument-sans', 'latin-500-normal'],
  ['instrument-sans', 'latin-600-normal'],
  ['ibm-plex-mono', 'latin-400-normal'],
  ['ibm-plex-mono', 'latin-500-normal'],
  ['ibm-plex-mono', 'latin-600-normal'],
]
for (const [pack, sub] of wanted) {
  copyFileSync(
    `node_modules/@fontsource/${pack}/files/${pack}-${sub}.woff2`,
    `dist/public/fonts/${pack}-${sub}.woff2`)
}
console.log('build done')
