/** Sign in and sign up forms. */
import { el } from '../lib/dom.js'
import { api } from '../lib/api.js'
import { SIGNIN_INVALID, EMAIL_TAKEN, NZBN_INVALID, PASSWORD_SHORT } from '../lib/copy.js'
import type { App } from '../main.js'

export async function render_signin(main: HTMLElement, app: App): Promise<void> {
  const alert_box = el('div', { role: 'alert' })
  alert_box.hidden = true
  const email = el('input', { type: 'email', 'aria-label': 'Email' })
  const password = el('input', { type: 'password', 'aria-label': 'Password' })
  const button = el('button', { class: 'primary', text: 'Sign in' })
  const form = el('form', { 'aria-label': 'Sign in', onsubmit: (event: Event) => event.preventDefault() }, [
    el('div', { class: 'field' }, [el('label', { text: 'Email' }), email]),
    el('div', { class: 'field' }, [el('label', { text: 'Password' }), password]),
    alert_box,
    button,
  ])
  button.addEventListener('click', async () => {
    button.textContent = 'Signing in'
    const reply = await api.post('/api/auth/signin', {
      email: (email as HTMLInputElement).value.trim(),
      password: (password as HTMLInputElement).value,
    })
    if (reply.ok) {
      const back = new URL(location.href).searchParams.get('back')
      window.location.href = back ?? '/account'
      return
    }
    button.textContent = 'Sign in'
    alert_box.hidden = false
    alert_box.textContent = SIGNIN_INVALID
  })
  main.append(el('div', { class: 'page' }, [el('h1', { text: 'Sign in' }), form]))
  void app
}

export async function render_signup(main: HTMLElement, app: App): Promise<void> {
  const alert_box = el('div', { role: 'alert' })
  alert_box.hidden = true
  const name = el('input', { type: 'text', 'aria-label': 'Name' })
  const email = el('input', { type: 'email', 'aria-label': 'Email' })
  const password = el('input', { type: 'password', 'aria-label': 'Password' })
  const retail_radio = el('input', { type: 'radio', name: 'account-type', value: 'retail', id: 'type-retail' })
  const trade_radio = el('input', { type: 'radio', name: 'account-type', value: 'trade', id: 'type-trade' })
  retail_radio.checked = true
  const business_name = el('input', { type: 'text', 'aria-label': 'Business name' })
  const nzbn = el('input', { type: 'text', 'aria-label': 'NZBN', inputmode: 'numeric' })
  const occupation = el('select', { 'aria-label': 'Occupation' }, [
    el('option', { value: 'electrician', text: 'Electrician' }),
    el('option', { value: 'architect', text: 'Architect' }),
    el('option', { value: 'lighting_designer', text: 'Lighting designer' }),
    el('option', { value: 'wholesaler', text: 'Wholesaler' }),
  ])
  const trade_fields = el('div', { hidden: true }, [
    el('div', { class: 'field' }, [el('label', { text: 'Business name' }), business_name]),
    el('div', { class: 'field' }, [el('label', { text: 'NZBN' }), nzbn]),
    el('div', { class: 'field' }, [el('label', { text: 'Occupation' }), occupation]),
  ])
  trade_radio.addEventListener('change', () => (trade_fields.hidden = false))
  retail_radio.addEventListener('change', () => (trade_fields.hidden = true))
  const button = el('button', { class: 'primary', text: 'Create account' })
  button.addEventListener('click', async () => {
    button.textContent = 'Creating account'
    const account_type = trade_radio.checked ? 'trade' : 'retail'
    const body: Record<string, unknown> = {
      email: (email as HTMLInputElement).value.trim(),
      password: (password as HTMLInputElement).value,
      name: (name as HTMLInputElement).value.trim(),
      account_type,
    }
    if (account_type === 'trade') {
      body['trade'] = {
        business_name: (business_name as HTMLInputElement).value.trim(),
        nzbn: (nzbn as HTMLInputElement).value.trim(),
        occupation: (occupation as HTMLSelectElement).value,
      }
    }
    const reply = await api.post<{ error?: string; errors?: Record<string, string> }>('/api/auth/signup', body)
    if (reply.status === 201) {
      window.location.href = '/account'
      return
    }
    button.textContent = 'Create account'
    alert_box.hidden = false
    const errors = reply.body.errors ?? {}
    const parts: string[] = []
    if (errors['password'] === 'too_short') parts.push(PASSWORD_SHORT)
    if (errors['nzbn'] === 'invalid') parts.push(NZBN_INVALID)
    if (reply.body.error === 'email_taken') parts.push(EMAIL_TAKEN)
    alert_box.textContent = parts.join(' ') || 'Please check the form.'
  })
  const form = el('form', { 'aria-label': 'Sign up', onsubmit: (event: Event) => event.preventDefault() }, [
    el('div', { class: 'field' }, [el('label', { text: 'Name' }), name]),
    el('div', { class: 'field' }, [el('label', { text: 'Email' }), email]),
    el('div', { class: 'field' }, [el('label', { text: 'Password' }), password]),
    el('div', { role: 'radiogroup', 'aria-label': 'Account type', class: 'radiogroup' }, [
      el('label', { class: 'choice', for: 'type-retail' }, [retail_radio, 'Retail customer']),
      el('label', { class: 'choice', for: 'type-trade' }, [trade_radio, 'Trade']),
    ]),
    trade_fields,
    alert_box,
    button,
  ])
  main.append(el('div', { class: 'page' }, [el('h1', { text: 'Sign up' }), form]))
  void app
}
