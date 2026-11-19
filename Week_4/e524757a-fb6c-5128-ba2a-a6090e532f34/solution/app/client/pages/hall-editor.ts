/** `/hall`: hang, order, caption and publish your own photos. */
import '../styles/hall.css'
import { siteHeader } from '../components/site-header'
import { ApiFailure, NetworkFailure, get, put } from '../lib/api'
import { h } from '../lib/dom'
import { figure, likesText, type Figure } from '../lib/figure'
import { openLive } from '../lib/live'
import type { Mounted, PageContext } from '../lib/router'
import { status } from '../lib/status'
import type { HallFrame, OwnHall, Photo } from '../../shared/types'

interface Hung { photo: Photo; li: HTMLLIElement; caption: HTMLInputElement; frameNo: HTMLElement; likes: Figure; up: HTMLButtonElement; down: HTMLButtonElement }

export function mountHallEditor(context: PageContext): Mounted {
  const note = status('Gallery status', 5)
  const orderList = h('ul', { role: 'list', 'aria-label': 'Hall order', class: 'hall-items' })
  const ownList = h('ul', { role: 'list', 'aria-label': 'Your photos', class: 'hall-items' })
  const empty = h('div', { class: 'frame-empty' }, h('span', { class: 'corners' }), h('p', null, 'No photos hung yet.'))
  const visitorLink = h('a', { href: '/hall' }, 'Open your hall as a visitor')
  const publicBox = h('input', { type: 'checkbox', role: 'switch', id: 'hall-public' })
  const saveButton = h('button', { type: 'button', class: 'btn btn-primary' }, 'Save hall')
  const hung: Hung[] = []
  const free = new Map<string, Photo>()
  let handle = ''

  const fail = (error: unknown): void => {
    if (error instanceof ApiFailure || error instanceof NetworkFailure) note.say(error.message, { error: true })
    else throw error
  }
  const nameOf = (photo: Photo): string => `${photo.creature_name} photo`
  const refresh = (): void => {
    hung.forEach((entry, index) => {
      entry.li.setAttribute('aria-label', `${nameOf(entry.photo)}, frame ${index + 1}`)
      entry.frameNo.textContent = `Frame ${index + 1}`
    })
    empty.hidden = hung.length > 0
  }

  function move(entry: Hung, delta: number, focus: HTMLElement): void {
    const from = hung.indexOf(entry)
    const to = from + delta
    if (to < 0 || to >= hung.length) return
    hung.splice(from, 1)
    hung.splice(to, 0, entry)
    orderList.insertBefore(entry.li, delta < 0 ? (orderList.children[to] ?? null) : (orderList.children[to + 1] ?? null))
    refresh()
    note.say(`${nameOf(entry.photo)} moved to frame ${to + 1} of ${hung.length}.`)
    focus.focus()
  }

  function addOwn(photo: Photo): void {
    free.set(photo.id, photo)
    const hang = h('button', { type: 'button', class: 'btn' }, `Hang ${nameOf(photo)}`)
    const li = h('li', { class: 'own-photo', 'data-photo': photo.id },
      h('img', { src: photo.image_url, alt: '', loading: 'lazy' }),
      h('strong', null, `${photo.creature_name}, ${photo.score.total} points`), hang)
    hang.addEventListener('click', () => { li.remove(); free.delete(photo.id); addHung(photo, ''); orderList.lastElementChild?.querySelector('input')?.focus() })
    ownList.appendChild(li)
  }

  function addHung(photo: Photo, caption: string, likes = 0): void {
    const captionBox = h('input', { type: 'text', 'aria-label': `Caption for ${nameOf(photo)}`, value: caption })
    const likeFigure = figure('likes', likesText, likes)
    const frameNo = h('span', { class: 'frame-no' })
    const up = h('button', { type: 'button', class: 'btn btn-small' }, `Move ${nameOf(photo)} up`)
    const down = h('button', { type: 'button', class: 'btn btn-small' }, `Move ${nameOf(photo)} down`)
    const takeDown = h('button', { type: 'button', class: 'btn btn-small' }, `Take down ${nameOf(photo)}`)
    const li = h('li', { class: 'hall-item', tabindex: '0', role: 'listitem', 'data-photo': photo.id },
      h('img', { src: photo.image_url, alt: '', loading: 'lazy' }),
      h('header', null, h('strong', null, `${photo.creature_name}, ${photo.score.total} points`), frameNo, likeFigure.el),
      h('label', { class: 'field caption-field' }, h('span', { class: 'field-label' }, 'Caption'), captionBox),
      h('div', { class: 'tools' }, up, down, takeDown))
    const entry: Hung = { photo, li, caption: captionBox, frameNo, likes: likeFigure, up, down }
    hung.push(entry)
    orderList.appendChild(li)
    up.addEventListener('click', () => move(entry, -1, up))
    down.addEventListener('click', () => move(entry, 1, down))
    takeDown.addEventListener('click', () => {
      hung.splice(hung.indexOf(entry), 1)
      li.remove()
      refresh()
      addOwn(photo)
      ownList.lastElementChild?.querySelector('button')?.focus()
    })
    li.addEventListener('keydown', (event) => {
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        move(entry, event.key === 'ArrowUp' ? -1 : 1, li)
      }
    })
    refresh()
  }

  function fill(hall: OwnHall, photos: Photo[]): void {
    handle = hall.handle
    visitorLink.setAttribute('href', `/hall/${handle}`)
    publicBox.checked = hall.public
    const used = new Set(hall.frames.map((frame: HallFrame) => frame.photo.id))
    for (const frame of hall.frames) addHung(frame.photo, frame.caption, frame.likes)
    for (const photo of photos) if (!used.has(photo.id)) addOwn(photo)
  }

  publicBox.addEventListener('change', () => {
    const wanted = publicBox.checked
    put<{ hall: OwnHall }>('/api/me/hall', { public: wanted }).then(
      () => note.say(wanted ? 'Hall is now public.' : 'Hall is now private.'),
      (error: unknown) => { publicBox.checked = !wanted; fail(error) },
    )
  })

  saveButton.addEventListener('click', () => {
    if (saveButton.getAttribute('aria-busy') === 'true') return
    saveButton.setAttribute('aria-busy', 'true')
    note.say('Saving hall…')
    put<{ hall: OwnHall }>('/api/me/hall', { public: publicBox.checked, frames: hung.map((entry) => ({ photo: entry.photo.id, caption: entry.caption.value })) })
      .then(({ hall }) => {
        for (const frame of hall.frames) hung.find((entry) => entry.photo.id === frame.photo.id)?.likes.set(frame.likes)
        note.say('Hall saved.')
      }, fail)
      .finally(() => saveButton.removeAttribute('aria-busy'))
  })

  const live = openLive()
  live.on('like', (event) => {
    const entry = hung.find((item) => item.photo.id === event.photo)
    if (!entry) return
    entry.likes.set(event.likes)
    if (event.liked) note.say(`${event.visitor_name} liked your ${event.creature_name} photo.`)
  })

  context.root.append(
    siteHeader(),
    h('main', { class: 'page' },
      h('h1', null, 'Your hall'),
      h('div', { class: 'hall-bar' },
        h('label', { class: 'switch', for: 'hall-public' }, publicBox, 'Public hall'), saveButton, visitorLink),
      note.el,
      h('div', { class: 'hall-grid' },
        h('section', null, h('h2', null, 'Hall order'), orderList, empty),
        h('section', null, h('h2', null, 'Your photos'), ownList))),
  )

  Promise.all([get<{ hall: OwnHall }>('/api/me/hall'), get<{ photos: Photo[] }>('/api/me/photos')]).then(([hall, photos]) => fill(hall.hall, photos.photos), fail)

  return { unmount: () => live.close() }
}
