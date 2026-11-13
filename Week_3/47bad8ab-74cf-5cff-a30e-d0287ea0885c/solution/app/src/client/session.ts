import { SOMETHING_WRONG } from '../shared/copy.ts'
import { ApiFailure, api } from './api.ts'
import { openDialog } from './dialog.ts'
import { h } from './dom.ts'

interface Me {
  id: string
  display_name: string
}

let me: Me | null | undefined
let asking: Promise<Me> | null = null

async function currentPlayer(): Promise<Me | null> {
  if (me === undefined) {
    me = await api<Me>('GET', '/api/players/me').catch((error: unknown) => {
      if (error instanceof ApiFailure && error.status === 401) return null
      throw error
    })
  }
  return me
}

/** The player of this browser; asks for a display name first when there is none. */
export function ensurePlayer(): Promise<Me> {
  asking ??= currentPlayer().then((known) => known ?? askForName())
  return asking
}

function askForName(): Promise<Me> {
  return new Promise((resolve) => {
    const input = h('input', { id: 'display-name', type: 'text', autocomplete: 'off', 'aria-describedby': 'display-name-error' })
    const error = h('p', { id: 'display-name-error', class: 'field-error', 'aria-live': 'polite' })
    const form = h(
      'form',
      {
        class: 'sheet-form',
        onsubmit: (event: Event) => {
          event.preventDefault()
          api<Me>('POST', '/api/players', { display_name: input.value }).then(
            (created) => {
              me = created
              dialog.close()
              resolve(created)
            },
            (failure: unknown) => {
              error.textContent = failure instanceof ApiFailure ? (failure.body.fields?.display_name ?? failure.message) : SOMETHING_WRONG
              input.setAttribute('aria-invalid', 'true')
            },
          )
        },
      },
      h('h2', null, 'Choose a display name'),
      h('label', { for: 'display-name' }, 'Display name'),
      input,
      error,
      h('button', { type: 'submit', class: 'primary' }, 'Continue'),
    )
    const dialog = openDialog({ label: 'Choose a display name', content: [form], dismissible: false, initialFocus: () => input })
  })
}
