import { mkdirSync, copyFileSync, readdirSync, existsSync } from 'node:fs'

mkdirSync('build/client/fonts', { recursive: true })
copyFileSync('client/styles.css', 'build/client/styles.css')
if (existsSync('client/assets/fonts')) {
  for (const file of readdirSync('client/assets/fonts')) {
    copyFileSync(`client/assets/fonts/${file}`, `build/client/fonts/${file}`)
  }
}
