/** Comparison tray: up to four fittings, kept across pages. */
import { el } from './dom.js'
import { COMPARE_FULL, COMPARE_ADDED } from './copy.js'
import type { App } from '../main.js'

interface TrayItem {
  code: string
  product_name: string
}

export class Tray {
  private items: TrayItem[] = []
  private open = false
  private status_text = ''
  private root: HTMLElement | null = null

  constructor() {
    try {
      const raw = sessionStorage.getItem('lf-tray')
      if (raw) this.items = JSON.parse(raw)
    } catch {
      this.items = []
    }
  }

  mount(root: HTMLElement): void {
    this.root = root
    this.rerender()
  }

  rerender(): void {
    if (!this.root) return
    this.root.replaceChildren()
    const bar = el('div', { class: 'tray' }, [this.build_bar()])
    this.root.append(bar)
  }

  private persist(): void {
    sessionStorage.setItem('lf-tray', JSON.stringify(this.items))
  }

  list(): TrayItem[] {
    return this.items
  }

  has(code: string): boolean {
    return this.items.some((i) => i.code === code)
  }

  async add(code: string, product_name: string): Promise<string> {
    if (this.items.length >= 4) return COMPARE_FULL
    if (!this.has(code)) {
      this.items.push({ code, product_name })
      this.persist()
      this.status_text = COMPARE_ADDED
      this.rerender()
    }
    return COMPARE_ADDED
  }

  set_status(message: string): void {
    this.status_text = message
    this.open = true
    this.rerender()
  }

  remove(code: string): void {
    this.items = this.items.filter((i) => i.code !== code)
    this.persist()
    this.rerender()
  }

  private build_bar(): HTMLElement {
    const toggle = el('button', {
      text: `Compare (${this.items.length})`,
      'aria-expanded': String(this.open),
      'aria-controls': 'compare-tray-panel',
      onclick: () => {
        this.open = !this.open
        this.rerender()
      },
    })
    if (this.open) {
      const panel = el('div', { class: 'panel panel-anim', id: 'compare-tray-panel', role: 'region', 'aria-label': 'Compare tray' })
      if (this.status_text) {
        panel.append(el('p', { class: 'status', text: this.status_text }))
      }
      for (const item of this.items) {
        panel.append(
          el('div', { class: 'row' }, [
            el('span', { text: `${item.product_name} (${item.code})` }),
            el('button', {
              text: `Remove ${item.product_name} from comparison`,
              class: 'linklike',
              onclick: () => this.remove(item.code),
            }),
          ]),
        )
      }
      panel.append(el('a', { href: '/compare', class: 'btn primary', text: 'Open comparison' }))
      return el('div', {}, [panel, el('div', { class: 'bar' }, [toggle])])
    }
    return el('div', { class: 'bar' }, [toggle])
  }
}

/** The card Compare button: adds the shown variant. */
export async function compare_button(app: App, code: string, product_name: string, pressed: boolean): Promise<HTMLButtonElement> {
  const button = el('button', {
    text: `Compare ${product_name}`,
    'aria-pressed': String(pressed),
    class: pressed ? 'pressed' : '',
    onclick: async (event: MouseEvent) => {
      const target = event.currentTarget as HTMLButtonElement
      if (target.getAttribute('aria-pressed') === 'true') {
        app.tray.remove(code)
        target.setAttribute('aria-pressed', 'false')
        target.classList.remove('pressed')
        return
      }
      const message = await app.tray.add(code, product_name)
      target.setAttribute('aria-pressed', 'true')
      target.classList.add('pressed')
      if (message === COMPARE_FULL) {
        app.tray.set_status(message)
      }
    },
  })
  return button
}
