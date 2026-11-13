import { type Child, h, icon } from './dom.ts'
import { openDialog } from './dialog.ts'
import { navigate, onNavigate } from './navigation.ts'
import { renderBoard } from './screens/board.ts'
import { renderBuilder } from './screens/builder.ts'
import { renderHistory } from './screens/history.ts'
import { renderHome } from './screens/home.ts'
import { renderJoin } from './screens/join.ts'
import { renderRoom } from './screens/room.ts'
import { renderUpload } from './screens/upload.ts'
import { messageTile } from './view.ts'
import type { View } from './view.ts'

type Mount = (view: View) => void | Promise<void>

const ROUTES: [RegExp, Mount][] = [
  [/^\/$/, renderHome],
  [/^\/puzzles$/, renderBoard],
  [/^\/upload$/, renderUpload],
  [/^\/history$/, renderHistory],
  [/^\/build$/, renderBuilder],
  [/^\/games\/([^/]+)$/, renderRoom],
  [/^\/g\/([^/]+)$/, renderJoin],
]

const NAV: [string, string][] = [
  ['Board', '/puzzles'],
  ['Upload', '/upload'],
  ['History', '/history'],
]

const app = document.getElementById('app') as HTMLElement
const main = h('main', { id: 'main', class: 'board' })
const bandSlot = h('div', { id: 'band-slot' })
let leaveHandlers: (() => void)[] = []
let navigation = 0
// Screens mount once Albert Sans is in, so text never lays out in a fallback face and then reflows (capped wait).
const fontsReady = Promise.race([
  Promise.all(['400', '500', '600', '700'].map((weight) => document.fonts.load(`${weight} 16px "Albert Sans"`))).catch(() => undefined),
  new Promise((resolve) => setTimeout(resolve, 2000)),
])

const link = (label: string, path: string, className?: string): HTMLAnchorElement => h('a', { href: path, class: className }, label)

const logo = h('a', { href: '/', class: 'tile logo', 'aria-label': 'Overlap home' }, h('span', { class: 'mark', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')))

function openMenu(opener: HTMLElement): void {
  const links = h('nav', { class: 'menu-links' }, ...[...NAV, ['Start a room', '/puzzles']].map(([label, path]) => link(label, path)))
  const dialog = openDialog({ label: 'Menu', className: 'sheet menu-sheet', content: [h('h2', null, 'Menu'), links, h('button', { type: 'button', onclick: () => dialog.close() }, 'Close')], returnFocus: () => opener })
  links.addEventListener('click', () => dialog.close())
}

const menuButton = h('button', { type: 'button', class: 'tile menu-button', 'aria-label': 'Menu', onclick: () => openMenu(menuButton) }, icon('menu'))

app.append(
  h(
    'header',
    { class: 'topbar board' },
    logo,
    h('nav', { class: 'tile topnav', 'aria-label': 'Main' }, ...NAV.map(([label, path]) => link(label, path))),
    link('Start a room', '/puzzles', 'tile start-room'),
    menuButton,
  ),
  bandSlot,
  main,
)

function view(params: string[], ticket: number): View {
  return {
    main,
    params,
    onLeave: (handler) => leaveHandlers.push(handler),
    band: (message, ...extra: Child[]) => {
      bandSlot.replaceChildren(...(message === null ? [] : [h('div', { class: 'band', role: 'alert' }, message, ...extra)]))
    },
    brass: (on) => document.body.toggleAttribute('data-brass-elsewhere', !on),
    current: () => ticket === navigation,
  }
}

async function render(): Promise<void> {
  navigation += 1
  const ticket = navigation
  await fontsReady
  if (ticket !== navigation) return
  for (const handler of leaveHandlers) handler()
  leaveHandlers = []
  bandSlot.replaceChildren()
  main.replaceChildren()
  main.removeAttribute('aria-busy')
  document.body.removeAttribute('data-brass-elsewhere')
  const path = location.pathname.replace(/\/+$/, '') || '/'
  const match = ROUTES.map(([pattern, mount]) => ({ params: pattern.exec(path)?.slice(1), mount })).find((candidate) => candidate.params !== undefined)
  if (!match?.params) {
    messageTile(main, 'Page not found.')
    return
  }
  await match.mount(view(match.params, ticket))
}

document.addEventListener('click', (event) => {
  const anchor = (event.target as Element).closest('a[href^="/"]')
  if (!(anchor instanceof HTMLAnchorElement) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || anchor.hasAttribute('download')) return
  event.preventDefault()
  navigate(anchor.getAttribute('href') ?? '/')
})
window.addEventListener('popstate', () => void render())
onNavigate(() => void render())
void render()
