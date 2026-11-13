import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Config } from '../shared/api.ts'
import { ApiFail, call } from './api.ts'

export interface Me { id: string; name: string; email: string; reduceMotion: boolean }

type Layout = 'phone' | 'tablet' | 'desktop'

interface SessionValue {
  ready: boolean
  me: Me | null
  config: Config | null
  layout: Layout
  reduceMotion: boolean
  setMe(me: Me | null): void
}

const Session = createContext<SessionValue>(null as unknown as SessionValue)

export const useSession = () => useContext(Session)

function layoutOf(width: number): Layout {
  return width >= 1024 ? 'desktop' : width >= 600 ? 'tablet' : 'phone'
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [me, setMe] = useState<Me | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [layout, setLayout] = useState<Layout>(layoutOf(window.innerWidth))
  const [system, setSystem] = useState(window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    // Hold the first paint until the faces are in, so no text is drawn in a fallback and then re-set (a layout shift).
    const faces = Promise.race([
      Promise.all([
        ...[400, 600, 700].map((weight) => document.fonts.load(`${weight} 16px Manrope`)),
        document.fonts.load('600 18px "Open Sans"'),
      ]),
      new Promise((resolve) => window.setTimeout(resolve, 3000)),
    ]).catch(() => undefined)
    void Promise.all([
      faces,
      call<Config>('GET', '/api/config').then(setConfig),
      call<Me>('GET', '/api/me').then(setMe).catch((error) => { if (!(error instanceof ApiFail)) throw error }),
    ]).finally(() => setReady(true))
  }, [])

  useEffect(() => {
    const resize = () => setLayout(layoutOf(window.innerWidth))
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setSystem(media.matches)
    window.addEventListener('resize', resize)
    media.addEventListener('change', change)
    return () => { window.removeEventListener('resize', resize); media.removeEventListener('change', change) }
  }, [])

  const reduceMotion = system || !!me?.reduceMotion
  useEffect(() => { document.documentElement.toggleAttribute('data-reduce-motion', reduceMotion) }, [reduceMotion])
  const set = useCallback((next: Me | null) => setMe(next), [])
  const value = useMemo(() => ({ ready, me, config, layout, reduceMotion, setMe: set }), [ready, me, config, layout, reduceMotion, set])
  return <Session.Provider value={value}>{children}</Session.Provider>
}
