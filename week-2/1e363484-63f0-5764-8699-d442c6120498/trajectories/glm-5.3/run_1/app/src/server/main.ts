import { loadConfig } from './config.js'
import { App } from './app.js'
import { join } from 'node:path'

const distDir = join(__dirname, '..')

async function main(): Promise<void> {
  const cfg = loadConfig()
  const app = new App(cfg, distDir)
  await app.start()
  console.log(`fluxseal listening on 0.0.0.0:${cfg.port}`)
}

main().catch((err) => {
  console.error('failed to start', err)
  process.exit(1)
})
