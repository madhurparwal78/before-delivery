/** `button "Account"` with its menu when signed in; `link "Sign in"` when signed out. */
import '../styles/site.css'
import { del, get } from '../lib/api'
import { h, setDigits } from '../lib/dom'
import { navigate } from '../lib/router'
import { session } from '../lib/session'
import { frames } from '../lib/figure'
import type { Me } from '../../shared/types'

export function accountMenu(): HTMLElement {
  const me = session.me
  if (!me) return h('a', { href: '/signin' }, 'Sign in')

  const button = h('button', {
    type: 'button', class: 'btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Account, ${me.player.name}`,
  }, me.player.name)
  const film = h('span', { role: 'menuitem', 'aria-disabled': 'true', tabindex: '-1' })
  const paintFilm = (count: number): void => setDigits(film, `${frames(count)} of film`)
  paintFilm(me.film)
  const hall = h('a', { role: 'menuitem', href: '/hall', tabindex: '-1' }, 'Your hall')
  const signOut = h('button', { type: 'button', role: 'menuitem', tabindex: '-1' }, 'Sign out')
  const menu = h('div', { role: 'menu', 'aria-label': 'Account', class: 'account-menu', hidden: true }, hall, signOut, film)
  const items: HTMLElement[] = [hall, signOut]

  const close = (refocus: boolean): void => {
    menu.hidden = true
    button.setAttribute('aria-expanded', 'false')
    if (refocus) button.focus()
  }
  const open = (): void => {
    menu.hidden = false
    button.setAttribute('aria-expanded', 'true')
    hall.focus()
    get<Me>('/api/me').then((fresh) => paintFilm(fresh.film), () => undefined)
  }

  button.addEventListener('click', () => (menu.hidden ? open() : close(true)))
  signOut.addEventListener('click', () => {
    del('/api/session').then(() => { session.me = null; void navigate('/') })
  })
  menu.addEventListener('keydown', (event) => {
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') { event.stopPropagation(); close(true) }
    else if (event.key === 'ArrowDown') { event.preventDefault(); items[(at + 1) % items.length]?.focus() }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(at + items.length - 1) % items.length]?.focus() }
    else if (event.key === 'Tab') close(false)
  })
  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !wrapper.contains(event.target as Node)) close(false)
  })

  const wrapper = h('div', { class: 'account' }, button, menu)
  return wrapper
}
