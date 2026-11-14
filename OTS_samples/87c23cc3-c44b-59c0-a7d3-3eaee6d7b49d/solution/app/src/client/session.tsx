import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ServiceStatus, UserJson } from '../shared/domain.ts'
import { api } from './api.ts'
import { boot } from './boot.ts'

interface Session {
  /** The signed-in person, or null when signed out. The page carries it, so there is no pending state. */
  user: UserJson | null | undefined
  setUser: (user: UserJson | null) => void
  signOut: () => Promise<void>
  status: ServiceStatus | null
}

const SessionContext = createContext<Session>({ user: undefined, setUser: () => undefined, signOut: async () => undefined, status: null })

const STATUS_REFRESH_MS = 15000

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserJson | null | undefined>(boot.user)
  const [status, setStatus] = useState<ServiceStatus | null>(boot.status)
  useEffect(() => {
    const refresh = (): void => {
      api<ServiceStatus>('GET', '/api/status').then(setStatus, () => undefined)
    }
    refresh()
    const timer = window.setInterval(refresh, STATUS_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])
  const signOut = useCallback(async () => {
    await api<void>('DELETE', '/api/auth/session')
    setUser(null)
    window.location.assign('/')
  }, [])
  return <SessionContext.Provider value={{ user, setUser, signOut, status }}>{children}</SessionContext.Provider>
}

export const useSession = (): Session => useContext(SessionContext)
