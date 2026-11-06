import { api, type Person } from './api.js'
import { el, clear } from './ui.js'
import { renderSignIn } from './screens/signin.js'
import { renderProjects, type ProjectsMessage } from './screens/projects.js'
import { renderWorkspace } from './screens/workspace.js'
import { renderFigure } from './screens/figure.js'
import { renderAudit } from './screens/audit.js'
import { renderAccess } from './screens/access.js'
import { renderRegulatorFigure } from './screens/regulator.js'

export type AppCtx = {
  me: Person | null
  reload: () => Promise<void>
}

let me: Person | null = null
let pendingMessages: ProjectsMessage | null = null

function currentRoute(): { path: string; query: URLSearchParams } {
  const u = new URL(window.location.href)
  return { path: u.pathname, query: u.searchParams }
}

export async function bootstrap(): Promise<void> {
  window.addEventListener('popstate', () => { void route() })
  try {
    me = await api<Person>('GET', '/api/me').then((r) => (r as unknown as { person: Person }).person)
  } catch {
    me = null
  }
  await route()
}

export async function setMe(next: Person | null): Promise<void> {
  me = next
}

export function getMe(): Person | null {
  return me
}

export function setProjectsMessage(msg: ProjectsMessage | null): void {
  pendingMessages = msg
}

export function takeProjectsMessage(): ProjectsMessage | null {
  const m = pendingMessages
  pendingMessages = null
  return m
}

async function route(): Promise<void> {
  const { path, query } = currentRoute()
  const app = document.getElementById('app')!

  if (path.startsWith('/r/')) {
    // public pages never check the session
    const rest = path.slice(3)
    if (rest.endsWith('/audit')) {
      await renderRegulatorFigure(app, decodeURIComponent(rest.slice(0, -6)), true)
    } else {
      await renderRegulatorFigure(app, decodeURIComponent(rest), false)
    }
    return
  }

  if (path === '/signin') {
    if (me) { window.history.replaceState({}, '', '/projects'); void route(); return }
    renderSignIn(app, async (person: Person) => { me = person; window.history.replaceState({}, '', '/projects'); await route() })
    return
  }

  if (!me) {
    window.history.replaceState({}, '', '/signin')
    await route()
    return
  }

  const figMatch = path.match(/^\/projects\/([^/]+)\/figures\/([^/]+)(\/audit)?$/)
  if (figMatch) {
    renderNav(app, me)
    const main = mainRegion(app)
    if (figMatch[3]) {
      await renderAudit(main, decodeURIComponent(figMatch[2]!), decodeURIComponent(figMatch[1]!))
    } else {
      await renderFigure(main, decodeURIComponent(figMatch[2]!), decodeURIComponent(figMatch[1]!), me)
    }
    return
  }

  const wsMatch = path.match(/^\/projects\/([^/]+)$/)
  if (wsMatch) {
    renderNav(app, me)
    await renderWorkspace(mainRegion(app), decodeURIComponent(wsMatch[1]!), me, query)
    return
  }

  if (path === '/projects') {
    renderNav(app, me)
    await renderProjects(mainRegion(app), me, takeProjectsMessage())
    return
  }

  if (path === '/admin/access') {
    if (me.org_role !== 'admin') {
      window.history.replaceState({}, '', '/projects')
      await route()
      return
    }
    renderNav(app, me)
    await renderAccess(mainRegion(app))
    return
  }

  window.history.replaceState({}, '', me ? '/projects' : '/signin')
  await route()
}

function renderNav(app: HTMLElement, person: Person): void {
  clear(app)
  const nav = el('nav', { 'aria-label': 'Main', class: 'main-nav' })
  nav.append(el('span', { class: 'wordmark', text: 'Fluxseal' }))
  const links = el('div', { class: 'nav-links' })
  links.append(el('a', { href: '/projects', text: 'Projects' }))
  if (person.org_role === 'admin') {
    links.append(el('a', { href: '/admin/access', text: 'Access' }))
  }
  nav.append(links)
  nav.append(el('button', {
    text: 'Sign out',
    onclick: async () => {
      try { await api('DELETE', '/api/session') } catch { /* session already gone */ }
      me = null
      window.history.replaceState({}, '', '/signin')
      await route()
    },
  }))
  app.append(nav)
}

function mainRegion(app: HTMLElement): HTMLElement {
  const main = el('main', { class: 'main-region', 'aria-live': 'off' })
  app.append(main)
  return main
}

export function navigate(path: string): void {
  window.history.pushState({}, '', path)
  void route()
}
