/** `/board`: the harbour notice board and the form to pin a note. Notes are plain text, shown exactly as typed. */
import '../styles/boards.css'
import { siteHeader } from '../components/site-header'
import { ApiFailure, NetworkFailure, del, get, post } from '../lib/api'
import { h } from '../lib/dom'
import { openLive } from '../lib/live'
import type { Mounted, PageContext } from '../lib/router'
import { session } from '../lib/session'
import { status } from '../lib/status'
import type { Note } from '../../shared/types'

export function mountNoticeBoard(context: PageContext): Mounted {
  const me = session.me
  const note = status('Notes status', 5)
  const list = h('ul', { role: 'list', 'aria-label': 'Notice board', class: 'notes' })
  const empty = h('div', { class: 'frame-empty' }, h('span', { class: 'corners' }), h('p', null, 'No notes yet.'))
  const box = h('textarea', { id: 'note-text', rows: '3', placeholder: 'Tide tables, sightings, news from the dock' })
  const pin = h('button', { type: 'button', class: 'btn btn-primary' }, 'Pin note')
  const items = new Map<string, HTMLLIElement>()
  const mine = new Set<string>()
  let draft: { key: string; text: string } | null = null

  const fail = (error: unknown): void => {
    if (error instanceof ApiFailure || error instanceof NetworkFailure) note.say(error.message, { error: true })
    else throw error
  }

  function stateOf(entry: Note): string {
    if (!mine.has(entry.id) || entry.status === 'approved') return ''
    return entry.status === 'pending' ? 'Waiting for a ranger' : `Declined: ${entry.reason ?? ''}`
  }

  function draw(entry: Note): HTMLLIElement {
    const state = stateOf(entry)
    const tools = h('div', { class: 'tools' })
    if (me?.player.ranger && entry.status === 'approved') {
      const remove = h('button', { type: 'button', class: 'btn btn-small' }, 'Remove note')
      remove.addEventListener('click', () => { del(`/api/notes/${entry.id}`).then(() => undefined, fail) })
      tools.appendChild(remove)
    }
    return h('li', { class: 'note', 'data-note': entry.id },
      h('p', { class: 'text' }, entry.text),
      h('p', { class: 'by' }, `Pinned by ${entry.author_name}`),
      state ? h('p', { class: 'state' }, state) : null, tools)
  }

  function place(entry: Note, atTop: boolean): void {
    const li = draw(entry)
    const existing = items.get(entry.id)
    if (existing) existing.replaceWith(li)
    else if (atTop) list.prepend(li)
    else list.appendChild(li)
    items.set(entry.id, li)
    empty.hidden = items.size > 0
  }

  function drop(id: string): void {
    items.get(id)?.remove()
    items.delete(id)
    empty.hidden = items.size > 0
  }

  pin.addEventListener('click', () => {
    if (pin.getAttribute('aria-busy') === 'true') return
    const text = box.value
    if (draft?.text !== text) draft = { key: crypto.randomUUID(), text }
    pin.setAttribute('aria-busy', 'true')
    note.say('Pinning…')
    post<{ note: Note }>('/api/notes', { text }, { 'Request-Key': draft.key }).then(({ note: made }) => {
      mine.add(made.id)
      place({ ...made, author_name: me?.player.name ?? '', reason: null }, true)
      box.value = ''
      draft = null
      note.say('Note pinned.')
    }, fail).finally(() => {
      pin.removeAttribute('aria-busy')
      box.focus()
    })
  })

  const live = openLive()
  live.on('note', ({ kind, note: entry }) => {
    if (kind === 'approved') {
      const own = mine.has(entry.id)
      place(entry, true)
      note.say(own ? 'Your note is on the board.' : 'New note on the board.')
    } else if (kind === 'declined') {
      if (!mine.has(entry.id)) return
      place(entry, false)
      note.say(`Your note was declined: ${entry.reason ?? ''}.`)
    } else if (kind === 'removed') {
      drop(entry.id)
      note.say('Note removed.')
    }
  })

  context.root.append(
    siteHeader(),
    h('main', { class: 'page' },
      h('h1', null, 'Notice board'),
      h('div', { class: 'note-form' },
        h('div', { class: 'field' }, h('label', { for: 'note-text' }, 'Your note'), box, h('p', { class: 'hint' }, 'Up to 140 characters. A ranger reads every note before anyone else sees it.')),
        h('div', null, pin)),
      note.el,
      h('section', null, h('h2', null, 'On the board'), list, empty)),
  )

  get<{ notes: Note[] }>('/api/notes').then(({ notes }) => {
    for (const entry of notes) {
      if (entry.status !== 'approved') mine.add(entry.id)
    }
    for (const entry of notes) place(entry, false)
  }, fail)

  return { unmount: () => live.close() }
}
