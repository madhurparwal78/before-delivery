/** App shell: routing, header, footer, tray and shared state. */
import { api, type UserPublic } from './lib/api.js'
import { el, open_dialog } from './lib/dom.js'
import { render_dial, init_dial } from './lib/dial.js'
import { render_home } from './views/home.js'
import { render_catalogue } from './views/catalogue.js'
import { render_compare } from './views/compare.js'
import { render_product } from './views/product.js'
import { render_favourites } from './views/favourites.js'
import { render_cart } from './views/cart.js'
import { render_checkout } from './views/checkout.js'
import { render_order } from './views/order.js'
import { render_signin, render_signup } from './views/auth.js'
import { render_account } from './views/account.js'
import { render_projects, render_project } from './views/projects.js'
import { render_admin } from './views/admin.js'
import { render_newsletter_confirm } from './views/newsletter.js'
import { Tray } from './lib/tray.js'

export interface App {
  user: UserPublic | null
  cart_count: number
  tray: Tray
  refresh_header: () => Promise<void>
  navigate: (path: string) => void
}

const app: App = {
  user: null,
  cart_count: 0,
  tray: new Tray(),
  refresh_header: async () => {},
  navigate: (path: string) => {
    history.pushState({}, '', path)
    void route()
  },
}

const FAMILIES: [string, string][] = [
  ['downlights', 'Downlights'],
  ['track-spots', 'Track spots'],
  ['pendants', 'Pendants'],
  ['surface', 'Surface mounted'],
  ['clearance', 'Clearance'],
]

export async function boot(): Promise<void> {
  const me = await api.get<{ user: UserPublic }>('/api/me')
  app.user = me.ok ? me.body.user : null
  init_dial(app.user)

  const root = document.getElementById('app')!
  root.replaceChildren()
  root.append(build_header(), el('main', { id: 'main' }), build_footer())

  app.refresh_header = refresh_header
  await refresh_header()

  const dial = el('div', { class: 'dial', 'aria-label': 'Lighting dial' })
  document.body.append(dial)
  render_dial(dial)

  const tray_node = el('div', { id: 'tray-root' })
  document.body.append(tray_node)
  app.tray.mount(tray_node)

  window.addEventListener('popstate', () => void route())
  void route()
}

async function refresh_header(): Promise<void> {
  const cart_link = document.querySelector('[data-name="cart-count"]')
  if (app.user && cart_link) {
    const cart = await api.get<{ order: { lines: { quantity: number }[] } }>('/api/cart')
    const count = cart.ok ? cart.body.order.lines.reduce((sum, l) => sum + l.quantity, 0) : 0
    app.cart_count = count
    cart_link.textContent = String(count)
  } else if (cart_link) {
    cart_link.textContent = '0'
  }
  render_nav_links()
}

function render_nav_links(): void {
  const holder = document.querySelector('[data-name="nav-links"]')
  if (!holder) return
  const links: HTMLElement[] = [el('a', { href: '/catalogue', text: 'Catalogue' })]
  if (app.user && app.user.role === 'trade' && app.user.trade_status === 'approved') {
    links.push(el('a', { href: '/projects', text: 'Projects' }))
  }
  if (app.user && app.user.role === 'admin') {
    links.push(el('a', { href: '/admin', text: 'Admin' }))
  }
  holder.replaceChildren(...links)
  const account = document.querySelector('[data-name="nav-account"]')
  if (account) {
    account.replaceChildren(
      app.user
        ? el('button', {
            class: 'linklike',
            text: 'Sign out',
            onclick: async () => {
              await api.post('/api/auth/signout')
              app.user = null
              app.navigate('/')
              window.location.href = '/'
            },
          })
        : el('a', { href: '/signin', text: 'Sign in' }),
    )
  }
}

function build_header(): HTMLElement {
  const menu_button = el('button', {
    text: 'Menu',
    'aria-label': 'Menu',
    class: 'menu-button',
    onclick: () => {
      const dialog = el('dialog', { 'aria-label': 'Menu' })
      const list = el('nav')
      for (const [slug, name] of FAMILIES) {
        list.append(el('a', { href: `/catalogue?family=${slug}`, text: name, onclick: () => dialog.close() }))
      }
      if (app.user) {
        list.append(
          el('a', { href: '/account', text: 'Account', onclick: () => dialog.close() }),
          el('a', { href: '/orders', text: 'Orders', onclick: () => dialog.close() }),
        )
      }
      list.append(el('a', { href: '/signin', text: 'Sign in', onclick: () => dialog.close() }))
      dialog.append(list)
      document.body.append(dialog)
      open_dialog(dialog, menu_button)
    },
  })

  const catalogue_button = el('button', {
    text: 'Catalogue',
    class: 'catalogue-button',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    onclick: (event: MouseEvent) => {
      const button = event.currentTarget as HTMLButtonElement
      const menu = document.getElementById('catalogue-menu')!
      const open = button.getAttribute('aria-expanded') === 'true'
      button.setAttribute('aria-expanded', String(!open))
      menu.hidden = open
      if (!open) {
        const first = menu.querySelector('a') as HTMLAnchorElement
        first.focus()
      }
    },
    onkeydown: (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const menu = document.getElementById('catalogue-menu')!
        menu.hidden = false
        ;(menu.querySelector('a') as HTMLAnchorElement).focus()
      }
    },
  })

  const mega = el('div', { id: 'catalogue-menu', role: 'region', 'aria-label': 'Catalogue menu', class: 'megamenu', hidden: true })
  for (const [slug, name] of FAMILIES) {
    mega.append(
      el('a', {
        href: `/catalogue?family=${slug}`,
        text: name,
        onclick: () => {
          mega.hidden = true
          catalogue_button.setAttribute('aria-expanded', 'false')
        },
      }),
    )
  }

  const header = el('header', { class: 'header' }, [
    el('a', { href: '/', class: 'wordmark', text: 'Lightfall' }),
    el('div', { style: 'display:flex;gap:16px;align-items:center' }, [
      catalogue_button,
      menu_button,
      el('div', { 'data-name': 'nav-links', style: 'display:flex;gap:18px' }),
    ]),
    el('div', { style: 'display:flex;gap:16px;align-items:center' }, [
      el('a', { href: '/cart', class: 'cart-link', text: 'Cart' }, [
        el('span', { class: 'count-pill', 'data-name': 'cart-count', text: '0' }),
      ]),
      el('div', { 'data-name': 'nav-account' }),
    ]),
    mega,
  ])

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    if (!mega.contains(target) && !catalogue_button.contains(target)) {
      mega.hidden = true
      catalogue_button.setAttribute('aria-expanded', 'false')
    }
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !mega.hidden) {
      mega.hidden = true
      catalogue_button.setAttribute('aria-expanded', 'false')
      catalogue_button.focus()
    }
  })
  return header
}

function build_footer(): HTMLElement {
  const email = el('input', { type: 'email', 'aria-label': 'Email', placeholder: 'you@example.com' })
  const occupation = el('select', { 'aria-label': 'Occupation' }, [
    el('option', { value: 'architect', text: 'Architect' }),
    el('option', { value: 'trade', text: 'Trade' }),
    el('option', { value: 'wholesaler', text: 'Wholesaler' }),
    el('option', { value: 'other', text: 'Other' }),
  ])
  const consent = el('input', { type: 'checkbox', id: 'news-consent' })
  const consent_label = el('label', { for: 'news-consent', text: 'Send me the Lightfall newsletter' })
  const status = el('div', { role: 'status', 'aria-live': 'polite', 'data-name': 'Newsletter status' })
  const button = el('button', {
    text: 'Subscribe',
    onclick: async () => {
      const { newsletter_pending, NEWSLETTER_CONSENT, NEWSLETTER_INVALID_EMAIL } = await import('./lib/copy.js')
      if (!consent.checked) {
        status.textContent = NEWSLETTER_CONSENT
        return
      }
      button.textContent = 'Subscribing'
      const reply = await api.post<{ error?: string; errors?: Record<string, string> }>('/api/newsletter', {
        email: (email as HTMLInputElement).value.trim(),
        occupation: (occupation as HTMLSelectElement).value,
        consent: true,
      })
      button.textContent = 'Subscribe'
      if (reply.ok) {
        status.textContent = newsletter_pending((email as HTMLInputElement).value.trim())
      } else if (reply.body.errors?.['email'] === 'invalid') {
        status.textContent = NEWSLETTER_INVALID_EMAIL
      } else if (reply.body.errors?.['consent'] === 'required') {
        status.textContent = NEWSLETTER_CONSENT
      }
    },
  })
  const region = el('div', { role: 'region', 'aria-label': 'Newsletter' }, [
    el('h3', { text: 'Newsletter' }),
    el('div', { class: 'field' }, [email]),
    el('div', { class: 'field' }, [occupation]),
    el('div', { class: 'field' }, [consent, consent_label]),
    button,
    status,
  ])
  return el('footer', { class: 'footer' }, [
    el('div', { class: 'inner' }, [region, el('p', { class: 'muted', text: 'Southerly Light Works · Ōtautahi Christchurch' })]),
  ])
}

async function route(): Promise<void> {
  const main = document.getElementById('main')!
  main.replaceChildren()
  const path = location.pathname
  app.tray.rerender()
  if (path === '/') return render_home(main, app)
  if (path === '/catalogue') return render_catalogue(main, app)
  if (path === '/compare') return render_compare(main, app)
  if (path.startsWith('/products/')) return render_product(main, app, path.slice('/products/'.length))
  if (path === '/favourites') return render_favourites(main, app)
  if (path === '/cart') return render_cart(main, app)
  if (path === '/checkout') return render_checkout(main, app)
  if (path.startsWith('/orders/')) return render_order(main, app, path.slice('/orders/'.length))
  if (path === '/signin') return render_signin(main, app)
  if (path === '/signup') return render_signup(main, app)
  if (path === '/account') return render_account(main, app)
  if (path === '/projects') return render_projects(main, app)
  if (path.startsWith('/projects/')) return render_project(main, app, Number(path.slice('/projects/'.length)))
  if (path === '/admin') return render_admin(main, app)
  if (path === '/newsletter/confirm') return render_newsletter_confirm(main, app)
  main.append(el('h1', { text: 'Not found' }))
}

void boot()
