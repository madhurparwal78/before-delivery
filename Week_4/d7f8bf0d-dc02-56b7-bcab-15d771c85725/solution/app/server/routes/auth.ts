import { signIn, signOut } from '../auth'
import { idleSeconds } from '../config'
import { db, rows } from '../db'
import { invalidFields } from '../http/errors'
import { COOKIE, type Route } from '../http/pipeline'
import type { Membership } from '../../shared/domain'
import { json } from './helpers'

export const authRoutes: Route[] = [
  {
    method: 'POST', path: '/api/auth/sign-in', access: 'open', key: false,
    async handle(c) {
      const { email, password } = c.body
      if (typeof email !== 'string' || typeof password !== 'string') throw invalidFields({ email: 'Enter your email.', password: 'Enter your password.' })
      const { user, token } = await signIn(email, password)
      return {
        status: 200,
        body: { user, idle_seconds: idleSeconds },
        headers: { 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/` },
      }
    },
  },
  {
    method: 'POST', path: '/api/auth/sign-out', access: 'user', key: false,
    async handle(c) {
      await signOut(c.token as string)
      return { status: 204, raw: Buffer.alloc(0), headers: { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` } }
    },
  },
  {
    method: 'GET', path: '/api/me', access: 'user',
    async handle(c) {
      const memberships = await rows<Membership>(db(),
        `select w.id as workspace_id, w.name as workspace_name, m.role from members m join workspaces w on w.id = m.workspace_id
         where m.user_id = $1 order by w.created_at, w.id`, [c.user.id])
      return json(200, {
        user: { id: c.user.id, email: c.user.email, display_name: c.user.display_name, walkthrough_done: c.user.walkthrough_done },
        memberships,
      })
    },
  },
  {
    method: 'POST', path: '/api/me/walkthrough', access: 'user', key: false,
    async handle(c) {
      await db().query('update users set walkthrough_done = true where id = $1', [c.user.id])
      return json(200, { walkthrough_done: true })
    },
  },
]
