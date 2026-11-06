/**
 * Background work: share PDF retries, PocketBase reconnection and the SSE hub.
 */
import type { Api } from './api.js'

export function start_background(api: Api): void {
  setInterval(() => {
    void api.process_pending_shares()
  }, 10_000).unref()
  setInterval(() => {
    void api.refresh_collaboration()
  }, 5_000).unref()
}
