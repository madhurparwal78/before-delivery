/** Path routes with history; links on the same origin navigate without a reload. */
import { loadSession, session, takeEmbeddedSession } from './session'

export interface PageContext {
  path: string
  query: URLSearchParams
  params: string[]
  root: HTMLElement
  /** A page that handles Back and Forward itself (the play page) registers here instead of being mounted again. */
  onPop(handler: (state: unknown) => void): void
}
export interface Mounted { unmount(): void }
type Mount = (context: PageContext) => Mounted | Promise<Mounted>

interface Route { pattern: RegExp; signedIn: boolean; mount: Mount }

const routes: Route[] = []
let current: Mounted | null = null
let popHandler: ((state: unknown) => void) | null = null
let rootEl: HTMLElement
let generation = 0

export function route(pattern: RegExp, signedIn: boolean, mount: Mount): void {
  routes.push({ pattern, signedIn, mount })
}

async function render(): Promise<void> {
  const ticket = ++generation
  const { pathname, search } = location
  current?.unmount()
  current = null
  popHandler = null
  rootEl.replaceChildren()
  const found = routes.find((r) => r.pattern.test(pathname)) ?? routes[routes.length - 1]
  if (!found) return
  const known = takeEmbeddedSession()
  if (found.signedIn && !(known ? known.me : await loadSession())) {
    history.replaceState(null, '', `/signin?next=${encodeURIComponent(pathname + search)}`)
    return render()
  }
  if (!found.signedIn && !known && !session.me) await loadSession()
  if (ticket !== generation) return
  const params = (pathname.match(found.pattern) ?? []).slice(1)
  const mounted = await found.mount({
    path: pathname,
    query: new URLSearchParams(search),
    params,
    root: rootEl,
    onPop: (handler) => { popHandler = handler },
  })
  if (ticket !== generation) mounted.unmount()
  else current = mounted
}

export function navigate(path: string, options: { replace?: boolean } = {}): Promise<void> {
  if (options.replace) history.replaceState(history.state, '', path)
  else history.pushState(null, '', path)
  return render()
}

export function startRouter(root: HTMLElement): Promise<void> {
  rootEl = root
  window.addEventListener('popstate', (event) => {
    if (popHandler) popHandler(event.state)
    else void render()
  })
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as Element).closest('a[href]')
    if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.origin !== location.origin) return
    event.preventDefault()
    void navigate(anchor.pathname + anchor.search)
  })
  return render()
}
