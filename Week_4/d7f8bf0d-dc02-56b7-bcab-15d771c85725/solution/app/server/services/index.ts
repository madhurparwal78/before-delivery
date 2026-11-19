import type { Engine } from './engine'
import type { Gotenberg } from './gotenberg'
import type { Outbox } from './outbox'
import type { StreamHub } from './streams'
import type { Valkey } from './valkey'

export interface Peer { id: string; up: boolean; port: number | null }

// Everything a request handler may use. Nothing about a request lives here.
export type Services = {
  instanceId: string
  internalToken: string
  valkey: Valkey
  outbox: Outbox
  hub: StreamHub
  engine: Engine
  gotenberg: Gotenberg
  peers: () => Peer[]
  stop: (restartAfterMs: number) => void
}
