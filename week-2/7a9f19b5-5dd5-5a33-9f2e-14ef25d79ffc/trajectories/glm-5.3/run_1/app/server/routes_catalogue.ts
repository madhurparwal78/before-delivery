/** Catalogue, product, comparison, favourites and spec-sheet endpoints. */
import { route, query_list, query_bool, type RouteContext } from './router.js'
import { ApiError, send_json, send_empty } from './http.js'
import { variant_public, product_public, load_variant, type VariantRow, type ProductRow } from './catalogue.js'
import { pool_diameter_mm, own_lux } from './domain.js'
import { finish_name } from './seed.js'

interface ProductWithVariants {
  product: ProductRow
  variants: VariantRow[]
}

async function load_catalogue(ctx: RouteContext): Promise<ProductWithVariants[]> {
  const rows = await ctx.client.query(
    `SELECT p.id, p.slug, p.name, p.family, p.description, p.watts, p.cri, p.ip_rating, p.default_variant
     FROM products p ORDER BY p.id`,
  )
  const variant_rows = await ctx.client.query(
    `SELECT id, code, product_id, finish, beam_deg, cct_k, lumens, candela, retail_price_cents, trade_price_cents,
            clearance, clearance_price_cents, was_price_cents, stock_on_hand
     FROM variants ORDER BY id`,
  )
  const by_product = new Map<number, VariantRow[]>()
  for (const v of variant_rows.rows) {
    const list = by_product.get(v.product_id) ?? []
    list.push(v)
    by_product.set(v.product_id, list)
  }
  return rows.rows.map((product) => ({ product, variants: by_product.get(product.id) ?? [] }))
}

function text_match(haystack: string[], q: string): boolean {
  const needle = q.toLowerCase()
  return haystack.some((text) => text.toLowerCase().includes(needle))
}

export function catalogue_routes(api: Parameters<typeof route>[0]): void {
  route(api, 'GET', '/api/catalogue', async (ctx: RouteContext) => {
    const url = ctx.url
    const q = url.searchParams.get('q')?.trim() ?? ''
    const family = url.searchParams.get('family')
    const finishes = query_list(url, 'finish')
    const beams = query_list(url, 'beam')
    const ccts = query_list(url, 'cct')
    const clearance_only = query_bool(url, 'clearance')
    const all = await load_catalogue(ctx)
    const products = all.filter(({ product, variants }) => {
      if (q !== '' && !text_match([product.name, product.description, ...variants.map((v) => v.code)], q)) return false
      if (family && family !== 'clearance' && product.family !== family) return false
      if ((family === 'clearance' || clearance_only) && !variants.some((v) => v.clearance)) return false
      const matching = variants.some((v) => {
        if (finishes.length > 0 && !finishes.includes(v.finish)) return false
        if (beams.length > 0 && !beams.includes(String(v.beam_deg))) return false
        if (ccts.length > 0 && !ccts.includes(String(v.cct_k))) return false
        if ((family === 'clearance' || clearance_only) && !v.clearance) return false
        return true
      })
      if ((finishes.length > 0 || beams.length > 0 || ccts.length > 0) && !matching) return false
      return true
    })
    send_json(ctx.res, 200, { products: products.map(({ product, variants }) => product_public(product, variants, ctx.caller)) })
  })

  route(api, 'GET', '/api/products/:slug', async (ctx: RouteContext) => {
    const slug = ctx.params['slug']!
    const result = await ctx.client.query<ProductRow>(
      `SELECT id, slug, name, family, description, watts, cri, ip_rating, default_variant FROM products WHERE slug=$1`,
      [slug],
    )
    const product = result.rows[0]
    if (!product) throw new ApiError(404, 'not_found')
    const variants = await ctx.client.query<VariantRow>(
      `SELECT id, code, product_id, finish, beam_deg, cct_k, lumens, candela, retail_price_cents, trade_price_cents,
              clearance, clearance_price_cents, was_price_cents, stock_on_hand
       FROM variants WHERE product_id=$1 ORDER BY id`,
      [product.id],
    )
    send_json(ctx.res, 200, { product: product_public(product, variants.rows, ctx.caller) })
  })

  route(api, 'GET', '/api/compare', async (ctx: RouteContext) => {
    const codes = query_list(ctx.url, 'codes')
    if (codes.length === 0) throw new ApiError(422, 'validation_failed', { codes: 'required' })
    if (codes.length > 4) throw new ApiError(422, 'validation_failed', { codes: 'too_many' })
    const items: Record<string, unknown>[] = []
    for (const code of codes) {
      const variant = await load_variant(ctx.client, code)
      if (!variant) throw new ApiError(404, 'unknown_variant')
      const product = await ctx.client.query<ProductRow>(
        `SELECT p.id, p.slug, p.name, p.family, p.description, p.watts, p.cri, p.ip_rating, p.default_variant
         FROM products p JOIN variants v ON v.product_id=p.id WHERE v.id=$1`,
        [variant.id],
      )
      const p = product.rows[0]!
      const base = {
        product_slug: p.slug,
        product_name: p.name,
        watts: p.watts,
        cri: p.cri,
        ip_rating: p.ip_rating,
        pool_diameter_mm_at_2700: pool_diameter_mm(variant.beam_deg, 2700),
        centre_lux_at_2700: own_lux(variant.candela, 2700),
      }
      items.push({ ...base, ...variant_public(variant, ctx.caller) })
    }
    send_json(ctx.res, 200, { items })
  })

  route(api, 'GET', '/api/variants/:code/spec-sheet', async (ctx: RouteContext) => {
    const variant = await load_variant(ctx.client, ctx.params['code']!)
    if (!variant) throw new ApiError(404, 'not_found')
    const product = await ctx.client.query<ProductRow>(
      `SELECT p.id, p.slug, p.name, p.family, p.description, p.watts, p.cri, p.ip_rating, p.default_variant
       FROM products p JOIN variants v ON v.product_id=p.id WHERE v.id=$1`,
      [variant.id],
    )
    if (product.rows.length === 0) throw new ApiError(404, 'not_found')
    const key = `spec-sheets/${variant.code}.pdf`
    let data: Buffer | null = null
    try {
      data = await ctx.api.deps.storage.get(key)
    } catch {
      data = null
    }
    if (data === null) {
      const { build_spec_sheet_pdf } = await import('./pdf.js')
      const pdf = await build_spec_sheet_pdf(
        product.rows[0]!.name,
        {
          code: variant.code,
          finish_name: finish_name(variant.finish),
          beam_deg: variant.beam_deg,
          cct_k: variant.cct_k,
          lumens: variant.lumens,
          candela: variant.candela,
          retail_price_cents: variant.retail_price_cents,
        },
        product.rows[0]!,
      )
      try {
        await ctx.api.deps.storage.put(key, pdf, 'application/pdf')
        if (!(await ctx.api.deps.storage.exists(key))) throw new Error('not confirmed')
        data = pdf
      } catch {
        throw new ApiError(503, 'storage_unavailable')
      }
    }
    ctx.res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': data.length })
    ctx.res.end(data)
  })

  route(api, 'GET', '/api/favourites', async (ctx: RouteContext) => {
    if (!ctx.caller) throw new ApiError(401, 'unauthenticated')
    const real = await ctx.client.query(
      `SELECT v.code, v.finish, v.beam_deg, v.cct_k, v.lumens, v.candela, v.retail_price_cents, v.trade_price_cents,
              v.clearance, v.clearance_price_cents, v.was_price_cents, v.stock_on_hand,
              p.name AS product_name, p.slug AS product_slug
       FROM favourites f
       JOIN variants v ON v.id=f.variant_id
       JOIN products p ON p.id=v.product_id
       WHERE f.user_id=$1 ORDER BY f.created_at DESC`,
      [ctx.caller.id],
    )
    const items = real.rows.map((row) => ({
      ...variant_public(row as unknown as VariantRow, ctx.caller),
      product_name: row.product_name,
      product_slug: row.product_slug,
    }))
    send_json(ctx.res, 200, { items })
  })

  route(api, 'PUT', '/api/favourites/:code', async (ctx: RouteContext) => {
    if (!ctx.caller) throw new ApiError(401, 'unauthenticated')
    const variant = await load_variant(ctx.client, ctx.params['code']!)
    if (!variant) throw new ApiError(404, 'not_found')
    await ctx.client.query(
      `INSERT INTO favourites (user_id, variant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [ctx.caller.id, variant.id],
    )
    send_json(ctx.res, 200, { saved: true })
  })

  route(api, 'DELETE', '/api/favourites/:code', async (ctx: RouteContext) => {
    if (!ctx.caller) throw new ApiError(401, 'unauthenticated')
    const variant = await load_variant(ctx.client, ctx.params['code']!)
    if (!variant) throw new ApiError(404, 'not_found')
    await ctx.client.query(`DELETE FROM favourites WHERE user_id=$1 AND variant_id=$2`, [ctx.caller.id, variant.id])
    send_empty(ctx.res, 204)
  })
}
