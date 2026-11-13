import { createElement, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react'
import { holdPending } from './api'

export interface Loc {
  path: string
  search: string
  /** How this location was reached: first load, a pushed entry, a replaced entry or back/forward. */
  nav: 'load' | 'push' | 'replace' | 'pop'
  /** Scroll and focus saved when the entry was left (back/forward only). */
  saved: { scrollY: number; focusKey: string | null } | null
  /** Extra state kept with the history entry. */
  state: Record<string, unknown>
}

let current: Loc = read('load')
const listeners = new Set<() => void>()

function read(nav: Loc['nav']): Loc {
  const state = (history.state ?? {}) as { scroll?: Loc['saved']; extra?: Loc['state'] }
  return { path: location.pathname, search: location.search.replace(/^\?/, ''), nav, saved: nav === 'pop' && state.scroll ? state.scroll : null, state: state.extra ?? {} }
}

let releaseNavigation: (() => void) | null = holdPending()

/** A navigation keeps <body data-pending> above zero until the new route has committed and its effects have started their requests. */
function publish(nav: Loc['nav']): void {
  current = read(nav)
  releaseNavigation ??= holdPending()
  listeners.forEach((listener) => listener())
}

export function navigationCommitted(): void {
  releaseNavigation?.()
  releaseNavigation = null
}

function remember(): void {
  const focused = document.activeElement as HTMLElement | null
  history.replaceState({ ...(history.state ?? {}), scroll: { scrollY: window.scrollY, focusKey: focused?.dataset.focusKey ?? null } }, '')
}

history.scrollRestoration = 'manual'
window.addEventListener('popstate', () => publish('pop'))

export function navigate(to: string, options: { replace?: boolean; state?: Record<string, unknown> } = {}): void {
  const extra = options.state ?? {}
  if (options.replace) {
    history.replaceState({ ...(history.state ?? {}), extra }, '', to)
    publish('replace')
    return
  }
  remember()
  history.pushState({ extra }, '', to)
  publish('push')
}

/** Replaces the URL without touching the rendered page state (used when a page keeps its own state). */
export function replaceUrl(to: string): void {
  history.replaceState({ ...(history.state ?? {}) }, '', to)
  current = read(current.nav)
  listeners.forEach((listener) => listener())
}

export function useLocation(): Loc {
  const [, force] = useState(0)
  useEffect(() => {
    const listener = (): void => force((n) => n + 1)
    listeners.add(listener)
    listener()
    return () => void listeners.delete(listener)
  }, [])
  return current
}

export function Link({ to, replace, children, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; replace?: boolean }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || rest.target === '_blank' || rest.download !== undefined) return
    event.preventDefault()
    navigate(to, { replace })
  }
  return createElement('a', { ...rest, href: to, onClick: handle }, children)
}

