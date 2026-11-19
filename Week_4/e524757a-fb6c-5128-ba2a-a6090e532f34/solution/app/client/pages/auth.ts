/** Sign-up, sign-in and confirm: single-column forms on white with grey panels. */
import '../styles/auth.css'
import { ApiFailure, NetworkFailure, post } from '../lib/api'
import { h } from '../lib/dom'
import { navigate, type Mounted, type PageContext } from '../lib/router'
import { loadSession, localPath, session } from '../lib/session'
import { status } from '../lib/status'
import type { Player } from '../../shared/types'

const FIELD_OF: Record<string, string> = {
  bad_name: 'name', bad_email: 'email', bad_password: 'password', bad_credentials: 'email', bad_code: 'code', code_expired: 'code',
}
const CODE_NOTE = 'hf-confirm-note'

interface Field { id: string; label: string; type: string; autocomplete: string; inputmode?: string }

function shell(title: string, context: PageContext, ...body: HTMLElement[]): void {
  context.root.append(
    h('header', { class: 'topbar' }, h('a', { class: 'wordmark', href: '/' }, 'Hushfoot')),
    h('main', { class: 'auth' }, h('h1', null, title), ...body),
  )
}

function inputs(fields: Field[]): { rows: HTMLElement[]; input: Record<string, HTMLInputElement> } {
  const input: Record<string, HTMLInputElement> = {}
  const rows = fields.map((field) => {
    const el = h('input', {
      id: `field-${field.id}`, name: field.id, type: field.type, autocomplete: field.autocomplete, inputmode: field.inputmode,
      spellcheck: 'false',
    })
    input[field.id] = el
    return h('div', { class: 'field' }, h('label', { for: el.id }, field.label), el)
  })
  return { rows, input }
}

/** Runs one submit: busy while pending, the catalogue message in `Account status`, the failing field marked and focused. */
function submitter(
  form: HTMLFormElement, button: HTMLButtonElement, input: Record<string, HTMLInputElement>, note: ReturnType<typeof status>,
  busyLabel: string, run: () => Promise<void>,
): void {
  const label = button.textContent ?? ''
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (button.getAttribute('aria-busy') === 'true') return
    for (const el of Object.values(input)) el.removeAttribute('aria-invalid')
    note.clear()
    button.setAttribute('aria-busy', 'true')
    button.textContent = busyLabel
    run().catch((error: unknown) => {
      if (!(error instanceof ApiFailure) && !(error instanceof NetworkFailure)) throw error
      note.say(error.message, { error: true })
      const field = error instanceof ApiFailure ? input[FIELD_OF[error.code] ?? ''] : undefined
      if (field) { field.setAttribute('aria-invalid', 'true'); field.setAttribute('aria-describedby', 'account-status'); field.focus() }
    }).finally(() => {
      button.removeAttribute('aria-busy')
      button.textContent = label
    })
  })
}

export function mountSignup(context: PageContext): Mounted {
  const { rows, input } = inputs([
    { id: 'name', label: 'Name', type: 'text', autocomplete: 'name' },
    { id: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
    { id: 'password', label: 'Password', type: 'password', autocomplete: 'new-password' },
  ])
  const note = status('Account status')
  note.el.id = 'account-status'
  const button = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Create account')
  const form = h('form', { novalidate: true }, ...rows, button)
  submitter(form, button, input, note, 'Creating…', async () => {
    const made = await post<{ player: Player; code_sent: boolean }>('/api/signup', {
      name: input.name?.value, email: input.email?.value, password: input.password?.value,
    })
    if (!made.code_sent) sessionStorage.setItem(CODE_NOTE, 'failed')
    await loadSession()
    await navigate('/confirm')
  })
  shell('Create an account', context, form, note.el,
    h('div', { class: 'auth-links' }, h('span', null, 'Already walking?'), h('a', { href: '/signin' }, 'Sign in')))
  return { unmount: () => undefined }
}

export function mountSignin(context: PageContext): Mounted {
  const { rows, input } = inputs([
    { id: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
    { id: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' },
  ])
  const note = status('Account status')
  note.el.id = 'account-status'
  const button = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Sign in')
  const form = h('form', { novalidate: true }, ...rows, button)
  submitter(form, button, input, note, 'Signing in…', async () => {
    await post<{ player: Player }>('/api/session', { email: input.email?.value, password: input.password?.value })
    await loadSession()
    await navigate(localPath(context.query.get('next')), { replace: true })
  })
  shell('Sign in', context, form, note.el,
    h('div', { class: 'auth-links' }, h('a', { href: '/signup' }, 'Create an account')))
  return { unmount: () => undefined }
}

export function mountConfirm(context: PageContext): Mounted {
  const { rows, input } = inputs([{ id: 'code', label: 'Confirmation code', type: 'text', autocomplete: 'one-time-code', inputmode: 'numeric' }])
  const note = status('Account status')
  note.el.id = 'account-status'
  const button = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Confirm')
  const form = h('form', { novalidate: true }, ...rows, button)
  const resend = h('button', { type: 'button', class: 'btn' }, 'Send a new code')
  const later = h('a', { href: '/play' }, 'Later')
  submitter(form, button, input, note, 'Confirming…', async () => {
    const done = await post<{ player: Player }>('/api/confirm', { code: input.code?.value.trim() })
    if (session.me) session.me = { ...session.me, player: done.player }
    note.say('Email confirmed.')
    later.textContent = 'Start walking'
  })
  resend.addEventListener('click', () => {
    if (resend.getAttribute('aria-busy') === 'true') return
    resend.setAttribute('aria-busy', 'true')
    post<{ sent: boolean }>('/api/confirm/resend').then(
      () => note.say('New code sent.'),
      (error: unknown) => {
        if (error instanceof ApiFailure) note.say(error.message, { error: true })
        else if (error instanceof NetworkFailure) note.say("Couldn't send the code. Press Send a new code to try again.", { error: true })
        else throw error
      },
    ).finally(() => resend.removeAttribute('aria-busy'))
  })
  if (sessionStorage.getItem(CODE_NOTE) === 'failed') {
    sessionStorage.removeItem(CODE_NOTE)
    note.say("Couldn't send the code. Press Send a new code to try again.", { error: true })
  }
  shell('Confirm your email', context,
    h('p', null, 'We mailed you a six-digit code. Type it here to post postcards, pin notes and enter boards.'),
    form, note.el,
    h('div', { class: 'auth-links' }, resend, later))
  return { unmount: () => undefined }
}
