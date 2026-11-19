import express, { type Express } from 'express'
import type { Server } from 'node:http'
import { attachWebSocket } from './live.js'
import { apiRouter } from './api.js'
import { config } from './config.js'

export function createApp(server: Server): Express {
  const app = express()

  // Every response carries the instance header (DP-38).
  app.use((_req, res, next) => {
    res.setHeader('X-Slatehall-Instance', config.instanceName)
    next()
  })

  app.use('/api', apiRouter)
  attachWebSocket(server)

  return app
}
