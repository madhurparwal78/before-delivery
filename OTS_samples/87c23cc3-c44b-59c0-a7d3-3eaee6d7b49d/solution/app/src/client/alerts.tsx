import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

interface AlertItem {
  id: number
  text: string
}

interface Alerts {
  items: AlertItem[]
  raise: (text: string) => void
  dismiss: (id: number) => void
}

const AlertContext = createContext<Alerts>({ items: [], raise: () => undefined, dismiss: () => undefined })
let counter = 0

export function AlertProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<AlertItem[]>([])
  const raise = useCallback((text: string) => setItems((current) => [...current.filter((item) => item.text !== text), { id: ++counter, text }]), [])
  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), [])
  return <AlertContext.Provider value={{ items, raise, dismiss }}>{children}</AlertContext.Provider>
}

export const useAlerts = (): Alerts => useContext(AlertContext)
