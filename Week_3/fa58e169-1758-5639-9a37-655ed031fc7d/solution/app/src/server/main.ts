import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.ts'
import { migrate } from './db.ts'
import { dispatch, staticHandler } from './http.ts'
import { acceptSocket, receive, startLive } from './live.ts'
import { startValkey } from './valkey.ts'
import './routes/accounts.ts'
import './routes/patterns.ts'
import './routes/chart.ts'
import './routes/testers.ts'
import './routes/grading.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'client')

async function main(): Promise<void> {
  await migrate()
  startLive()
  void startValkey(receive)
  const server = createServer(dispatch(staticHandler(root)))
  server.on('upgrade', acceptSocket)
  server.listen(config.port, '0.0.0.0')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
