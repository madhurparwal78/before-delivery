/** Sign-up, sign-in, sign-out and email confirmation. */
import { config } from './config'
import { one, pool, transaction } from './db'
import { ApiError } from './errors'
import { clearedCookie, route, sessionCookie, sessionToken } from './http'
import { MailError, sendMail } from './mail'
import { PLAYER_COLUMNS, type PlayerRow, createPlayer, hashToken, openSession, playerOfCredentials, sixDigitCode, toPlayer } from './players'
import { EMAIL, isText, lengthOf } from './validate'

const UNIQUE_VIOLATION = '23505'

async function mailCode(to: string, code: string): Promise<void> {
  await sendMail({ to, subject: 'Your Hushfoot confirmation code', text: `Your code is ${code}.\n\nType it on the Hushfoot confirm page to post postcards, pin notes and enter boards.` })
}

async function mainWorldId(): Promise<string> {
  const world = await one<{ id: string }>(pool, `SELECT id FROM worlds WHERE kind = 'main'`)
  return (world as { id: string }).id
}

route('POST', '/api/signup', 'none', async (c) => {
  const body = await c.json()
  const name = isText(body.name) ? body.name.trim() : ''
  const email = isText(body.email) ? body.email.trim() : ''
  const password = isText(body.password) ? body.password : ''
  if (EMAIL.test(email) && (await one(pool, 'SELECT 1 FROM players WHERE lower(email) = lower($1)', [email]))) throw new ApiError('email_taken')
  if (name === '' || lengthOf(name) > 40) throw new ApiError('bad_name')
  if (!EMAIL.test(email)) throw new ApiError('bad_email')
  if (lengthOf(password) < 8) throw new ApiError('bad_password')
  const code = sixDigitCode()
  const worldId = await mainWorldId()
  const player = await transaction((client) => createPlayer(client, { worldId, name, email, password, code })).catch((error: unknown) => {
    throw (error as { code?: string }).code === UNIQUE_VIOLATION ? new ApiError('email_taken') : error
  })
  const sent = await mailCode(email, code).then(() => true, (error: unknown) => {
    if (error instanceof MailError) return false
    throw error
  })
  const token = await openSession(pool, player.id)
  return { status: 201, body: { player: toPlayer(player, true), code_sent: sent }, headers: { 'Set-Cookie': sessionCookie(token) } }
})

route('POST', '/api/session', 'none', async (c) => {
  const body = await c.json()
  const player = await playerOfCredentials(pool, isText(body.email) ? body.email.trim() : '', isText(body.password) ? body.password : '')
  const token = await openSession(pool, player.id)
  return { status: 200, body: { player: toPlayer(player, true) }, headers: { 'Set-Cookie': sessionCookie(token) } }
})

route('DELETE', '/api/session', 'none', async (c) => {
  const token = sessionToken(c.req)
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)])
  return { status: 204, headers: { 'Set-Cookie': clearedCookie } }
})

route('POST', '/api/confirm', 'required', async (c) => {
  const player = c.player as PlayerRow
  const body = await c.json()
  if (player.confirmed) return { status: 200, body: { player: toPlayer(player, true) } }
  const stored = await one<{ confirm_code: string | null; expired: boolean }>(pool, 'SELECT confirm_code, confirm_code_expires < now() AS expired FROM players WHERE id = $1', [player.id])
  if (!stored?.confirm_code || !isText(body.code) || body.code.trim() !== stored.confirm_code) throw new ApiError('bad_code')
  if (stored.expired) throw new ApiError('code_expired')
  const confirmed = await one<PlayerRow>(pool, `UPDATE players SET confirmed = true, confirm_code = NULL, confirm_code_expires = NULL WHERE id = $1 RETURNING ${PLAYER_COLUMNS}`, [player.id])
  return { status: 200, body: { player: toPlayer(confirmed as PlayerRow, true) } }
})

route('POST', '/api/confirm/resend', 'required', async (c) => {
  const player = c.player as PlayerRow
  const code = sixDigitCode()
  await pool.query(`UPDATE players SET confirm_code = $2, confirm_code_expires = now() + make_interval(secs => $3) WHERE id = $1`, [player.id, code, config.confirmCodeTtlSeconds])
  await mailCode(player.email, code).catch((error: unknown) => {
    if (error instanceof MailError) throw new ApiError('mail_unavailable', 'code')
    throw error
  })
  return { status: 200, body: { sent: true } }
})
