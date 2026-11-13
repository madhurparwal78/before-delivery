// Fairline server: one origin for the browser app, the API and the live session.

import { config } from './config.js'
import { closeDatabase, startDatabase } from './db.js'
import { createHttpServer } from './http.js'
import { startLive, stopLive } from './live.js'
import { startPartRetries } from './parts.js'
import { registerScoreRoutes } from './routes-score.js'
import { registerTeamRoutes } from './routes-team.js'
import { prepareStorage } from './storage.js'
import { startValkey, stopValkey } from './valkey.js'

registerScoreRoutes()
registerTeamRoutes()
const server = createHttpServer()
startLive(server)
prepareStorage()
startPartRetries()
// The first attempt on Postgres and Valkey runs before listening so a fresh start answers its first request;
// whatever is unreachable is retried in the background while the server serves.
void Promise.all([startDatabase(), startValkey()]).then(() => server.listen(config.port, '0.0.0.0'))

function shutdown(): void {
  stopLive()
  stopValkey()
  server.close()
  closeDatabase().finally(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
