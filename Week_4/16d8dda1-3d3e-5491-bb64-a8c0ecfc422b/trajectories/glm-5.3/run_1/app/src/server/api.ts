import express, { type Router, type Request } from 'express'
import { NOT_FOUND, CROSS_SITE } from './apiError.js'
import * as bus from './bus.js'
import * as store from './store.js'
import { isJsonRequest, readJsonBody, readUploadBody } from './web.js'
import { registerAccountRoutes, registerClassRoutes } from './routesClasses.js'
import { registerLessonRoutes } from './routesLessons.js'
import { registerSessionRoutes } from './routesSessions.js'
import { registerGradingRoutes } from './routesGrading.js'

export function apiRouter(): Router {
  const router = express.Router()

  // Same origin only: a state-changing request whose Origin names another
  // origin is refused before any other check (DP-40).
  router.use((req, res, next) => {
    const origin = req.headers.origin
    const host = req.headers.host
    const changing = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS'
    const upgrade = req.headers.upgrade === 'websocket'
    if ((changing || upgrade) && origin && host && !sameOrigin(origin, host)) {
      res.status(403).json({ error: CROSS_SITE.message })
      return
    }
    next()
  })

  // JSON bodies and uploads: size limits and content types (DP-40).
  router.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      next()
      return
    }
    if (isMultipart(req)) {
      readUploadBody(req, res, next)
      return
    }
    if (!isJsonRequest(req)) {
      res.status(415).json({ error: 'Send JSON.' })
      return
    }
    readJsonBody(req, res, next)
  })

  router.get('/health', async (_req, res) => {
    const busUp = await busReachable()
    const storeUp = await store.storeReachable()
    res.status(200).json({ status: busUp && storeUp ? 'ok' : 'unavailable' })
  })

  registerAccountRoutes(router)
  registerClassRoutes(router)
  registerLessonRoutes(router)
  registerSessionRoutes(router)
  registerGradingRoutes(router)

  router.use((_req, res) => {
    res.status(404).json({ error: NOT_FOUND.message })
  })

  return router
}

function isMultipart(req: Request): boolean {
  return (req.headers['content-type'] ?? '').includes('multipart/form-data')
}

function sameOrigin(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function busReachable(): Promise<boolean> {
  if (bus.commands.status === 'ready') return true
  try {
    await bus.commands.ping()
    return true
  } catch {
    return false
  }
}
