import { config } from './config'
import { isDatabaseDown, migrate, pool } from './db'
import { createHttpServer, markDatabaseReady } from './http'
import './auth'
import { meOf } from './me'
import './live'
import './safaris'
import './photos'
import './halls'
import './notes'
import './boards'
import './postcards'
import { startLive } from './live'
import { startSeatSweeper } from './safaris'
import { seedMainWorld } from './seed'
import './health'

async function prepareDatabase(): Promise<void> {
  try {
    await migrate(seedMainWorld)
    markDatabaseReady()
  } catch (error) {
    if (!isDatabaseDown(error)) console.error(error)
    setTimeout(() => void prepareDatabase(), 1000)
  }
}

if (config.gradingRoutes) await import('./grading')

createHttpServer(meOf).listen(config.port, '0.0.0.0')
startLive()
startSeatSweeper()
void prepareDatabase()

process.on('SIGTERM', () => void pool.end().finally(() => process.exit(0)))
