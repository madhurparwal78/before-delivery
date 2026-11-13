import { useSyncExternalStore } from 'react'

function subscribe(callback: () => void): () => void {
  window.addEventListener('popstate', callback)
  window.addEventListener('skinout:navigate', callback)
  return () => {
    window.removeEventListener('popstate', callback)
    window.removeEventListener('skinout:navigate', callback)
  }
}

const currentPath = (): string => window.location.pathname

export function usePath(): string {
  return useSyncExternalStore(subscribe, currentPath)
}

export function navigate(path: string, state: unknown = null): void {
  if (path === window.location.pathname) return
  window.history.pushState(state, '', path)
  window.dispatchEvent(new Event('skinout:navigate'))
}

type Route =
  | { page: 'sign-in' }
  | { page: 'closet' }
  | { page: 'trips' }
  | { page: 'imports' }
  | { page: 'settings' }
  | { page: 'list'; id: string }
  | { page: 'missing' }

export function routeOf(path: string): Route {
  const list = /^\/lists\/([^/]+)$/.exec(path)
  if (list?.[1]) return { page: 'list', id: decodeURIComponent(list[1]) }
  const pages: Record<string, Route> = {
    '/sign-in': { page: 'sign-in' },
    '/closet': { page: 'closet' },
    '/trips': { page: 'trips' },
    '/imports': { page: 'imports' },
    '/settings': { page: 'settings' },
  }
  return pages[path] ?? { page: 'missing' }
}
