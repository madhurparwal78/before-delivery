/** Product page: 3D viewer, variant picker, spec drawers, add actions. */
import { el, status_region, open_dialog } from '../lib/dom.js'
import { api, idempotency_key, type ProductPublic, type VariantPublic } from '../lib/api.js'
import { money, pool_diameter_mm, own_lux } from '../lib/domain.js'
import { ProductViewer } from '../three/viewer.js'
import { variant_announcement, SPEC_SHEET_PENDING, SPEC_SHEET_OUTAGE, added_to_cart, stock_left, SOLD_OUT } from '../lib/copy.js'
import { compare_button, } from '../lib/tray.js'
import { favourite_button } from './card.js'
import type { App } from '../main.js'

export async function render_product(main: HTMLElement, app: App, slug: string): Promise<void> {
  const reply = await api.get<{ product: ProductPublic }>(`/api/products/${slug}`)
  if (!reply.ok) {
    main.append(el('h1', { text: 'Not found' }))
    return
  }
  const product = reply.body.product
  const url = new URL(location.href)
  const initial_code = url.searchParams.get('variant') ?? product.default_variant
  let current = product.variants.find((v) => v.code === initial_code) ?? product.variants[0]!

  const status = status_region('Product updates')
  const readout = el('div', { class: 'readout', role: 'region', 'aria-label': 'Light readout' })
  const canvas_holder = el('div', {})
  const viewer_ref: { current: ProductViewer | null } = { current: null }

  const quantity = el('input', { type: 'number', value: '1', min: '1', max: '999', 'aria-label': 'Quantity' })

  const heading = el('h1', { text: product.name })
  main.append(
    el('div', { class: 'page' }, [
      heading,
      el('div', { class: 'product-layout' }, [
        el('div', {}, [canvas_holder]),
        el('div', { role: 'region', 'aria-label': 'Specification' }, [
          el('p', { class: 'muted', text: product.description }),
          build_picker(),
          readout,
          build_add_row(),
          status,
          build_drawers(),
        ]),
      ]),
    ]),
  )

  // Quick add bar (visible at 375; CSS positions it fixed).
  const quick_price = el('span', { class: 'num' })
  const quick_add = el('div', { class: 'quick-add', role: 'region', 'aria-label': 'Quick add' }, [
    quick_price,
    el('button', { class: 'primary', text: 'Add to cart', onclick: () => add_to_cart() }),
  ])
  main.append(quick_add)

  function variant_price(v: VariantPublic): number {
    const trade = app.user && (app.user.role === 'admin' || (app.user.role === 'trade' && app.user.trade_status === 'approved'))
    return trade ? (v.trade_price_cents ?? v.retail_price_cents) : v.retail_price_cents
  }

  function update_readout(): void {
    const pool = pool_diameter_mm(current.beam_deg, 2700)
    const lux = own_lux(current.candela, 2700)
    readout.replaceChildren(
      el('div', { class: 'label', text: 'Price' }),
      el('div', { class: 'value', text: `${money(variant_price(current))} + GST` }),
      el('div', { class: 'label', text: 'Lumens' }),
      el('div', { class: 'value', text: String(current.lumens) }),
      el('div', { class: 'label', text: 'Pool at 2.7 m' }),
      el('div', { class: 'value', text: `${pool} mm` }),
      el('div', { class: 'label', text: 'Centre at 2.7 m' }),
      el('div', { class: 'value', text: `${lux} lux` }),
    )
    quick_price.textContent = `${money(variant_price(current))} + GST`
    const stock_note = current.clearance ? (current.stock_on_hand === 0 ? SOLD_OUT : stock_left(current.stock_on_hand ?? 0)) : null
    if (stock_note) readout.append(el('div', { class: 'badge', text: stock_note }))
  }

  function select_variant(v: VariantPublic): void {
    current = v
    update_readout()
    const url = new URL(location.href)
    url.searchParams.set('variant', v.code)
    history.replaceState({}, '', url.toString())
    for (const input of document.querySelectorAll<HTMLInputElement>('input[name="finish"]')) {
      input.checked = input.value === v.finish
    }
    for (const input of document.querySelectorAll<HTMLInputElement>('input[name="beam"]')) {
      input.checked = input.value === String(v.beam_deg)
    }
    for (const input of document.querySelectorAll<HTMLInputElement>('input[name="cct"]')) {
      input.checked = input.value === String(v.cct_k)
    }
    viewer_ref.current?.update({ finish: v.finish, beam_deg: v.beam_deg, cct_k: v.cct_k })
    status.textContent = variant_announcement(product.name, v.finish_name, v.beam_deg, v.cct_k, v.lumens, money(variant_price(v)))
  }

  function build_picker(): HTMLElement {
    const finishes = Array.from(new Set(product.variants.map((v) => v.finish)))
    const beams = Array.from(new Set(product.variants.map((v) => v.beam_deg)))
    const ccts = Array.from(new Set(product.variants.map((v) => v.cct_k)))
    const exists = (finish: string, beam: number, cct: number) =>
      product.variants.some((v) => v.finish === finish && v.beam_deg === beam && v.cct_k === cct)
    const make_group = (name: string, options: { value: string; label: string; enabled: boolean }[], kind: 'finish' | 'beam' | 'cct') => {
      const box = el('div', { role: 'radiogroup', 'aria-label': name, class: 'radiogroup' })
      for (const option of options) {
        const input = el('input', { type: 'radio', name: kind, id: `${kind}-${option.value}`, value: option.value })
        input.disabled = !option.enabled
        if (!option.enabled) input.setAttribute('aria-disabled', 'true')
        input.addEventListener('change', () => {
          const finish = kind === 'finish' ? option.value : current.finish
          const beam = kind === 'beam' ? Number(option.value) : current.beam_deg
          const cct = kind === 'cct' ? Number(option.value) : current.cct_k
          const match = product.variants.find((v) => v.finish === finish && v.beam_deg === beam && v.cct_k === cct)
          if (match) select_variant(match)
        })
        box.append(el('label', { class: 'choice', for: `${kind}-${option.value}` }, [input, option.label]))
      }
      return box
    }
    const holder = el('div', {})
    holder.append(
      el('label', { text: 'Finish' }),
      make_group('Finish', finishes.map((f) => ({ value: f, label: product.variants.find((v) => v.finish === f)!.finish_name, enabled: true })), 'finish'),
      el('label', { text: 'Beam angle' }),
      make_group('Beam angle', beams.map((b) => ({ value: String(b), label: `${b}°`, enabled: ccts.some((c) => exists(current.finish, b, c)) })), 'beam'),
      el('label', { text: 'Colour temperature' }),
      make_group('Colour temperature', ccts.map((c) => ({ value: String(c), label: `${c}K`, enabled: beams.some((b) => exists(current.finish, b, c)) })), 'cct'),
    )
    return holder
  }

  function build_add_row(): HTMLElement {
    const is_trade = app.user && app.user.role === 'trade' && app.user.trade_status === 'approved'
    const add = is_trade
      ? el('button', { class: 'primary', text: 'Add to project', onclick: () => open_project_dialog() })
      : el('button', { class: 'primary', text: 'Add to cart', onclick: () => add_to_cart() })
    return el('div', { class: 'actions' }, [
      quantity,
      add,
      el('button', { text: 'Compare', onclick: () => void app.tray.add(current.code, product.name).then(() => undefined) }),
      favourite_button(app, current.code, product.name, false),
    ])
  }

  async function add_to_cart(): Promise<void> {
    if (!app.user) {
      window.location.href = '/signin'
      return
    }
    const qty = Number((quantity as HTMLInputElement).value) || 1
    const reply = await api.post<{ order: { subtotal_cents: number }; available?: number }>('/api/cart/lines', {
      variant_code: current.code,
      quantity: qty,
    })
    if (reply.status === 409) {
      status.textContent = stock_left(reply.body.available ?? 0)
      return
    }
    if (reply.ok) {
      const subtotal = money(reply.body.order.subtotal_cents)
      status.textContent = added_to_cart(qty, subtotal)
      await app.refresh_header()
    }
  }

  function open_project_dialog(): void {
    void (async () => {
      const projects = await api.get<{ projects: { id: number; name: string }[] }>('/api/projects')
      const select = el('select', { 'aria-label': 'Project' }, [
        el('option', { value: '', text: 'New project' }),
        ...(projects.ok ? projects.body.projects.map((p) => el('option', { value: String(p.id), text: p.name })) : []),
      ])
      const qty = el('input', { type: 'number', value: '1', min: '1', max: '999', 'aria-label': 'Quantity' })
      const project_name = el('input', { type: 'text', 'aria-label': 'Project name', placeholder: 'Project name' })
      const dialog = el('dialog', { 'aria-label': 'Add to project' }, [
        el('h2', { text: 'Add to project' }),
        el('div', { class: 'field' }, [el('label', { text: 'Project' }), select]),
        el('div', { class: 'field' }, [el('label', { text: 'Quantity' }), qty]),
        el('div', { class: 'field' }, [el('label', { text: 'New project name' }), project_name]),
        el('div', { class: 'field' }, [
          el('label', { text: 'Ceiling height (mm)' }),
          el('input', { type: 'number', value: '2700', min: '2400', max: '4000', 'aria-label': 'Ceiling height (mm)', id: 'ceiling-input' }),
        ]),
        el('button', {
          class: 'primary',
          text: 'Add',
          onclick: async () => {
            const { PROJECT_CREATED, added_to_project, CEILING_RANGE } = await import('../lib/copy.js')
            const ceiling = Number((document.getElementById('ceiling-input') as HTMLInputElement).value) || 2700
            const existing_id = Number((select as HTMLSelectElement).value)
            if (!existing_id) {
              const created = await api.post<{ project: { id: number; name: string } }>('/api/projects', {
                name: (project_name as HTMLInputElement).value.trim() || `Project ${new Date().toLocaleDateString()}`,
                ceiling_height_mm: ceiling,
              })
              if (!created.ok) {
                status.textContent = CEILING_RANGE
                return
              }
              const line = await api.post<{ project: { name: string } }>(`/api/projects/${created.body.project.id}/lines`, {
                variant_code: current.code,
                quantity: Number((qty as HTMLInputElement).value) || 1,
              })
              if (line.ok) status.textContent = PROJECT_CREATED
              dialog.close()
              return
            }
            const line = await api.post<{ project: { name: string } }>(`/api/projects/${existing_id}/lines`, {
              variant_code: current.code,
              quantity: Number((qty as HTMLInputElement).value) || 1,
            })
            if (line.ok) {
              status.textContent = added_to_project(Number((qty as HTMLInputElement).value) || 1, current.code, line.body.project.name)
            }
            dialog.close()
          },
        }),
      ])
      document.body.append(dialog)
      open_dialog(dialog, document.activeElement as HTMLElement)
    })()
  }

  function build_drawers(): HTMLElement {
    const drawer = (title: string, open_default: boolean, body: () => HTMLElement) => {
      const panel = el('div', { class: 'drawer-body', hidden: !open_default })
      const button = el('button', {
        class: 'drawer-toggle linklike',
        text: title,
        'aria-expanded': String(open_default),
        'aria-controls': panel.id = `drawer-${title}`,
        onclick: () => {
          const expanded = button.getAttribute('aria-expanded') === 'true'
          button.setAttribute('aria-expanded', String(!expanded))
          panel.hidden = expanded
          if (!expanded) panel.append(body())
        },
      })
      if (open_default) panel.append(body())
      return el('div', {}, [button, panel])
    }
    const photometrics = () =>
      el('div', {}, [
        el('p', { class: 'num', text: `Lumens: ${current.lumens}` }),
        el('p', { class: 'num', text: `Candela: ${current.candela}` }),
        el('p', { class: 'num', text: `Pool at 2.7 m: ${pool_diameter_mm(current.beam_deg, 2700)} mm` }),
        el('p', { class: 'num', text: `Centre at 2.7 m: ${own_lux(current.candela, 2700)} lux` }),
      ])
    const dimensions = () =>
      el('div', {}, [
        el('p', { class: 'num', text: `Watts: ${product.watts} W` }),
        el('p', { class: 'num', text: `CRI: ${product.cri}` }),
        el('p', { class: 'num', text: `IP rating: ${product.ip_rating}` }),
      ])
    const downloads = () => {
      const link = el('a', { href: '#', text: 'Spec sheet (PDF)' })
      link.addEventListener('click', async (event) => {
        event.preventDefault()
        link.textContent = SPEC_SHEET_PENDING
        const response = await fetch(`/api/variants/${current.code}/spec-sheet`)
        if (response.ok) {
          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          const download = el('a', { href: url, download: `${current.code}-spec-sheet.pdf` })
          download.click()
          URL.revokeObjectURL(url)
          link.textContent = 'Spec sheet (PDF)'
        } else if (response.status === 503) {
          link.textContent = 'Spec sheet (PDF)'
          status.textContent = SPEC_SHEET_OUTAGE
        } else {
          link.textContent = 'Spec sheet (PDF)'
        }
      })
      return el('div', {}, [link])
    }
    return el('div', {}, [
      drawer('Photometrics', true, photometrics),
      drawer('Dimensions', false, dimensions),
      drawer('Downloads', false, downloads),
    ])
  }

  // Build the viewer last so the canvas has its size.
  const canvas = el('canvas', {
    role: 'img',
    'aria-label': `${product.name} 3D model`,
    'data-yaw': '0',
    'data-beam': String(current.beam_deg),
    'data-cct': String(current.cct_k),
    'data-idle': 'on',
  })
  canvas_holder.append(canvas)
  viewer_ref.current = new ProductViewer(canvas, {
    product_code: current.code,
    finish: current.finish,
    beam_deg: current.beam_deg,
    cct_k: current.cct_k,
    family: product.family,
  })
  update_readout()
  void idempotency_key
  void compare_button
}
