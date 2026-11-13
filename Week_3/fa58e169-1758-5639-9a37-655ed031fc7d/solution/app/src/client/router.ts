import { useEffect, useState } from 'react'

const listeners = new Set<() => void>()

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, '', to)
  else history.pushState(null, '', to)
  listeners.forEach((l) => l())
}

export function useLocation(): { path: string; search: URLSearchParams } {
  const [, tick] = useState(0)
  useEffect(() => {
    const update = () => tick((n) => n + 1)
    listeners.add(update)
    window.addEventListener('popstate', update)
    return () => { listeners.delete(update); window.removeEventListener('popstate', update) }
  }, [])
  return { path: location.pathname, search: new URLSearchParams(location.search) }
}

/** A same-origin path from a `next` parameter, or the fallback (adapted from the kit's safe_redirect). */
export function safeNext(target: string | null, fallback = '/'): string {
  if (!target || target.length > 2048 || !target.startsWith('/') || target.startsWith('//')) return fallback
  let decoded = target
  for (let i = 0; i < 3; i++) {
    if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//')) return fallback
    try { decoded = decodeURIComponent(decoded) } catch { return fallback }
  }
  return /[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//') ? fallback : target
}
