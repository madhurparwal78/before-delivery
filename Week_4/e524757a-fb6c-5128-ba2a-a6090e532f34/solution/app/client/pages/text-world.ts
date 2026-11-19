import { h } from '../lib/dom'
import type { Mounted, PageContext } from '../lib/router'
import { siteHeader } from '../components/site-header'
import { textWorldContent } from '../components/text-world-content'

export function mountTextWorld(context: PageContext): Mounted {
  const content = textWorldContent()
  context.root.append(
    siteHeader(),
    h('main', { class: 'page' },
      h('h1', null, 'Text world'),
      h('p', null, 'Every island, every creature and your own progress, as plain text. Nothing here needs the 3D scene.'),
      content.el,
    ),
  )
  return { unmount: content.unmount }
}
