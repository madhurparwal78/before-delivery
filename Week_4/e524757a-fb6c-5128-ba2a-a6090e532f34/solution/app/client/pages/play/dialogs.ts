/** The dialogs of the play page: settings, restart, join a safari and send postcard. A region that belongs to a dialog
 *  (`Settings status`, `Safari status`, `Postcard status`) sits in the dialog while it is open and returns to the HUD
 *  when it closes, so it stays in the page and in the accessibility tree. */
import type { Graphics, Settings } from '../../../shared/types'
import { h } from '../../lib/dom'
import { ApiFailure, NetworkFailure } from '../../lib/api'
import type { Status } from '../../lib/status'
import { modal, type Modal } from './modal'

interface Docked { status: Status; home: HTMLElement }

function slotFor(docked: Docked): { slot: HTMLElement; onOpen(): void; onClose(): void } {
  const slot = h('div', { class: 'dialog-status' })
  return {
    slot,
    onOpen: () => slot.appendChild(docked.status.el),
    onClose: () => docked.home.appendChild(docked.status.el),
  }
}

const settingsMessage = (error: unknown): string => {
  if (error instanceof NetworkFailure) return "Couldn't save settings. Try again."
  if (error instanceof ApiFailure) return error.message
  throw error
}

export function settingsDialog(options: { current(): Settings; save(next: Settings): Promise<void>; docked: Docked }): Modal {
  const range = (label: string, id: string): { row: HTMLElement; input: HTMLInputElement; output: HTMLOutputElement } => {
    const input = h('input', { type: 'range', min: 0, max: 100, step: 5, id, 'aria-label': label })
    const output = h('output', { class: 'range-value', for: id })
    input.addEventListener('input', () => { output.textContent = input.value })
    return { row: h('div', { class: 'field range-field' }, h('label', { for: id }, label), h('div', { class: 'range-row' }, input, output)), input, output }
  }
  const music = range('Music volume', 'setting-music')
  const effects = range('Effects volume', 'setting-effects')
  const presets: [Graphics, string][] = [['full', 'Full'], ['balanced', 'Balanced'], ['light', 'Light']]
  const radios = presets.map(([value, label]) => ({
    value, input: h('input', { type: 'radio', name: 'graphics', value }), label,
  }))
  const group = h('div', { role: 'radiogroup', 'aria-label': 'Graphics', class: 'radio-group' },
    radios.map((r) => h('label', { class: 'radio' }, r.input, h('span', null, r.label))))
  const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'Save settings')
  const done = h('button', { type: 'button', class: 'btn' }, 'Close')
  const dock = slotFor(options.docked)
  const dialog = modal({
    name: 'Settings', title: 'Settings',
    body: [music.row, effects.row, h('div', { class: 'field' }, h('p', { class: 'label' }, 'Graphics'), group), dock.slot, h('div', { class: 'row' }, save, done)],
    initial: () => music.input,
    onOpen: () => {
      const current = options.current()
      music.input.value = String(current.music)
      music.output.textContent = String(current.music)
      effects.input.value = String(current.effects)
      effects.output.textContent = String(current.effects)
      for (const r of radios) r.input.checked = r.value === current.graphics
      options.docked.status.clear()
      dock.onOpen()
    },
    onClose: dock.onClose,
  })
  done.addEventListener('click', () => dialog.close())
  save.addEventListener('click', async () => {
    const graphics = radios.find((r) => r.input.checked)?.value ?? options.current().graphics
    try {
      await options.save({ music: Number(music.input.value), effects: Number(effects.input.value), graphics })
      options.docked.status.say('Settings saved.')
    } catch (error) {
      options.docked.status.say(settingsMessage(error), { error: true })
    }
  })
  return dialog
}

export function restartDialog(options: { restart(): Promise<void> }): Modal {
  const restart = h('button', { type: 'button', class: 'btn' }, 'Restart')
  const keep = h('button', { type: 'button', class: 'btn' }, 'Keep playing')
  const dialog = modal({
    name: 'Restart the expedition?', role: 'alertdialog', title: 'Restart the expedition?',
    body: [h('p', null, 'Start the whole expedition again?'), h('div', { class: 'row' }, restart, keep)],
    initial: () => keep,
  })
  keep.addEventListener('click', () => dialog.close())
  restart.addEventListener('click', async () => {
    await options.restart()
    dialog.close()
  })
  return dialog
}

export function joinDialog(options: { join(code: string): Promise<boolean>; docked: Docked }): Modal {
  const field = h('input', { type: 'text', id: 'safari-code', 'aria-label': 'Safari code', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: 12 })
  const join = h('button', { type: 'button', class: 'btn' }, 'Join')
  const dock = slotFor(options.docked)
  const dialog = modal({
    name: 'Join a safari', title: 'Join a safari',
    body: [h('div', { class: 'field' }, h('label', { for: 'safari-code' }, 'Safari code'), field), dock.slot, h('div', { class: 'row' }, join)],
    initial: () => field,
    onOpen: dock.onOpen,
    onClose: dock.onClose,
  })
  const submit = async (): Promise<void> => {
    if (join.getAttribute('aria-busy') === 'true') return
    join.setAttribute('aria-busy', 'true')
    try {
      if (await options.join(field.value.trim().toUpperCase())) {
        field.value = ''
        dialog.close()
      } else {
        field.focus()
      }
    } finally {
      join.removeAttribute('aria-busy')
    }
  }
  join.addEventListener('click', () => void submit())
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void submit() }
  })
  return dialog
}

interface PostcardDraft { photo: string; recipient: string; line: string }

export function postcardDialog(options: { send(draft: PostcardDraft, requestKey: string): Promise<boolean>; docked: Docked }): Modal & { prepare(photo: string, creatureName: string): void } {
  const recipient = h('input', { type: 'email', id: 'postcard-recipient', 'aria-label': 'Recipient email', autocomplete: 'off' })
  const line = h('textarea', { id: 'postcard-line', 'aria-label': 'Your line', rows: 3 })
  const post = h('button', { type: 'button', class: 'btn btn-primary' }, 'Post')
  const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel')
  const intro = h('p', { class: 'hint' })
  const dock = slotFor(options.docked)
  let photo = ''
  let last: { body: string; key: string } | null = null
  const dialog = modal({
    name: 'Send postcard', title: 'Send postcard',
    body: [intro,
      h('div', { class: 'field' }, h('label', { for: 'postcard-recipient' }, 'Recipient email'), recipient),
      h('div', { class: 'field' }, h('label', { for: 'postcard-line' }, 'Your line'), line),
      dock.slot, h('div', { class: 'row' }, post, cancel)],
    initial: () => recipient,
    onOpen: dock.onOpen,
    onClose: dock.onClose,
  })
  cancel.addEventListener('click', () => dialog.close())
  post.addEventListener('click', async () => {
    if (post.getAttribute('aria-busy') === 'true') return
    const draft = { photo, recipient: recipient.value.trim(), line: line.value }
    const body = JSON.stringify(draft)
    if (last?.body !== body) last = { body, key: crypto.randomUUID() }
    post.setAttribute('aria-busy', 'true')
    post.textContent = 'Posting…'
    try {
      if (await options.send(draft, last.key)) {
        recipient.value = ''
        line.value = ''
        last = null
        dialog.close()
      }
    } finally {
      post.removeAttribute('aria-busy')
      post.textContent = 'Post'
    }
  })
  return Object.assign(dialog, {
    prepare(photoId: string, creatureName: string) {
      photo = photoId
      last = null
      intro.textContent = `A postcard of your ${creatureName} photo, mailed to anyone.`
    },
  })
}
