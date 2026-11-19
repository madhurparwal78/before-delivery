import { h } from '../lib/dom'
import type { Mounted, PageContext } from '../lib/router'
import { siteHeader } from '../components/site-header'

export function mountNotFound(context: PageContext): Mounted {
  context.root.append(
    siteHeader(),
    h('main', { class: 'page' },
      h('h1', null, 'Nothing here.'),
      h('p', null, 'That page is not on any of the five islands.'),
      h('a', { class: 'btn', href: '/' }, 'Back to the title screen'),
    ),
  )
  return { unmount: () => undefined }
}
