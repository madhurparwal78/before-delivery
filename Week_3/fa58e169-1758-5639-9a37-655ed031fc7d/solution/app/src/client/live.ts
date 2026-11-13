import { useEffect, useRef, useState } from 'react'
import type { LiveMessage } from '../shared/api.ts'
import { useSession } from './session.tsx'

/** Opens the app's live socket for a pattern (or none) and reports whether live updates are on. */
export function useLive(patternId: string | null, onMessage: (message: LiveMessage) => void): { live: boolean; send(message: object): void } {
  const { me } = useSession()
  const signedIn = !!me
  const [live, setLive] = useState(true)
  const handler = useRef(onMessage)
  handler.current = onMessage
  const socket = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!signedIn) return undefined
    let closed = false
    let retry: number | undefined
    const open = () => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${scheme}://${location.host}/api/live${patternId ? `?pattern=${patternId}` : ''}`)
      socket.current = ws
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as LiveMessage
        if (message.type === 'hello' || message.type === 'live') setLive(message.live)
        handler.current(message)
      }
      ws.onclose = () => { if (!closed) retry = window.setTimeout(open, 1500) }
    }
    open()
    return () => {
      closed = true
      window.clearTimeout(retry)
      const ws = socket.current
      socket.current = null
      if (!ws) return
      ws.onmessage = null
      // Closing a socket that is still connecting makes the browser log a failed connection: close it once it opens.
      if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close()
      else ws.close()
    }
  }, [patternId, signedIn])

  return { live, send: (message) => { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message)) } }
}
