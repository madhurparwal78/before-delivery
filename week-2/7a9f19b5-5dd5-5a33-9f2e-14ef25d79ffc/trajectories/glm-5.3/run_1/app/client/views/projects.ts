/** Projects list and the light-pool project screen. */
import { el, status_region, open_dialog } from '../lib/dom.js'
import {
  api, type ProjectPublic, type PlacementPublic, type CommentPublic, type SharePublic,
} from '../lib/api.js'
import { money } from '../lib/domain.js'
import { RoomView } from '../three/room.js'
import {
  placed_announcement, moved_announcement, removed_announcement, all_placed, PROJECT_CREATED,
  CEILING_RANGE, COVER_UPLOADING, COVER_READY, COVER_INVALID, COVER_OUTAGE,
  COLLAB_PAUSED, COLLAB_BACK, COMMENT_TOO_LONG, COMMENT_OUTAGE, COMMENT_POSTED, NOT_TRADE_ACCOUNT,
  invited, share_queued, RECIPIENTS_INVALID,
} from '../lib/copy.js'
import type { App } from '../main.js'

export async function render_projects(main: HTMLElement, app: App): Promise<void> {
  void app
  const user = app.user
  if (!user || user.role !== 'trade' || user.trade_status !== 'approved') {
    main.append(el('div', { class: 'page' }, [el('h1', { text: 'Projects' }), el('p', { text: 'Trade account required.' })]))
    return
  }
  const reply = await api.get<{ projects: ProjectPublic[] }>('/api/projects')
  const grid = el('div', { class: 'card-grid' })
  for (const project of reply.ok ? reply.body.projects : []) {
    grid.append(
      el('article', { class: 'card' }, [
        el('a', { href: `/projects/${project.id}`, class: 'name', text: project.name }),
        el('p', { class: 'muted', text: `Client: ${project.client_name || '—'}` }),
        el('p', { class: 'num', text: `${project.lines.length} lines` }),
      ]),
    )
  }
  const new_button = el('button', { class: 'primary', text: 'New project' })
  new_button.addEventListener('click', () => {
    const name = el('input', { type: 'text', 'aria-label': 'Project name' })
    const client = el('input', { type: 'text', 'aria-label': 'Client' })
    const ceiling = el('input', { type: 'number', value: '2700', 'aria-label': 'Ceiling height (mm)' })
    const dialog = el('dialog', { 'aria-label': 'New project' }, [
      el('h2', { text: 'New project' }),
      el('div', { class: 'field' }, [el('label', { text: 'Project name' }), name]),
      el('div', { class: 'field' }, [el('label', { text: 'Client' }), client]),
      el('div', { class: 'field' }, [el('label', { text: 'Ceiling height (mm)' }), ceiling]),
      el('button', {
        class: 'primary',
        text: 'Create project',
        onclick: async () => {
          const button = dialog.querySelector('button.primary')! as HTMLButtonElement
          button.textContent = 'Saving'
          const created = await api.post<{ project: ProjectPublic }>('/api/projects', {
            name: (name as HTMLInputElement).value.trim(),
            client_name: (client as HTMLInputElement).value.trim(),
            ceiling_height_mm: Number((ceiling as HTMLInputElement).value) || 2700,
          })
          if (created.ok) {
            dialog.close()
            window.location.href = `/projects/${created.body.project.id}`
          } else {
            button.textContent = CEILING_RANGE
          }
        },
      }),
    ])
    document.body.append(dialog)
    open_dialog(dialog, new_button)
  })
  main.append(el('div', { class: 'page' }, [el('h1', { text: `Projects for ${user.name}` }), new_button, grid]))
  void PROJECT_CREATED
}

export async function render_project(main: HTMLElement, app: App, project_id: number): Promise<void> {
  void app
  const reply = await api.get<{ project: ProjectPublic }>(`/api/projects/${project_id}`)
  if (!reply.ok) {
    main.append(el('div', { class: 'page' }, [el('h1', { text: 'Project not found' })]))
    return
  }
  let project = reply.body.project

  const status = status_region('Project updates')
  const live_status = status_region('Live collaboration')
  const room_status = status_region('Room updates')
  const room = el('div', { role: 'region', 'aria-label': 'Light-pool room', 'data-phase': 'settled' })
  const canvas = el('canvas', { 'aria-label': 'Room 3D view', role: 'img', tabindex: '-1' })
  room.append(canvas)
  const room_view = new RoomView(canvas, {
    width_mm: project.room_width_mm,
    depth_mm: project.room_depth_mm,
    ceiling_mm: project.ceiling_height_mm,
    placements: project.placements,
  })

  const ceiling = el('input', {
    type: 'range',
    min: '2400',
    max: '4000',
    step: '100',
    value: String(project.ceiling_height_mm),
    'aria-label': 'Ceiling height',
  })
  const pool_table = el('table', { 'aria-label': 'Light pools' })
  const lines_table = el('table', { 'aria-label': 'Project lines' })
  const unplaced_list = el('ul', { 'aria-label': 'Unplaced fittings', role: 'list' })
  const viewers = el('ul', { 'aria-label': 'Viewing now', role: 'list', class: 'avatars' })
  const comment_thread = el('ul', { 'aria-label': 'Comment thread', role: 'list' })
  const comment_box = el('textarea', { 'aria-label': 'Add a comment' })
  const shares_table = el('table', { 'aria-label': 'Quote shares' })
  const cover_img = el('img', { alt: 'Project cover', 'aria-label': 'Project cover', src: project.cover?.url ?? '' })
  cover_img.hidden = !project.cover

  main.append(
    el('div', { class: 'page' }, [
      el('h1', { text: project.name }),
      el('p', { class: 'muted', text: `Client ${project.client_name}` }),
      live_status,
      el('div', { class: 'room-layout' }, [
        el('div', {}, [room, room_status, el('div', { class: 'section' }, [ceiling, pool_table])]),
        el('div', {}, [build_side_panel()]),
      ]),
      status,
    ]),
  )

  function build_side_panel(): HTMLElement {
    const upload = el('input', { type: 'file', 'aria-label': 'Cover image', accept: 'image/jpeg,image/png,image/webp' })
    upload.hidden = true
    const upload_button = el('button', { text: 'Upload cover' })
    upload_button.addEventListener('click', () => upload.click())
    upload.addEventListener('change', async () => {
      const file = upload.files?.[0]
      if (!file) return
      status.textContent = COVER_UPLOADING
      const form_data = new FormData()
      form_data.append('image', file)
      const response = await fetch(`/api/projects/${project.id}/cover`, { method: 'POST', body: form_data })
      if (response.status === 201) {
        status.textContent = COVER_READY
        const img = await response.json()
        cover_img.src = img.cover.url
        cover_img.hidden = false
      } else if (response.status === 422) {
        status.textContent = COVER_INVALID
      } else if (response.status === 503) {
        status.textContent = COVER_OUTAGE
      } else {
        status.textContent = COVER_INVALID
      }
    })

    const invite_email = el('input', { type: 'email', 'aria-label': 'Collaborator email' })
    const invite_button = el('button', { text: 'Invite' })
    invite_button.addEventListener('click', async () => {
      invite_button.textContent = 'Inviting'
      const result = await api.post<{ collaborator: { name: string } }>(`/api/projects/${project.id}/collaborators`, {
        email: (invite_email as HTMLInputElement).value.trim(),
      })
      invite_button.textContent = 'Invite'
      if (result.ok) status.textContent = invited(result.body.collaborator.name)
      else status.textContent = NOT_TRADE_ACCOUNT
    })

    const post_button = el('button', { text: 'Post comment' })
    post_button.addEventListener('click', async () => {
      post_button.textContent = 'Posting'
      const text = (comment_box as HTMLTextAreaElement).value
      const result = await api.post<{ comment: CommentPublic }>(`/api/projects/${project.id}/comments`, { body: text })
      post_button.textContent = 'Post comment'
      if (result.ok) {
        ;(comment_box as HTMLTextAreaElement).value = ''
        status.textContent = COMMENT_POSTED
        append_comment(result.body.comment)
      } else if (result.status === 422) {
        status.textContent = COMMENT_TOO_LONG
      } else if (result.status === 503) {
        status.textContent = COMMENT_OUTAGE
      }
    })

    const share_button = el('button', { text: 'Share quote' })
    share_button.addEventListener('click', () => {
      const recipients = el('input', { type: 'text', 'aria-label': 'Recipients', placeholder: 'a@example.com, b@example.com' })
      const message = el('input', { type: 'text', 'aria-label': 'Message' })
      const trade_radio = el('input', { type: 'radio', name: 'price-display', value: 'trade', id: 'price-trade' })
      const retail_radio = el('input', { type: 'radio', name: 'price-display', value: 'retail', id: 'price-retail' })
      const none_radio = el('input', { type: 'radio', name: 'price-display', value: 'none', id: 'price-none' })
      none_radio.checked = true
      const dialog = el('dialog', { 'aria-label': 'Share quote' }, [
        el('h2', { text: 'Share quote' }),
        el('div', { class: 'field' }, [el('label', { text: 'Recipients' }), recipients]),
        el('div', { role: 'radiogroup', 'aria-label': 'Price display', class: 'radiogroup' }, [
          el('label', { class: 'choice', for: 'price-trade' }, [trade_radio, 'Trade prices']),
          el('label', { class: 'choice', for: 'price-retail' }, [retail_radio, 'Retail prices']),
          el('label', { class: 'choice', for: 'price-none' }, [none_radio, 'No prices']),
        ]),
        el('div', { class: 'field' }, [el('label', { text: 'Message' }), message]),
        el('button', {
          class: 'primary',
          text: 'Send quote',
          onclick: async (event: MouseEvent) => {
            const button = event.currentTarget as HTMLButtonElement
            button.textContent = 'Sending'
            const list = (recipients as HTMLInputElement).value.split(',').map((s) => s.trim()).filter(Boolean)
            const price_display = document.querySelector<HTMLInputElement>('input[name="price-display"]:checked')!.value
            const result = await api.post<{ share: SharePublic }>(`/api/projects/${project.id}/shares`, {
              recipients: list,
              price_display,
              message: (message as HTMLInputElement).value || undefined,
            })
            if (result.ok) {
              status.textContent = share_queued(list.length)
              dialog.close()
            } else {
              status.textContent = RECIPIENTS_INVALID
            }
            button.textContent = 'Send quote'
          },
        }),
      ])
      document.body.append(dialog)
      open_dialog(dialog, share_button)
    })

    return el('div', {}, [
      el('h2', { text: 'Viewing now' }),
      viewers,
      el('h2', { text: 'Project lines' }),
      lines_table,
      el('h2', { text: 'Unplaced fittings' }),
      unplaced_list,
      el('h2', { text: 'Collaborators' }),
      el('ul', {}, project.collaborators.map((c) => el('li', { text: `${c.name} (${c.email})` }))),
      project.is_owner
        ? el('div', { class: 'field' }, [el('label', { text: 'Collaborator email' }), invite_email, invite_button])
        : null,
      el('h2', { text: 'Comments' }),
      el('div', { role: 'region', 'aria-label': 'Comments' }, [comment_thread, comment_box, post_button]),
      el('h2', { text: 'Cover' }),
      cover_img,
      upload,
      upload_button,
      project.is_owner ? share_button : null,
      el('h2', { text: 'Quote shares' }),
      shares_table,
    ])
  }

  function append_comment(comment: CommentPublic): void {
    comment_thread.append(
      el('li', { class: 'comment' }, [
        el('span', { class: 'meta', text: comment.author_name }),
        el('p', { text: comment.body }),
      ]),
    )
  }

  async function refresh_project(): Promise<void> {
    const fresh = await api.get<{ project: ProjectPublic }>(`/api/projects/${project.id}`)
    if (!fresh.ok) return
    project = fresh.body.project
    redraw()
  }

  function redraw(): void {
    const focused_id = document.activeElement?.getAttribute?.('data-placement-id') ?? null
    // ceiling
    ;(ceiling as HTMLInputElement).value = String(project.ceiling_height_mm)
    room.setAttribute('data-phase', 'settled')
    room_view.update({
      width_mm: project.room_width_mm,
      depth_mm: project.room_depth_mm,
      ceiling_mm: project.ceiling_height_mm,
      placements: project.placements,
    })
    // pool table
    pool_table.replaceChildren(
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Code' }), el('th', { text: 'X (mm)' }), el('th', { text: 'Y (mm)' }),
          el('th', { text: 'Beam' }), el('th', { text: 'Pool diameter (mm)' }), el('th', { text: 'Centre lux' }),
        ]),
      ]),
      el('tbody', {}, project.placements.map((p) =>
        el('tr', {}, [
          el('td', { class: 'num', text: p.variant_code }),
          el('td', { class: 'num', text: String(p.x_mm) }),
          el('td', { class: 'num', text: String(p.y_mm) }),
          el('td', { class: 'num', text: `${p.beam_deg}°` }),
          el('td', { class: 'num', text: String(p.pool_diameter_mm) }),
          el('td', { class: 'num', text: String(p.centre_lux) }),
        ]),
      )),
    )
    // lines table
    lines_table.replaceChildren(
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Code' }), el('th', { text: 'Product' }), el('th', { text: 'Qty' }), el('th', { text: 'Placed' })])]),
      el('tbody', {}, project.lines.map((line) => {
        const qty = el('input', { type: 'number', value: String(line.quantity), min: '0', max: '999', 'aria-label': `Quantity for ${line.variant_code}` })
        qty.addEventListener('change', async () => {
          const value = Number(qty.value) || 0
          const reply = await api.patch(`/api/projects/${project.id}/lines/${line.variant_code}`, { quantity: value })
          if (reply.status === 409) status.textContent = all_placed(line.variant_code)
          await refresh_project()
        })
        return el('tr', {}, [
          el('td', { class: 'num', text: line.variant_code }),
          el('td', { text: line.product_name }),
          el('td', {}, [qty]),
          el('td', { class: 'num', text: `${line.placed}/${line.quantity}` }),
        ])
      })),
    )
    // unplaced fittings
    unplaced_list.replaceChildren()
    for (const line of project.lines) {
      const spare = line.quantity - line.placed
      for (let i = 0; i < spare; i++) {
        unplaced_list.append(
          el('li', {}, [
            el('button', {
              text: `Place ${line.variant_code}`,
              'data-code': line.variant_code,
              onclick: async (event: MouseEvent) => {
                const button = event.currentTarget as HTMLButtonElement
                const centre_x = round_centre(project.room_width_mm / 2)
                const centre_y = round_centre(project.room_depth_mm / 2)
                const result = await api.post<{ placement: PlacementPublic; live: boolean }>(`/api/projects/${project.id}/placements`, {
                  variant_code: line.variant_code,
                  x_mm: centre_x,
                  y_mm: centre_y,
                })
                if (result.status === 409) {
                  room_status.textContent = all_placed(line.variant_code)
                  return
                }
                await refresh_project()
                const placement = result.body.placement
                room_status.textContent = placed_announcement(line.variant_code, placement.x_mm, placement.y_mm, placement.pool_diameter_mm, placement.centre_lux)
                room_view.play_placement(placement.id)
                room.setAttribute('data-phase', room_view.data_phase())
                const placement_button = document.querySelector(`[data-placement-id="${placement.id}"]`) as HTMLButtonElement | null
                placement_button?.focus()
                void button
              },
            }),
          ]),
        )
      }
    }
    // placement buttons over the canvas
    for (const old of Array.from(document.querySelectorAll('.fitting-button'))) old.remove()
    const canvas_rect = canvas.getBoundingClientRect()
    for (const p of project.placements) {
      const button = el('button', {
        class: 'fitting-button',
        text: `${p.variant_code} #${p.ordinal} at ${p.x_mm} mm, ${p.y_mm} mm`,
        'aria-label': `${p.variant_code} #${p.ordinal} at ${p.x_mm} mm, ${p.y_mm} mm`,
        'data-placement-id': String(p.id),
        'data-code': p.variant_code,
        tabindex: '0',
      })
      const pad = 30
      const left = pad + (p.x_mm / project.room_width_mm) * (canvas.clientWidth - pad * 2)
      const top = pad + (p.y_mm / project.room_depth_mm) * (canvas.clientHeight - pad * 2)
      button.style.left = `${left}px`
      button.style.top = `${top}px`
      bind_placement_keys(button, p)
      room.append(button)
      if (focused_id === String(p.id)) button.focus()
    }
    void canvas_rect
    // shares
    void load_shares()
  }

  function bind_placement_keys(button: HTMLButtonElement, placement: PlacementPublic): void {
    const move = async (dx: number, dy: number) => {
      const x = clamp(placement.x_mm + dx, 0, project.room_width_mm)
      const y = clamp(placement.y_mm + dy, 0, project.room_depth_mm)
      const result = await api.patch<{ placement: PlacementPublic }>(`/api/projects/${project.id}/placements/${placement.id}`, { x_mm: x, y_mm: y })
      if (result.ok) {
        placement.x_mm = x
        placement.y_mm = y
        room_status.textContent = moved_announcement(placement.variant_code, x, y)
        await refresh_project()
      }
    }
    button.addEventListener('keydown', async (event: KeyboardEvent) => {
      const step = event.shiftKey ? 500 : 100
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        await move(step, 0)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        await move(-step, 0)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        await move(0, step)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        await move(0, -step)
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        await api.delete(`/api/projects/${project.id}/placements/${placement.id}`)
        room_status.textContent = removed_announcement(placement.variant_code)
        const place_button = document.querySelector(`button[data-code="${placement.variant_code}"]`) as HTMLButtonElement | null
        await refresh_project()
        place_button?.focus()
      } else if (event.key === 'Escape') {
        ceiling.focus()
      }
    })
    // mouse drag on the canvas: move in 100mm steps, save on release
    let drag_active = false
    let drag_start: { x: number; y: number } | null = null
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      drag_active = true
      drag_start = { x: event.clientX, y: event.clientY }
    })
    window.addEventListener('mousemove', (event) => {
      if (!drag_active || !drag_start) return
      const dx = event.clientX - drag_start.x
      const dy = event.clientY - drag_start.y
      const step_x = Math.round(dx / 10) * 100
      const step_y = Math.round(dy / 10) * 100
      void api.patch(`/api/projects/${project.id}/placements/${placement.id}`, {
        x_mm: clamp(placement.x_mm + step_x, 0, project.room_width_mm),
        y_mm: clamp(placement.y_mm + step_y, 0, project.room_depth_mm),
      })
    })
    window.addEventListener('mouseup', () => {
      if (drag_active) {
        drag_active = false
        drag_start = null
        void refresh_project()
      }
    })
  }

  ceiling.addEventListener('input', async () => {
    const value = Number((ceiling as HTMLInputElement).value)
    const reply = await api.patch<{ project: ProjectPublic }>(`/api/projects/${project.id}`, { ceiling_height_mm: value })
    if (reply.ok) {
      project = reply.body.project
      redraw()
    }
  })

  async function load_shares(): Promise<void> {
    const reply = await api.get<{ shares: SharePublic[] }>(`/api/projects/${project.id}/shares`)
    if (!reply.ok) return
    const labels: Record<string, string> = { pending: 'Preparing PDF', ready: 'Ready', waiting_for_storage: 'Waiting for file storage' }
    shares_table.replaceChildren(
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Recipients' }), el('th', { text: 'Price display' }), el('th', { text: 'Status' })])]),
      el('tbody', {}, reply.body.shares.map((share) =>
        el('tr', {}, [
          el('td', { text: share.recipients.join(', ') }),
          el('td', { text: share.price_display }),
          el('td', { text: labels[share.pdf_status] ?? share.pdf_status }),
        ]),
      )),
    )
  }

  async function load_comments(): Promise<void> {
    const reply = await api.get<{ comments: CommentPublic[] }>(`/api/projects/${project.id}/comments`)
    if (!reply.ok) return
    for (const comment of reply.body.comments) append_comment(comment)
  }

  function start_live(): void {
    const source = new EventSource(`/api/projects/${project.id}/live`)
    let was_live = project.live
    source.addEventListener('status', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { live: boolean }
      if (!data.live) live_status.textContent = COLLAB_PAUSED
      else if (!was_live) live_status.textContent = COLLAB_BACK
      was_live = data.live
    })
    source.addEventListener('presence', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { viewers: { user_id: string; name: string; initials: string }[] }
      viewers.replaceChildren(
        ...data.viewers.map((v) => el('li', { class: 'avatar', title: v.name, 'aria-label': v.name }, [v.initials])),
      )
    })
    source.addEventListener('comment', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { comment: CommentPublic }
      append_comment(data.comment)
    })
    source.addEventListener('placement', () => {
      void refresh_project()
    })
  }

  redraw()
  await load_comments()
  start_live()
  void money
}

function round_centre(mm: number): number {
  return Math.ceil(mm / 100) * 100
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}
