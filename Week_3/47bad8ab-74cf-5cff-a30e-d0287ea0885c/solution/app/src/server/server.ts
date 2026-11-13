import { STATUS_CODES, createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import { LIVE_FRAME_LIMIT } from '../shared/types.ts'
import { config } from './config.ts'
import { migrate } from './db.ts'
import { SOMETHING_WRONG } from '../shared/copy.ts'
import { ApiError, errorBody } from './errors.ts'
import { requireGame } from './games.ts'
import { cookieOf, dispatch, playerFromCookie, send, sendError } from './http.ts'
import { connect, recoverLiveGames, startHeartbeat } from './hub.ts'
import { seedLibrary } from './puzzles.ts'
import { recoverRecords, startRecordRetries } from './records.ts'
import { routes } from './routes.ts'
import { serveStatic } from './static.ts'

let ready = false

const server = createServer((request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost')
  if (!pathname.startsWith('/api/') && pathname !== '/api') {
    const asset = serveStatic(pathname)
    response.writeHead(asset.status, { 'content-type': asset.type, 'cache-control': asset.cache, 'x-content-type-options': 'nosniff' })
    response.end(request.method === 'HEAD' ? undefined : asset.bytes)
    return
  }
  if (!ready) {
    sendError(response, new ApiError('storage_unavailable'))
    return
  }
  dispatch(routes, request, `http://${request.headers.host ?? 'localhost'}`).then(
    (reply) => send(response, reply),
    (error: unknown) => {
      if (error instanceof ApiError) sendError(response, error)
      else {
        console.error(error)
        sendError(response, new ApiError('storage_unavailable', { message: SOMETHING_WRONG }))
      }
    },
  )
})

const sockets = new WebSocketServer({ noServer: true, maxPayload: LIVE_FRAME_LIMIT })
const LIVE_PATH = /^\/api\/games\/([^/]+)\/live$/

function refuse(socket: Duplex, error: ApiError): void {
  const body = JSON.stringify(errorBody(error))
  socket.write(`HTTP/1.1 ${error.status} ${STATUS_CODES[error.status]}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
  socket.destroy()
}

async function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost')
  const match = LIVE_PATH.exec(pathname)
  if (!match || !ready) return refuse(socket, new ApiError('not_found'))
  const origin = request.headers.origin
  if (origin !== undefined && new URL(origin).host !== request.headers.host) return refuse(socket, new ApiError('not_host', { message: 'Cross-origin live connections are refused.' }))
  const player = await playerFromCookie(cookieOf(request.headers.cookie))
  if (!player) return refuse(socket, new ApiError('no_player'))
  try {
    const { game, seat } = await requireGame(match[1], player.id)
    sockets.handleUpgrade(request, socket, head, (ws) => connect(ws, game, seat).catch((error: unknown) => console.error(error)))
  } catch (error) {
    if (error instanceof ApiError) refuse(socket, error)
    else throw error
  }
}

server.on('upgrade', (request, socket, head) => {
  upgrade(request, socket, head).catch((error: unknown) => {
    console.error(error)
    socket.destroy()
  })
})

server.listen(config.port, '0.0.0.0')

await migrate()
await seedLibrary()
await recoverLiveGames()
startHeartbeat()
startRecordRetries()
ready = true
void recoverRecords()
console.log(`Overlap listening on ${config.port}`)
