import { query, transaction } from './db'
import { declare, required, rules, settle } from './fields'
import type { Route } from './http'
import { loadPassphraseHash, loadProfile, profileFields, profileReply } from './profile'
import { CLEARED_COOKIE, endSession, openSession, passphraseMatches, sessionCookie } from './session'
import { HttpError } from './errors'
import { pool } from './db'

const signInFields = declare({ passphrase: required(rules.string, 'Enter your passphrase.') })

const health: Route = {
  method: 'GET',
  pattern: '/api/health',
  access: 'public',
  async handler() {
    try {
      await pool.query('SELECT 1 FROM profile LIMIT 1')
      return { status: 200, body: { status: 'ok' } }
    } catch {
      return { status: 503, body: { status: 'starting' } }
    }
  },
}

const signIn: Route = {
  method: 'POST',
  pattern: '/api/session',
  access: 'public',
  async handler(ctx) {
    const { passphrase } = settle(signInFields.read(ctx.json()))
    if (!(await passphraseMatches(passphrase, await loadPassphraseHash()))) {
      throw new HttpError(401, 'invalid_passphrase', "That passphrase didn't match.")
    }
    return { status: 204, headers: { 'Set-Cookie': sessionCookie(await openSession(pool)) } }
  },
}

const signOut: Route = {
  method: 'DELETE',
  pattern: '/api/session',
  access: 'session',
  async handler(ctx) {
    if (ctx.sessionToken) await endSession(ctx.sessionToken)
    return { status: 204, headers: { 'Set-Cookie': CLEARED_COOKIE } }
  },
}

const getProfile: Route = {
  method: 'GET',
  pattern: '/api/profile',
  access: 'session',
  async handler() {
    return profileReply(await loadProfile())
  },
}

const patchProfile: Route = {
  method: 'PATCH',
  pattern: '/api/profile',
  access: 'session',
  async handler(ctx) {
    const values = settle(profileFields.read(ctx.json()))
    await transaction(async (db) => {
      await query(
        `UPDATE profile SET display_name = COALESCE($1, display_name), unit = COALESCE($2, unit),
                goal_grams = COALESCE($3, goal_grams), time_zone = COALESCE($4, time_zone), paper_size = COALESCE($5, paper_size)
          WHERE id = 1`,
        [values.displayName ?? null, values.unit ?? null, values.goal ?? null, values.timeZone ?? null, values.paperSize ?? null],
        db,
      )
    })
    return profileReply(await loadProfile())
  },
}

export const accountRoutes: Route[] = [health, signIn, signOut, getProfile, patchProfile]
