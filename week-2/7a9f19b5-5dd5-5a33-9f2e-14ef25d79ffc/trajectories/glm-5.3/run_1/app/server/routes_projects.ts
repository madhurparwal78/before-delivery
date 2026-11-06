/** Projects, lines, placements, collaborators, comments, live stream and shares. */
import crypto from 'node:crypto'
import { route, type RouteContext } from './router.js'
import { ApiError, read_multipart, send_json, send_empty } from './http.js'
import { load_variant } from './catalogue.js'
import { pool_diameter_mm, centre_lux, own_lux } from './domain.js'
import { queue_share } from './shares.js'

export interface ProjectRow {
  id: number
  name: string
  client_name: string
  owner_id: number
  ceiling_height_mm: number
  room_width_mm: number
  room_depth_mm: number
  cover_ext: string | null
  cover_object: string | null
}

async function project_by_id(ctx: RouteContext, id: string): Promise<{ project: ProjectRow; is_owner: boolean }> {
  if (!ctx.caller) throw new ApiError(401, 'unauthenticated')
  const row = await ctx.client.query<ProjectRow>(
    `SELECT id, name, client_name, owner_id, ceiling_height_mm, room_width_mm, room_depth_mm, cover_ext, cover_object
     FROM projects WHERE id=$1`,
    [Number(id)],
  )
  if (row.rows.length === 0) throw new ApiError(404, 'not_found')
  const project = row.rows[0]
  const is_owner = project.owner_id === ctx.caller.id
  if (!is_owner) {
    const collab = await ctx.client.query(`SELECT 1 FROM project_collaborators WHERE project_id=$1 AND user_id=$2`, [
      project.id,
      ctx.caller.id,
    ])
    if (collab.rowCount === 0) throw new ApiError(404, 'not_found')
  }
  return { project, is_owner }
}

interface PlacementRow {
  id: number
  variant_code: string
  ordinal: number
  x_mm: number
  y_mm: number
  beam_deg: number
  cct_k: number
  candela: number
}

async function placements_for(client: RouteContext['client'], project_id: number): Promise<PlacementRow[]> {
  const rows = await client.query<PlacementRow>(
    `SELECT pl.id, v.code AS variant_code, pl.ordinal, pl.x_mm, pl.y_mm, v.beam_deg, v.cct_k, v.candela
     FROM placements pl JOIN variants v ON v.id=pl.variant_id
     WHERE pl.project_id=$1 ORDER BY pl.id`,
    [project_id],
  )
  return rows.rows
}

function placement_views(rows: PlacementRow[], ceiling: number) {
  const contributors = rows.map((r) => ({ candela: r.candela, x_mm: r.x_mm, y_mm: r.y_mm, beam_deg: r.beam_deg }))
  return rows.map((r) => ({
    id: r.id,
    variant_code: r.variant_code,
    ordinal: r.ordinal,
    x_mm: r.x_mm,
    y_mm: r.y_mm,
    beam_deg: r.beam_deg,
    cct_k: r.cct_k,
    candela: r.candela,
    pool_diameter_mm: pool_diameter_mm(r.beam_deg, ceiling),
    own_lux: own_lux(r.candela, ceiling),
    centre_lux: centre_lux({ candela: r.candela, x_mm: r.x_mm, y_mm: r.y_mm, beam_deg: r.beam_deg }, contributors, ceiling),
  }))
}

async function project_view(ctx: RouteContext, project: ProjectRow, is_owner: boolean, with_placements: boolean, live: boolean): Promise<Record<string, unknown>> {
  const lines = await ctx.client.query(
    `SELECT l.id, v.code AS variant_code, l.product_name, l.quantity,
       (SELECT count(*) FROM placements pl WHERE pl.project_id=l.project_id AND pl.variant_id=l.variant_id)::int AS placed
     FROM project_lines l JOIN variants v ON v.id=l.variant_id WHERE l.project_id=$1 ORDER BY l.id`,
    [project.id],
  )
  const collaborators = await ctx.client.query(
    `SELECT u.id AS user_id, u.name, u.email FROM project_collaborators pc JOIN users u ON u.id=pc.user_id
     WHERE pc.project_id=$1 ORDER BY u.id`,
    [project.id],
  )
  const placements = with_placements ? placement_views(await placements_for(ctx.client, project.id), project.ceiling_height_mm) : []
  return {
    id: project.id,
    name: project.name,
    client_name: project.client_name,
    owner_id: project.owner_id,
    is_owner: is_owner,
    ceiling_height_mm: project.ceiling_height_mm,
    room_width_mm: project.room_width_mm,
    room_depth_mm: project.room_depth_mm,
    cover:
      project.cover_object && project.cover_ext
        ? { status: 'ready' as const, url: `/api/projects/${project.id}/cover` }
        : null,
    lines: lines.rows.map((l) => ({
      variant_code: l.variant_code,
      product_name: l.product_name,
      quantity: l.quantity,
      placed: l.placed,
    })),
    placements,
    collaborators: collaborators.rows,
    live,
  }
}

async function live_status(ctx: RouteContext): Promise<boolean> {
  try {
    return await ctx.api.deps.pocketbase.probe()
  } catch {
    return false
  }
}

const COVER_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function project_routes(api: Parameters<typeof route>[0]): void {
  route(api, 'POST', '/api/projects', async (ctx: RouteContext) => {
    if (!ctx.caller) throw new ApiError(401, 'unauthenticated')
    if (!ctx.caller.is_approved_trade()) throw new ApiError(403, 'trade_account_required')
    const body = ctx.body
    const errors: Record<string, string> = {}
    const name = string_of(body['name'])
    const client_name = string_of(body['client_name'])
    const ceiling = number_of(body['ceiling_height_mm'], 2700)
    const width = number_of(body['room_width_mm'], 6000)
    const depth = number_of(body['room_depth_mm'], 4500)
    if (name === '') errors['name'] = 'required'
    if (ceiling < 2400 || ceiling > 4000) errors['ceiling_height_mm'] = 'out_of_range'
    if (width < 2000 || width > 20000) errors['room_width_mm'] = 'out_of_range'
    if (depth < 2000 || depth > 20000) errors['room_depth_mm'] = 'out_of_range'
    if (Object.keys(errors).length > 0) throw new ApiError(422, 'validation_failed', errors)
    const created = await ctx.client.query<ProjectRow>(
      `INSERT INTO projects (name, client_name, owner_id, ceiling_height_mm, room_width_mm, room_depth_mm)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, client_name, owner_id, ceiling_height_mm, room_width_mm, room_depth_mm, cover_ext, cover_object`,
      [name, client_name, ctx.caller.id, ceiling, width, depth],
    )
    const live = await live_status(ctx)
    send_json(ctx.res, 201, { project: await project_view(ctx, created.rows[0], true, true, live) })
  })

  route(api, 'GET', '/api/projects', async (ctx: RouteContext) => {
    if (!ctx.caller) throw new ApiError(401, 'unauthenticated')
    if (!ctx.caller.is_approved_trade()) throw new ApiError(403, 'trade_account_required')
    const rows = await ctx.client.query<ProjectRow>(
      `SELECT DISTINCT p.id, p.name, p.client_name, p.owner_id, p.ceiling_height_mm, p.room_width_mm, p.room_depth_mm,
              p.cover_ext, p.cover_object
       FROM projects p
       LEFT JOIN project_collaborators pc ON pc.project_id=p.id
       WHERE p.owner_id=$1 OR pc.user_id=$1 ORDER BY p.id`,
      [ctx.caller.id],
    )
    const live = await live_status(ctx)
    const projects = []
    for (const row of rows.rows) {
      projects.push(await project_view(ctx, row, row.owner_id === ctx.caller.id, false, live))
    }
    send_json(ctx.res, 200, { projects })
  })

  route(api, 'GET', '/api/projects/:id', async (ctx: RouteContext) => {
    const { project, is_owner } = await project_by_id(ctx, ctx.params['id']!)
    const live = await live_status(ctx)
    send_json(ctx.res, 200, { project: await project_view(ctx, project, is_owner, true, live) })
  })

  route(api, 'PATCH', '/api/projects/:id', async (ctx: RouteContext) => {
    const { project } = await project_by_id(ctx, ctx.params['id']!)
    const body = ctx.body
    const ceiling = body['ceiling_height_mm'] !== undefined ? number_of(body['ceiling_height_mm'], project.ceiling_height_mm) : project.ceiling_height_mm
    const width = body['room_width_mm'] !== undefined ? number_of(body['room_width_mm'], project.room_width_mm) : project.room_width_mm
    const depth = body['room_depth_mm'] !== undefined ? number_of(body['room_depth_mm'], project.room_depth_mm) : project.room_depth_mm
    const name = body['name'] !== undefined ? string_of(body['name']) : project.name
    const client_name = body['client_name'] !== undefined ? string_of(body['client_name']) : project.client_name
    const errors: Record<string, string> = {}
    if (ceiling < 2400 || ceiling > 4000) errors['ceiling_height_mm'] = 'out_of_range'
    if (width < 2000 || width > 20000) errors['room_width_mm'] = 'out_of_range'
    if (depth < 2000 || depth > 20000) errors['room_depth_mm'] = 'out_of_range'
    if (Object.keys(errors).length > 0) throw new ApiError(422, 'validation_failed', errors)
    const placed = await ctx.client.query<{ x_mm: number; y_mm: number }>(
      'SELECT x_mm, y_mm FROM placements WHERE project_id=$1',
      [project.id],
    )
    for (const p of placed.rows) {
      if (p.x_mm > width || p.y_mm > depth) throw new ApiError(409, 'placements_outside_room', undefined)
    }
    const updated = await ctx.client.query<ProjectRow>(
      `UPDATE projects SET name=$1, client_name=$2, ceiling_height_mm=$3, room_width_mm=$4, room_depth_mm=$5
       WHERE id=$6 RETURNING id, name, client_name, owner_id, ceiling_height_mm, room_width_mm, room_depth_mm, cover_ext, cover_object`,
      [name, client_name, ceiling, width, depth, project.id],
    )
    const live = await live_status(ctx)
    const is_owner = updated.rows[0]!.owner_id === ctx.caller!.id
    send_json(ctx.res, 200, { project: await project_view(ctx, updated.rows[0]!, is_owner, true, live) })
  })

  route(api, 'POST', '/api/projects/:id/lines', async (ctx: RouteContext) => {
    const { project } = await project_by_id(ctx, ctx.params['id']!)
    const body = ctx.body
    const variant_code = string_of(body['variant_code'])
    const quantity = number_of(body['quantity'], NaN)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      throw new ApiError(422, 'validation_failed', { quantity: 'out_of_range' })
    }
    const variant = await load_variant(ctx.client, variant_code)
    if (!variant) throw new ApiError(404, 'unknown_variant')
    const existing = await ctx.client.query<{ id: number }>(
      'SELECT id FROM project_lines WHERE project_id=$1 AND variant_id=$2',
      [project.id, variant.id],
    )
    if (existing.rows[0]) {
      await ctx.client.query('UPDATE project_lines SET quantity=quantity+$1 WHERE id=$2', [quantity, existing.rows[0].id])
    } else {
      const product = await ctx.client.query<{ name: string }>(
        'SELECT p.name FROM products p JOIN variants v ON v.product_id=p.id WHERE v.id=$1',
        [variant.id],
      )
      await ctx.client.query(
        'INSERT INTO project_lines (project_id, variant_id, product_name, quantity) VALUES ($1,$2,$3,$4)',
        [project.id, variant.id, product.rows[0]!.name, quantity],
      )
    }
    const live = await live_status(ctx)
    const is_owner = project.owner_id === ctx.caller!.id
    send_json(ctx.res, 200, { project: await project_view(ctx, project, is_owner, true, live) })
  })

  route(api, 'PATCH', '/api/projects/:id/lines/:code', async (ctx: RouteContext) => {
    const { project } = await project_by_id(ctx, ctx.params['id']!)
    const body = ctx.body
    const quantity = number_of(body['quantity'], NaN)
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999) {
      throw new ApiError(422, 'validation_failed', { quantity: 'out_of_range' })
    }
    const variant = await load_variant(ctx.client, ctx.params['code']!)
    if (!variant) throw new ApiError(404, 'unknown_variant')
    const line = await ctx.client.query<{ id: number }>(
      'SELECT id FROM project_lines WHERE project_id=$1 AND variant_id=$2',
      [project.id, variant.id],
    )
    if (line.rows.length === 0) throw new ApiError(404, 'not_found')
    if (quantity === 0) {
      const placed = await ctx.client.query(`SELECT 1 FROM placements WHERE project_id=$1 AND variant_id=$2`, [
        project.id,
        variant.id,
      ])
      if (placed.rowCount !== 0) throw new ApiError(409, 'placement_exceeds_quantity', undefined)
      await ctx.client.query('DELETE FROM project_lines WHERE id=$1', [line.rows[0].id])
    } else {
      const placed = await ctx.client.query<{ count: string }>(
        'SELECT count(*) AS count FROM placements WHERE project_id=$1 AND variant_id=$2',
        [project.id, variant.id],
      )
      if (Number(placed.rows[0].count) > quantity) throw new ApiError(409, 'placement_exceeds_quantity', undefined)
      await ctx.client.query('UPDATE project_lines SET quantity=$1 WHERE id=$2', [quantity, line.rows[0].id])
    }
    const live = await live_status(ctx)
    const is_owner = project.owner_id === ctx.caller!.id
    send_json(ctx.res, 200, { project: await project_view(ctx, project, is_owner, true, live) })
  })

  route(api, 'POST', '/api/projects/:id/placements', async (ctx: RouteContext) => {
    const { project } = await project_by_id(ctx, ctx.params['id']!)
    const body = ctx.body
    const variant_code = string_of(body['variant_code'])
    const x_mm = number_of(body['x_mm'], NaN)
    const y_mm = number_of(body['y_mm'], NaN)
    const variant = await load_variant(ctx.client, variant_code)
    if (!variant) throw new ApiError(404, 'unknown_variant')
    const errors: Record<string, string> = {}
    if (!Number.isInteger(x_mm) || x_mm < 0 || x_mm > project.room_width_mm) errors['x_mm'] = 'out_of_range'
    if (!Number.isInteger(y_mm) || y_mm < 0 || y_mm > project.room_depth_mm) errors['y_mm'] = 'out_of_range'
    if (Object.keys(errors).length > 0) throw new ApiError(422, 'validation_failed', errors)
    const line = await ctx.client.query<{ quantity: string }>(
      'SELECT quantity FROM project_lines WHERE project_id=$1 AND variant_id=$2',
      [project.id, variant.id],
    )
    if (line.rows.length === 0) {
      // Add the line automatically so a placement always has a quantity to count against.
      const product = await ctx.client.query<{ name: string }>(
        'SELECT p.name FROM products p JOIN variants v ON v.product_id=p.id WHERE v.id=$1',
        [variant.id],
      )
      await ctx.client.query(
        'INSERT INTO project_lines (project_id, variant_id, product_name, quantity) VALUES ($1,$2,$3,1)',
        [project.id, variant.id, product.rows[0]!.name],
      )
    }
    const placed = await ctx.client.query<{ count: string }>(
      'SELECT count(*) AS count FROM placements WHERE project_id=$1 AND variant_id=$2',
      [project.id, variant.id],
    )
    const line_quantity = Number(line.rows[0]?.quantity ?? 1)
    if (Number(placed.rows[0].count) >= line_quantity) {
      throw new ApiError(409, 'placement_exceeds_quantity', undefined)
    }
    const ordinal = await ctx.client.query<{ next: number }>(
      `SELECT COALESCE(MAX(ordinal),0)+1 AS next FROM placements WHERE project_id=$1 AND variant_id=$2`,
      [project.id, variant.id],
    )
    const created = await ctx.client.query<{ id: number }>(
      `INSERT INTO placements (project_id, variant_id, variant_code, ordinal, x_mm, y_mm) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [project.id, variant.id, variant_code, ordinal.rows[0]!.next, x_mm, y_mm],
    )
    try {
      await ctx.api.deps.pocketbase.write_placement(String(project.id), created.rows[0]!.id, variant_code, x_mm, y_mm, 'created')
    } catch {
      // Placement saved; live relay resumes when PocketBase returns.
    }
    const view = await placement_view_of(ctx, project, created.rows[0]!.id)
    const live_probe = await live_status(ctx)
    send_json(ctx.res, 201, { placement: view, live: live_probe })
  })

  route(api, 'PATCH', '/api/projects/:id/placements/:pid', async (ctx: RouteContext) => {
    const { project } = await project_by_id(ctx, ctx.params['id']!)
    const body = ctx.body
    const x_mm = number_of(body['x_mm'], NaN)
    const y_mm = number_of(body['y_mm'], NaN)
    const errors: Record<string, string> = {}
    if (!Number.isInteger(x_mm) || x_mm < 0 || x_mm > project.room_width_mm) errors['x_mm'] = 'out_of_range'
    if (!Number.isInteger(y_mm) || y_mm < 0 || y_mm > project.room_depth_mm) errors['y_mm'] = 'out_of_range'
    if (Object.keys(errors).length > 0) throw new ApiError(422, 'validation_failed', errors)
    const result = await ctx.client.query(
      'UPDATE placements SET x_mm=$1, y_mm=$2 WHERE id=$3 AND project_id=$4 RETURNING variant_id',
      [x_mm, y_mm, Number(ctx.params['pid']), project.id],
    )
    if (result.rows.length === 0) throw new ApiError(404, 'not_found')
    const variant_code = await ctx.client.query<{ code: string }>('SELECT code FROM variants WHERE id=$1', [
      result.rows[0].variant_id,
    ])
    try {
      await ctx.api.deps.pocketbase.write_placement(
        String(project.id), Number(ctx.params['pid']), variant_code.rows[0]!.code, x_mm, y_mm, 'updated',
      )
    } catch {
      // Saved; relay resumes later.
    }
    const view = await placement_view_of(ctx, project, Number(ctx.params['pid']))
    const live_probe = await live_status(ctx)
    send_json(ctx.res, 200, { placement: view, live: live_probe })
  })

  route(api, 'DELETE', '/api/projects/:id/placements/:pid', async (ctx: RouteContext) => {
    const { project } = await project_by_id(ctx, ctx.params['id']!)
    const found = await ctx.client.query<{ variant_id: number }>(
      'SELECT variant_id FROM placements WHERE id=$1 AND project_id=$2',
      [Number(ctx.params['pid']), project.id],
    )
    if (found.rows.length === 0) throw new ApiError(404, 'not_found')
    const variant_code = await ctx.client.query<{ code: string }>('SELECT code FROM variants WHERE id=$1', [
      found.rows[0].variant_id,
    ])
    const placement = await ctx.client.query<{ x_mm: number; y_mm: number }>(
      'SELECT x_mm, y_mm FROM placements WHERE id=$1',
      [Number(ctx.params['pid'])],
    )
    await ctx.client.query('DELETE FROM placements WHERE id=$1', [Number(ctx.params['pid'])])
    try {
      await ctx.api.deps.pocketbase.write_placement(
        String(project.id), Number(ctx.params['pid']), variant_code.rows[0]!.code,
        placement.rows[0]!.x_mm, placement.rows[0]!.y_mm, 'deleted',
      )
    } catch {
      // Saved; relay resumes later.
    }
    send_empty(ctx.res, 204)
  })

  route(api, 'POST', '/api/projects/:id/cover', async (ctx: RouteContext) => {
    const { project } = await project_by_id(ctx, ctx.params['id']!)
    const parts = await read_multipart(ctx.req, 5_000_000)
    const image = parts['image']
    if (!image) throw new ApiError(422, 'validation_failed', { image: 'required' })
    const ext = COVER_TYPES[image.content_type ?? '']
    if (!ext) throw new ApiError(422, 'validation_failed', { image: 'unsupported_type' })
    const object_key = `covers/${project.id}/${crypto.randomUUID()}.${ext}`
    try {
      await ctx.api.deps.storage.put(object_key, image.data, image.content_type!)
      if (!(await ctx.api.deps.storage.exists(object_key))) {
        throw new ApiError(503, 'storage_unavailable')
      }
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw new ApiError(503, 'storage_unavailable')
    }
    await ctx.client.query('UPDATE projects SET cover_ext=$1, cover_object=$2 WHERE id=$3', [
      ext,
      object_key,
      project.id,
    ])
    send_json(ctx.res, 201, { cover: { status: 'ready', url: `/api/projects/${project.id}/cover` } })
  }, { raw: true })

  route(api, 'GET', '/api/projects/:id/cover', async (ctx: RouteContext) => {
    await project_by_id(ctx, ctx.params['id']!)
    const project = await ctx.client.query<{ cover_object: string | null; cover_ext: string | null }>(
      'SELECT cover_object, cover_ext FROM projects WHERE id=$1',
      [Number(ctx.params['id'])],
    )
    const row = project.rows[0]!
    if (!row.cover_object) throw new ApiError(404, 'not_found')
    let data: Buffer
    try {
      data = await ctx.api.deps.storage.get(row.cover_object)
    } catch {
      throw new ApiError(503, 'storage_unavailable')
    }
    ctx.res.writeHead(200, { 'Content-Type': `image/${row.cover_ext === 'jpg' ? 'jpeg' : row.cover_ext}` })
    ctx.res.end(data)
  })

  route(api, 'POST', '/api/projects/:id/collaborators', async (ctx: RouteContext) => {
    const { project, is_owner } = await project_by_id(ctx, ctx.params['id']!)
    if (!is_owner) throw new ApiError(403, 'owner_only')
    const body = ctx.body
    const email = string_of(body['email']).trim().toLowerCase()
    if (email === '') throw new ApiError(422, 'validation_failed', { email: 'required' })
    const user = await ctx.client.query<{ id: number; name: string; email: string }>(
      'SELECT id, name, email FROM users WHERE lower(email)=$1',
      [email],
    )
    if (user.rows.length === 0) throw new ApiError(422, 'validation_failed', { email: 'not_a_trade_account' })
    const target = user.rows[0]
    const approved = await ctx.client.query(`SELECT trade_status FROM users WHERE id=$1`, [target.id])
    if (approved.rows[0]?.trade_status !== 'approved') {
      throw new ApiError(422, 'validation_failed', { email: 'not_a_trade_account' })
    }
    await ctx.client.query(
      'INSERT INTO project_collaborators (project_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [project.id, target.id],
    )
    send_json(ctx.res, 201, { collaborator: { user_id: target.id, name: target.name, email: target.email } })
  })

  route(api, 'DELETE', '/api/projects/:id/collaborators/:userId', async (ctx: RouteContext) => {
    const { project, is_owner } = await project_by_id(ctx, ctx.params['id']!)
    if (!is_owner) throw new ApiError(403, 'owner_only')
    await ctx.client.query('DELETE FROM project_collaborators WHERE project_id=$1 AND user_id=$2', [
      project.id,
      Number(ctx.params['userId']),
    ])
    send_empty(ctx.res, 204)
  })

  route(api, 'GET', '/api/projects/:id/comments', async (ctx: RouteContext) => {
    await project_by_id(ctx, ctx.params['id']!)
    const comments = await ctx.api.deps.pocketbase.list_comments(ctx.params['id']!)
    send_json(ctx.res, 200, { comments })
  })

  route(api, 'POST', '/api/projects/:id/comments', async (ctx: RouteContext) => {
    const caller = ctx.caller!
    await project_by_id(ctx, ctx.params['id']!)
    const body = ctx.body
    const text = string_of(body['body'])
    if (text.length < 1 || text.length > 2000) {
      throw new ApiError(422, 'validation_failed', { body: 'out_of_range' })
    }
    const comment = await ctx.api.deps.pocketbase.create_comment(ctx.params['id']!, caller.id, caller.name, text)
    send_json(ctx.res, 201, { comment })
  })

  route(api, 'GET', '/api/projects/:id/live', async (ctx: RouteContext) => {
    await project_by_id(ctx, ctx.params['id']!)
    await live_stream(ctx)
  })

  route(api, 'POST', '/api/projects/:id/shares', async (ctx: RouteContext) => {
    const { project, is_owner } = await project_by_id(ctx, ctx.params['id']!)
    if (!is_owner) throw new ApiError(403, 'owner_only')
    const body = ctx.body
    const recipients = Array.isArray(body['recipients'])
      ? (body['recipients'] as unknown[]).map((r) => (typeof r === 'string' ? r.trim().toLowerCase() : ''))
      : []
    const price_display = string_of(body['price_display'])
    const message = body['message'] !== undefined ? string_of(body['message']) : null
    const errors: Record<string, string> = {}
    const valid_email = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)
    if (recipients.length < 1 || recipients.length > 10 || !recipients.every(valid_email)) {
      errors['recipients'] = 'invalid'
    }
    if (!['trade', 'retail', 'none'].includes(price_display)) errors['price_display'] = 'invalid'
    if (message !== null && message.length > 1000) errors['message'] = 'too_long'
    if (Object.keys(errors).length > 0) throw new ApiError(422, 'validation_failed', errors)
    const id = crypto.randomUUID()
    await ctx.client.query(
      `INSERT INTO shares (id, project_id, owner_id, price_display, recipients, message, pdf_status)
       VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
      [id, project.id, ctx.caller!.id, price_display, JSON.stringify(recipients), message],
    )
    const share = {
      id,
      price_display,
      recipients,
      pdf_status: 'pending',
      created_at: new Date().toISOString(),
    }
    void queue_share(ctx.api, id)
    send_json(ctx.res, 201, { share })
  })

  route(api, 'GET', '/api/projects/:id/shares', async (ctx: RouteContext) => {
    await project_by_id(ctx, ctx.params['id']!)
    const rows = await ctx.client.query(
      `SELECT id, price_display, recipients, pdf_status, created_at FROM shares WHERE project_id=$1 ORDER BY created_at`,
      [Number(ctx.params['id'])],
    )
    send_json(ctx.res, 200, {
      shares: rows.rows.map((r) => ({
        id: r.id,
        price_display: r.price_display,
        recipients: JSON.parse(r.recipients) as string[],
        pdf_status: r.pdf_status,
        created_at: r.created_at.toISOString(),
      })),
    })
  })

  route(api, 'GET', '/api/shares/:shareId/pdf', async (ctx: RouteContext) => {
    const share = await ctx.client.query<{ object_key: string | null }>(
      'SELECT object_key FROM shares WHERE id=$1 AND pdf_status=$2',
      [ctx.params['shareId'], 'ready'],
    )
    if (share.rows.length === 0 || !share.rows[0].object_key) throw new ApiError(409, 'pdf_not_ready', undefined)
    let data: Buffer
    try {
      data = await ctx.api.deps.storage.get(share.rows[0].object_key)
    } catch {
      throw new ApiError(503, 'storage_unavailable')
    }
    ctx.res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': data.length })
    ctx.res.end(data)
  })
}

/** The placement's view, computed over every placement in the project. */
async function placement_view_of(ctx: RouteContext, project: ProjectRow, placement_id: number) {
  const rows = await placements_for(ctx.client, project.id)
  const views = placement_views(rows, project.ceiling_height_mm)
  return views.find((v) => v.id === placement_id) ?? null
}

function string_of(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function number_of(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return fallback
}

/** Live stream: presence heartbeat from PocketBase, comments and placements relayed. */
async function live_stream(ctx: RouteContext): Promise<void> {
  const res = ctx.res
  const project_id = ctx.params['id']!
  const caller = ctx.caller!
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  let closed = false
  const presence_timer = setInterval(() => {
    void ctx.api.deps.pocketbase
      .upsert_presence(project_id, String(caller.id), caller.name, initials_of(caller.name))
      .then(async (ok) => {
        if (!ok) return
        const viewers = await ctx.api.deps.pocketbase.list_presence(project_id)
        send('presence', { viewers })
      })
      .catch(() => {})
  }, 10_000)
  const heartbeat_timer = setInterval(() => {
    res.write(': keepalive\n\n')
  }, 15_000)
  const live_probe = setInterval(() => {
    void ctx.api.deps.pocketbase.probe().then((live) => send('status', { live }))
  }, 5_000)
  const on_close = () => {
    if (closed) return
    closed = true
    clearInterval(presence_timer)
    clearInterval(heartbeat_timer)
    clearInterval(live_probe)
    ctx.api.deps.pocketbase.off_event(listener)
    void ctx.api.deps.pocketbase.remove_presence(project_id, String(caller.id))
    res.end()
  }
  const relay = (event: { kind: string; project_id: string; comment?: unknown; placement?: unknown; action?: string }) => {
    if (event.project_id !== project_id) return
    if (event.kind === 'comment' && event.comment) send('comment', { comment: event.comment })
    if (event.kind === 'placement' && event.placement) {
      send('placement', { action: event.action, placement: event.placement })
    }
  }
  const listener = (event: { kind: string; project_id: string }) => {
    if (event.project_id !== project_id) return
    if (event.kind === 'presence') {
      void ctx.api.deps.pocketbase.list_presence(project_id).then((viewers) => {
        send('presence', { viewers })
      }).catch(() => {})
    }
  }
  ctx.api.deps.pocketbase.on_event(listener)
  ctx.api.deps.pocketbase.on_event(relay)
  ctx.req.on('close', on_close)
  res.on('close', on_close)
  // Initial state.
  void ctx.api.deps.pocketbase.probe().then((live) => send('status', { live }))
  void ctx.api.deps.pocketbase.upsert_presence(project_id, String(caller.id), caller.name, initials_of(caller.name))
    .then(async () => {
      const viewers = await ctx.api.deps.pocketbase.list_presence(project_id)
      send('presence', { viewers })
    })
    .catch(() => {})
}

export function initials_of(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts.map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase()
}
