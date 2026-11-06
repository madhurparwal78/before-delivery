import { api, type Person, ApiError } from '../api.js'
import { el, clear, setAlert } from '../ui.js'
import { setMe } from '../router.js'

export function renderSignIn(app: HTMLElement, onSignedIn: (p: Person) => Promise<void>): void {
  clear(app)
  const col = el('div', { class: 'signin-column' })
  const h = el('h1', { text: 'Fluxseal' })
  const alert = el('div', { role: 'alert', class: 'alert', hidden: true })
  const form = el('form', { novalidate: true }) as HTMLFormElement

  const email = el('input', { type: 'email', id: 'email', autocomplete: 'username' }) as HTMLInputElement
  const password = el('input', { type: 'password', id: 'password', autocomplete: 'current-password' }) as HTMLInputElement
  const emailLabel = el('label', { for: 'email', text: 'Email' })
  const passwordLabel = el('label', { for: 'password', text: 'Password' })
  emailLabel.append(email)
  passwordLabel.append(password)

  const submit = el('button', { type: 'submit', text: 'Sign in' })
  form.append(emailLabel, passwordLabel, submit)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    submit.disabled = true
    try {
      const res = await api<{ person: Person }>('POST', '/api/session', {
        email: email.value, password: password.value,
      })
      await setMe(res.person)
      await onSignedIn(res.person)
    } catch (err) {
      const message = err instanceof ApiError && err.status === 401
        ? 'That email and password do not match.'
        : 'Could not sign in right now. Try again in a few minutes.'
      alert.hidden = false
      setAlert(alert, message)
    } finally {
      submit.disabled = false
    }
  })

  col.append(h, alert, form)
  app.append(col)
  email.focus()
}
