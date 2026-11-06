/** Newsletter confirmation page. */
import { el } from '../lib/dom.js'
import { api } from '../lib/api.js'
import { NEWSLETTER_CONFIRMED, NEWSLETTER_INVALID_TOKEN } from '../lib/copy.js'
import type { App } from '../main.js'

export async function render_newsletter_confirm(main: HTMLElement, app: App): Promise<void> {
  const token = new URL(location.href).searchParams.get('token')
  const reply = await api.get<{ email: string; occupation: string }>(`/api/newsletter/confirm?token=${encodeURIComponent(token ?? '')}`)
  const heading = reply.ok ? NEWSLETTER_CONFIRMED : NEWSLETTER_INVALID_TOKEN
  const body = reply.ok ? `You're confirmed as ${reply.body.occupation}. Welcome aboard.` : "That confirmation link isn't valid."
  main.append(el('div', { class: 'page' }, [el('h1', { text: heading }), el('p', { text: body })]))
  void app
}
