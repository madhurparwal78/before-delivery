import { createServer } from 'node:http'
import { config } from './config.js'
import { initDb } from './db.js'
import { createApp } from './app.js'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'

async function main(): Promise<void> {
  // The schema is created idempotently every time the app starts to serve.
  await initDb()

  const server = createServer()
  const app = createApp(server)

  const publicDir = join(process.cwd(), 'dist', 'public')
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.woff2': 'font/woff2'
  }

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next()
      return
    }
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      next()
      return
    }
    // The server never serves source, manifest, package files, lockfiles,
    // environment files, source maps or dependency folders (DP-40).
    const forbidden = /(^|\/)(src|node_modules)(\/|$)|(\.ts$|\.map$|package(-lock)?\.json$|run\.json$|\.env(\.|$))/
    let target = normalize(req.path).replace(/^(\.\.[/\\])+/, '')
    if (target.includes('..')) {
      res.status(404).type('text/plain').send('Not found.')
      return
    }
    let file = join(publicDir, target)
    if (!existsSync(file) || statSync(file).isDirectory()) {
      file = join(publicDir, 'index.html')
    }
    if (!existsSync(file) || forbidden.test(target)) {
      res.status(404).type('text/plain').send('Not found.')
      return
    }
    res.setHeader('Content-Type', mimeTypes[extname(file)] ?? 'application/octet-stream')
    res.status(200).send(readFileSync(file))
  })

  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Not found.')
  })

  server.listen(config.port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`slatehall instance ${config.instanceName} serving on ${config.port}`)
  })
}

void main()
