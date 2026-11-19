/** The header of every page except the title page and the play page. */
import { h } from '../lib/dom'
import { accountMenu } from './account-menu'

export function siteHeader(): HTMLElement {
  return h('header', { class: 'topbar site-header' },
    h('a', { class: 'wordmark', href: '/' }, 'Hushfoot'),
    h('nav', { class: 'topnav', 'aria-label': 'Site' },
      h('a', { href: '/play' }, 'Play'),
      h('a', { href: '/text-world' }, 'Text world'),
      accountMenu(),
    ),
  )
}
