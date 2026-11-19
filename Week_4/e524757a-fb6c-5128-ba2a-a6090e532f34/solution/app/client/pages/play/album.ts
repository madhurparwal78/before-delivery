/** The album pane: island tabs, the pages of the selected island (updated in place when a photo is kept elsewhere),
 *  Refill film, and links to the hall and the challenge board. */
import { ISLANDS, creaturesOfIsland, HARBOUR } from '../../../shared/island'
import { FULL_ROLL, type Album, type AlbumPage, type Albums } from '../../../shared/types'
import { digits, h } from '../../lib/dom'
import { figure, pagesText } from '../../lib/figure'

interface AlbumPane {
  el: HTMLElement
  /** Take new albums from the server (live in place). */
  update(albums: Albums, options?: { instant?: boolean }): void
  /** The selected tab changes to follow the explorer arriving on an island. */
  select(island: number, options?: { instant?: boolean }): void
  /** Re-evaluate Refill film (island or film changed). */
  refreshRefill(): void
  /** The selected tab (takes focus when the album opens). */
  selectedTab(): HTMLElement
  readonly closeButton: HTMLButtonElement
}

export function albumPane(options: {
  island(): number
  film(): number
  onClose(): void
  onRefill(): void
  onPostcard(photoId: string, creatureName: string, opener: HTMLElement): void
}): AlbumPane {
  let albums: Album[] = ISLANDS.map((island) => ({
    island: island.id, island_name: island.name, pages_filled: 0, stamp: false,
    pages: creaturesOfIsland(island.id).map((c) => ({ creature: c.id, creature_name: c.name, filled: false, photo_id: null, total: null })),
  }))
  let selected = options.island()
  const pagesFigure = figure('album-pages', pagesText, 0)
  const tabs = ISLANDS.map((island) => h('button', {
    type: 'button', role: 'tab', class: 'album-tab', 'aria-selected': 'false', tabindex: -1, id: `album-tab-${island.id}`,
    onclick: () => choose(island.id, true),
    onkeydown: (event: Event) => tabKey(event as KeyboardEvent, island.id),
  }, island.name))
  const list = h('ul', { role: 'list', 'aria-label': 'Album pages', class: 'album-pages' })
  const refill = h('button', { type: 'button', class: 'btn', onclick: () => options.onRefill() }, 'Refill film')
  const hallLink = h('a', { class: 'btn', href: '/hall' }, 'Your hall')
  const boardLink = h('a', { class: 'btn', href: '/boards/1' }, 'Challenge board')
  const closeButton = h('button', { type: 'button', class: 'btn', onclick: () => options.onClose() }, 'Close album')
  const items = new Map<string, { li: HTMLElement; body: HTMLElement }>()

  const el = h('section', { class: 'album-pane', 'aria-label': 'Album pane' },
    h('header', { class: 'pane-head' }, h('h2', null, 'Album'), closeButton),
    h('div', { role: 'tablist', 'aria-label': 'Islands', class: 'album-tabs' }, tabs),
    h('p', { class: 'album-count' }, pagesFigure.el),
    list,
    h('div', { class: 'pane-actions' }, refill, hallLink, boardLink))

  function tabKey(event: KeyboardEvent, island: number): void {
    const at = ISLANDS.findIndex((i) => i.id === island)
    const target = event.key === 'ArrowRight' ? at + 1 : event.key === 'ArrowLeft' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? ISLANDS.length - 1 : null
    if (target === null) return
    event.preventDefault()
    const next = ISLANDS[(target + ISLANDS.length) % ISLANDS.length]
    if (next) choose(next.id, true)
  }

  function renderPage(page: AlbumPage, creatureId: string): void {
    let item = items.get(creatureId)
    if (!item) {
      const body = h('div', { class: 'album-page-body' })
      item = { li: h('li', { class: 'album-page' }, h('h3', null, page.creature_name), body), body }
      items.set(creatureId, item)
      list.appendChild(item.li)
    }
    const { body, li } = item
    li.dataset.filled = String(page.filled)
    if (!page.filled || page.photo_id === null) {
      if (!body.querySelector('.album-empty')) body.replaceChildren(h('p', { class: 'album-empty' }, 'Not photographed yet.'))
      return
    }
    const src = `/api/photos/${page.photo_id}/image`
    const img = body.querySelector('img')
    if (img) {
      if (img.getAttribute('src') !== src) img.setAttribute('src', src)
      const score = body.querySelector('.album-score')
      if (score) score.replaceChildren(digits(`${page.total} points`))
      const post = body.querySelector('button') as HTMLButtonElement
      post.onclick = () => options.onPostcard(page.photo_id as string, page.creature_name, post)
      return
    }
    const post = h('button', {
      type: 'button', class: 'btn btn-small', 'aria-label': `Send ${page.creature_name} photo as a postcard`,
    }, 'Postcard')
    post.onclick = () => options.onPostcard(page.photo_id as string, page.creature_name, post)
    body.replaceChildren(
      h('img', { src, alt: `${page.creature_name} photo`, width: 960, height: 600, class: 'album-photo' }),
      h('p', { class: 'album-score' }, digits(`${page.total} points`)),
      post)
  }

  function render(instant: boolean): void {
    const album = albums.find((a) => a.island === selected) as Album
    tabs.forEach((tab, i) => {
      const on = ISLANDS[i]?.id === selected
      tab.setAttribute('aria-selected', String(on))
      tab.tabIndex = on ? 0 : -1
    })
    pagesFigure.set(album.pages_filled, { instant })
    boardLink.setAttribute('href', `/boards/${selected}`)
    for (const page of album.pages) renderPage(page, page.creature)
  }

  function choose(island: number, focus: boolean): void {
    if (island !== selected) {
      selected = island
      items.clear()
      list.replaceChildren()
    }
    render(false)
    if (focus) (tabs[ISLANDS.findIndex((i) => i.id === island)] as HTMLElement).focus()
  }

  render(true)
  const pane: AlbumPane = {
    el,
    closeButton,
    update(next, updateOptions = {}) {
      albums = next.albums
      render(updateOptions.instant ?? false)
      pane.refreshRefill()
    },
    select(island, selectOptions = {}) {
      if (island !== selected) {
        selected = island
        items.clear()
        list.replaceChildren()
      }
      render(selectOptions.instant ?? true)
    },
    refreshRefill() {
      refill.disabled = !(options.island() === HARBOUR && options.film() < FULL_ROLL)
    },
    selectedTab() {
      return tabs[ISLANDS.findIndex((i) => i.id === selected)] as HTMLElement
    },
  }
  pane.refreshRefill()
  return pane
}
