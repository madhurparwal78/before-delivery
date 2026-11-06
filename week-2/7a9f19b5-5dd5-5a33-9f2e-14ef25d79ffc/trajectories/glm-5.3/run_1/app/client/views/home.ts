/** Home page: full-bleed 3D hero and links. */
import { el } from '../lib/dom.js'
import { ProductViewer } from '../three/viewer.js'
import { api, type ProductPublic } from '../lib/api.js'
import type { App } from '../main.js'

export async function render_home(main: HTMLElement, app: App): Promise<void> {
  const reply = await api.get<{ product: ProductPublic }>('/api/products/kauri-downlight')
  const product = reply.ok ? reply.body.product : null
  const hero = el('div', { class: 'hero' })
  const overlay = el('div', { class: 'overlay page' }, [
    el('h1', { text: 'Lightfall' }),
    el('p', { text: 'Architectural luminaires from Southerly Light Works, specified to the millimetre.' }),
    el('p', {}, [
      el('a', { href: '/catalogue', class: 'btn primary', text: 'Browse the catalogue' }),
      ' ',
      el('a', { href: '/signup', class: 'btn', text: 'Apply for a trade account' }),
    ]),
  ])
  main.append(hero, overlay)
  if (product) {
    const variant = product.variants.find((v) => v.code === product.default_variant) ?? product.variants[0]!
    const canvas = el('canvas', { 'aria-label': 'Kauri Downlight 3D model', role: 'img' })
    hero.append(canvas)
    new ProductViewer(canvas, {
      product_code: product.default_variant,
      finish: variant.finish,
      beam_deg: variant.beam_deg,
      cct_k: variant.cct_k,
      family: product.family,
    })
  }
  void app
}
