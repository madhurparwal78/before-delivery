/** Newsletter and remaining endpoints. */
import crypto from 'node:crypto'
import { route, type RouteContext } from './router.js'
import { ApiError, send_json } from './http.js'
import { newsletter_confirm_email } from './mail.js'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function misc_routes(api: Parameters<typeof route>[0]): void {
  route(api, 'POST', '/api/newsletter', async (ctx: RouteContext) => {
    const body = ctx.body
    const email = typeof body['email'] === 'string' ? body['email'].trim().toLowerCase() : ''
    const occupation = typeof body['occupation'] === 'string' ? body['occupation'] : ''
    const consent = body['consent']
    const errors: Record<string, string> = {}
    if (consent !== true) errors['consent'] = 'required'
    if (!EMAIL_RE.test(email)) errors['email'] = 'invalid'
    if (!['architect', 'trade', 'wholesaler', 'other'].includes(occupation)) errors['occupation'] = 'invalid'
    if (Object.keys(errors).length > 0) throw new ApiError(422, 'validation_failed', errors)
    const token = crypto.randomBytes(24).toString('hex')
    await ctx.client.query(
      `INSERT INTO newsletter_subscriptions (email, occupation, token) VALUES ($1,$2,$3)`,
      [email, occupation, token],
    )
    const link = `${public_url(ctx)}/newsletter/confirm?token=${token}`
    const email_parts = newsletter_confirm_email(link, occupation)
    try {
      await ctx.api.deps.mailer.send(email, email_parts.subject, email_parts.text, email_parts.html)
    } catch {
      // Mail outage: the subscription waits for the retry cadence.
    }
    send_json(ctx.res, 202, { status: 'pending_confirmation' })
  })

  route(api, 'GET', '/api/newsletter/confirm', async (ctx: RouteContext) => {
    const token = ctx.url.searchParams.get('token')
    if (!token) throw new ApiError(404, 'unknown_token')
    const row = await ctx.client.query(
      `SELECT email, occupation, confirmed_at FROM newsletter_subscriptions WHERE token=$1`,
      [token],
    )
    if (row.rows.length === 0) throw new ApiError(404, 'unknown_token')
    if (!row.rows[0].confirmed_at) {
      await ctx.client.query(`UPDATE newsletter_subscriptions SET confirmed_at=now() WHERE token=$1`, [token])
    }
    send_json(ctx.res, 200, { status: 'confirmed', email: row.rows[0].email, occupation: row.rows[0].occupation })
  })
}

function public_url(ctx: RouteContext): string {
  const configured = process.env['APP_PUBLIC_URL']
  if (configured) return configured.replace(/\/$/, '')
  const host = ctx.req.headers.host ?? `localhost:${process.env['APP_PUBLIC_PORT'] ?? '4173'}`
  return `http://${host}`
}
