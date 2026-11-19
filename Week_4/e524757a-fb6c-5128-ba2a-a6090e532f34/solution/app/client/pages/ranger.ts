/** `/ranger`: waiting notes, for rangers. */
import '../styles/boards.css'
import { siteHeader } from '../components/site-header'
import { ApiFailure, NetworkFailure, get, post } from '../lib/api'
import { h } from '../lib/dom'
import { closeLayer, openLayer, type Layer } from '../lib/layers'
import { openLive } from '../lib/live'
import type { Mounted, PageContext } from '../lib/router'
import { status } from '../lib/status'
import type { Note } from '../../shared/types'

const REASONS = ['Not about the islands', 'Unkind', 'Shares personal details']

export function mountRanger(context: PageContext): Mounted {
  const note = status('Notes status', 5)
  note.el.classList.add('sticky-status')
  const list = h('ul', { role: 'list', 'aria-label': 'Waiting notes', class: 'notes' })
  const empty = h('div', { class: 'frame-empty' }, h('span', { class: 'corners' }), h('p', null, 'No notes waiting.'))
  const items = new Map<string, HTMLLIElement>()
  const panel = h('section', null, h('h2', null, 'Waiting notes'), list, empty)
  panel.hidden = true
  let live: ReturnType<typeof openLive> | null = null

  const fail = (error: unknown): void => {
    if (error instanceof ApiFailure || error instanceof NetworkFailure) note.say(error.message, { error: true })
    else throw error
  }
  const tidy = (): void => { empty.hidden = items.size > 0 }
  function drop(id: string): void {
    items.get(id)?.remove()
    items.delete(id)
    tidy()
  }

  function declineDialog(entry: Note, opener: HTMLElement): void {
    const radios = REASONS.map((reason) => {
      const input = h('input', { type: 'radio', name: 'reason', value: reason })
      return { reason, input, label: h('label', { class: 'choice' }, input, reason) }
    })
    const submit = h('button', { type: 'button', class: 'btn btn-primary' }, 'Decline note')
    const cancel = h('button', { type: 'button', class: 'btn' }, 'Keep waiting')
    const group = h('fieldset', { class: 'choices', role: 'radiogroup', 'aria-label': 'Reason' }, ...radios.map((r) => r.label))
    const dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Decline note' },
      h('h2', null, 'Decline this note?'), h('p', null, entry.text), group, h('div', { class: 'actions' }, cancel, submit))
    const backdrop = h('div', { class: 'dialog-backdrop' })
    const layer: Layer = { el: dialog, modal: true, opener, dismiss: () => close(), initial: () => radios[0]?.input ?? null }
    const close = (): void => { dialog.remove(); backdrop.remove(); closeLayer(layer) }
    cancel.addEventListener('click', close)
    backdrop.addEventListener('click', close)
    submit.addEventListener('click', () => {
      if (submit.getAttribute('aria-busy') === 'true') return
      const chosen = radios.find((r) => r.input.checked)
      submit.setAttribute('aria-busy', 'true')
      post<{ note: Note }>(`/api/notes/${entry.id}/decline`, { reason: chosen?.reason }).then(() => {
        drop(entry.id)
        note.say('Note declined.')
        close()
        list.querySelector('button')?.focus()
      }, (error: unknown) => {
        if (error instanceof ApiFailure && error.code === 'note_decided') drop(entry.id)
        fail(error)
      }).finally(() => submit.removeAttribute('aria-busy'))
    })
    ;(document.getElementById('layers') as HTMLElement).append(backdrop, dialog)
    openLayer(layer)
  }

  function add(entry: Note): void {
    if (items.has(entry.id)) return
    const approve = h('button', { type: 'button', class: 'btn' }, 'Approve')
    const decline = h('button', { type: 'button', class: 'btn' }, 'Decline')
    approve.addEventListener('click', () => {
      if (approve.getAttribute('aria-busy') === 'true') return
      approve.setAttribute('aria-busy', 'true')
      post<{ note: Note }>(`/api/notes/${entry.id}/approve`).then(() => {
        drop(entry.id)
        note.say('Note approved.')
      }, fail).finally(() => approve.removeAttribute('aria-busy'))
    })
    decline.addEventListener('click', () => declineDialog(entry, decline))
    const li = h('li', { class: 'note', 'data-note': entry.id },
      h('p', { class: 'text' }, entry.text),
      h('p', { class: 'by' }, `From ${entry.author_name}`),
      h('div', { class: 'tools' }, approve, decline))
    items.set(entry.id, li)
    list.appendChild(li)
    tidy()
  }

  context.root.append(siteHeader(), h('main', { class: 'page' }, h('h1', null, 'Ranger queue'), note.el, panel))

  get<{ notes: Note[] }>('/api/ranger/notes').then(({ notes }) => {
    panel.hidden = false
    for (const entry of notes) add(entry)
    tidy()
    live = openLive()
    live.on('note', ({ kind, note: entry }) => {
      if (kind === 'pending') add(entry)
      else if (kind === 'approved' || kind === 'declined') drop(entry.id)
    })
  }, fail)

  return { unmount: () => live?.close() }
}
