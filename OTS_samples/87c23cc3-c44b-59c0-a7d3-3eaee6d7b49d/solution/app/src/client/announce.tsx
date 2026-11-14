import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type Region = 'studio' | 'diagram' | 'editor'

interface Announcer {
  messages: Record<Region, string>
  say: (region: Region, text: string) => void
}

const AnnounceContext = createContext<Announcer>({ messages: { studio: '', diagram: '', editor: '' }, say: () => undefined })

export function AnnounceProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Record<Region, string>>({ studio: '', diagram: '', editor: '' })
  const say = useCallback((region: Region, text: string) => setMessages((current) => (current[region] === text ? current : { ...current, [region]: text })), [])
  const value = useMemo(() => ({ messages, say }), [messages, say])
  return <AnnounceContext.Provider value={value}>{children}</AnnounceContext.Provider>
}

export const useAnnounce = (): Announcer => useContext(AnnounceContext)

const LABELS: Record<Region, string> = { studio: 'Studio announcements', diagram: 'Diagram announcements', editor: 'Editor status' }

/** A polite live region whose text is the last announcement for the region. */
export function StatusRegion({ region, className }: { region: Region; className?: string }) {
  const { messages } = useAnnounce()
  return (
    <div role="status" aria-label={LABELS[region]} className={className}>
      {messages[region]}
    </div>
  )
}
