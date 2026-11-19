/** `/postcards/<id>`: a public, read-only postcard. Every value is shown as literal text. */
import '../styles/postcard.css'
import { ApiFailure, get } from '../lib/api'
import { h, setDigits } from '../lib/dom'
import type { Mounted, PageContext } from '../lib/router'
import type { PostcardPublic } from '../../shared/types'

export function mountPostcard(context: PageContext): Mounted {
  const body = h('main', { class: 'postcard-page' })
  context.root.append(
    h('header', { class: 'topbar' }, h('a', { class: 'wordmark', href: '/' }, 'Hushfoot')),
    body,
  )
  let gone = false

  get<{ postcard: PostcardPublic }>(`/api/postcards/${encodeURIComponent(context.params[0] ?? '')}`).then(({ postcard }) => {
    if (gone) return
    const total = h('dd')
    setDigits(total, `${postcard.total} points`)
    body.append(
      h('h1', { class: 'visually-hidden' }, `A postcard from ${postcard.sender_name}`),
      h('article', { class: 'postcard' },
        h('img', { src: postcard.image_url, alt: `${postcard.creature_name} photo` }),
        h('div', { class: 'postcard-text' },
          h('h2', null, postcard.creature_name),
          h('p', { class: 'line' }, postcard.line),
          h('dl', null, h('dt', null, 'Score'), total, h('dt', null, 'Island'), h('dd', null, postcard.island_name)),
          h('p', { class: 'sender' }, `Sent by ${postcard.sender_name}`))))
  }, (error: unknown) => {
    if (!(error instanceof ApiFailure) || error.status !== 404) throw error
    if (gone) return
    body.append(h('h1', null, 'No postcard here'), h('p', null, 'This postcard link does not match any postcard.'), h('a', { class: 'btn', href: '/' }, 'Back to the title screen'))
  })

  return { unmount: () => { gone = true } }
}
