import { createPortal } from 'react-dom'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Currency, Lang } from '../shared/i18n'
import { get } from './api'

/** The payload of each server event. */
interface LiveEvents {
  clock: { now: string }
  availability: { property: string; room_type: string; dates: string[] }
  'quote.changed': { quote_id: string; reason: 'rate' | 'expired'; old_total_minor: number; new_total_minor: number }
  'hold.expired': { hold_id: string }
  'account.changed': { lang: Lang | null; cur: Currency | null; tier: string; completed_stays: number; signed_out: boolean }
}

type Handler<K extends keyof LiveEvents = keyof LiveEvents> = (data: LiveEvents[K]) => void
const handlers = new Map<keyof LiveEvents, Set<Handler>>()
let source: EventSource | null = null
let baseline = { server: Date.now(), page: performance.now() }

/** Server time now: the last server instant seen plus page time elapsed since. */
export const serverNow = (): number => baseline.server + (performance.now() - baseline.page)

function setBaseline(iso: string): void {
  baseline = { server: Date.parse(iso), page: performance.now() }
}

/** Re-reads the server clock; a page that starts a hold uses it so its countdown begins at the server's now. */
export const syncServerTime = (): Promise<void> => get<{ now: string }>('/api/time').then((time) => setBaseline(time.now))

function onLive<K extends keyof LiveEvents>(name: K, handler: Handler<K>): () => void {
  const set = handlers.get(name) ?? new Set<Handler>()
  set.add(handler as Handler)
  handlers.set(name, set)
  return () => void set.delete(handler as Handler)
}

const EVENTS: (keyof LiveEvents)[] = ['clock', 'availability', 'quote.changed', 'hold.expired', 'account.changed']

export function connectLive(): void {
  if (source) return
  void get<{ now: string }>('/api/time').then((time) => setBaseline(time.now)).catch(() => undefined)
  source = new EventSource('/api/events')
  for (const name of EVENTS) {
    source.addEventListener(name, (event) => {
      const data = JSON.parse((event as MessageEvent).data) as LiveEvents[typeof name]
      if (name === 'clock') setBaseline((data as LiveEvents['clock']).now)
      handlers.get(name)?.forEach((handler) => handler(data))
    })
  }
}

/** Runs `handler` for each server event of that name while the component is mounted. */
export function useLive<K extends keyof LiveEvents>(name: K, handler: Handler<K>): void {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => onLive(name, (data) => latest.current(data)), [name])
}

/* Polite live regions that outlive any dialog (they sit outside the app root, which is made inert under a modal). */
type Region = 'search' | 'notice' | 'hold' | 'toast'
const texts: Record<Region, string> = { search: '', notice: '', hold: '', toast: '' }
const subscribers = new Set<() => void>()
let snapshot = { ...texts }
let toastTimer: ReturnType<typeof setTimeout> | undefined

function change(): void {
  snapshot = { ...texts }
  subscribers.forEach((subscriber) => subscriber())
}

export function announce(region: Region, text: string, toastMs = 0): void {
  texts[region] = text
  change()
  if (region === 'toast') {
    clearTimeout(toastTimer)
    if (text) toastTimer = setTimeout(() => announce('toast', ''), toastMs || window.__KIP__.toastMs)
  }
}

const subscribe = (subscriber: () => void): (() => void) => {
  subscribers.add(subscriber)
  return () => void subscribers.delete(subscriber)
}

const useRegions = (): typeof texts => useSyncExternalStore(subscribe, () => snapshot)

export function LiveRegions({ labels }: { labels: Record<Region, string> }) {
  const texts = useRegions()
  const host = document.getElementById('live') as HTMLElement
  return createPortal(
    <>
      <div role="status" aria-live="polite" aria-label={labels.search} className="sr-only-region">{texts.search}</div>
      <div role="status" aria-live="polite" aria-label={labels.notice} className="notice-region" data-empty={texts.notice === ''}>{texts.notice}</div>
      <div role="status" aria-live="polite" aria-label={labels.hold} className="sr-only-region">{texts.hold}</div>
      <div role="status" aria-live="polite" aria-label={labels.toast} className="toast-region" data-empty={texts.toast === ''}>{texts.toast}</div>
    </>,
    host,
  )
}

declare global {
  interface Window { __KIP__: { typeDebounceMs: number; mapDebounceMs: number; toastMs: number; importMaxBytes: number } }
}
