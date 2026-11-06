/** The lighting dial: Auto follows the local hour; manual choice persists. */
import { auto_light_state, LIGHT_STATES, type DialMode } from './domain.js'
import { set_light } from './dom.js'
import { api } from './api.js'
import type { UserPublic } from './api.js'

let current_mode: DialMode = 'auto'
let signed_in: UserPublic | null = null

export function init_dial(user: UserPublic | null): void {
  signed_in = user
  const stored = user ? (user.dial_mode as DialMode) : (localStorage.getItem('lf-dial') as DialMode | null)
  current_mode = stored ?? 'auto'
  apply()
  setInterval(() => {
    if (current_mode === 'auto') apply()
  }, 60_000)
}

export function dial_mode(): DialMode {
  return current_mode
}

export function set_mode(mode: DialMode): void {
  current_mode = mode
  if (signed_in) {
    void api.put('/api/me/dial', { mode })
  } else {
    localStorage.setItem('lf-dial', mode)
  }
  apply()
}

function apply(): void {
  const state = current_mode === 'auto' ? auto_light_state(new Date().getHours()) : current_mode
  set_light(state, current_mode)
}

export function render_dial(container: HTMLElement): void {
  const group = document.createElement('div')
  group.setAttribute('role', 'radiogroup')
  group.setAttribute('aria-label', 'Lighting')
  const choices: HTMLLabelElement[] = []
  for (const mode of ['auto', ...LIGHT_STATES] as DialMode[]) {
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'lighting'
    input.value = mode
    input.id = `dial-${mode}`
    if (current_mode === mode) input.checked = true
    input.addEventListener('change', () => set_mode(mode))
    const label = document.createElement('label')
    label.className = 'choice'
    label.htmlFor = `dial-${mode}`
    const text = document.createElement('span')
    text.textContent = mode === 'auto' ? 'Auto' : mode[0]!.toUpperCase() + mode.slice(1)
    label.append(input, text)
    choices.push(label)
  }
  const box = document.createElement('div')
  box.className = 'choices'
  box.append(...choices)
  group.append(box)
  container.append(group)
}
