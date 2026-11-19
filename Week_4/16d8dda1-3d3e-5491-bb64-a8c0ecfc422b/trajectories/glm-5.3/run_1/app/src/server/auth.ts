import bcrypt from 'bcryptjs'
import { pool } from './db.js'
import { id, randomToken } from './ids.js'

export const COOKIE_NAME = 'slatehall_session'

export interface Teacher {
  id: string
  email: string
  displayName: string
  worldId: string
}

export interface Learner {
  id: string
  displayName: string
  worldId: string
}

export type Caller =
  | { kind: 'teacher'; teacher: Teacher }
  | { kind: 'learner'; learner: Learner }
  | { kind: 'none' }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validEmail(email: string): boolean {
  return EMAIL_RE.test(email)
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function checkPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function createTeacherSession(cookieToken: string, teacherId: string): Promise<void> {
  await pool.query(
    `INSERT INTO teacher_sessions (token, teacher_id) VALUES ($1, $2)
     ON CONFLICT (token) DO UPDATE SET teacher_id = $2`,
    [cookieToken, teacherId]
  )
}

export async function createLearnerSession(cookieToken: string, learnerId: string): Promise<void> {
  await pool.query(
    `INSERT INTO learner_sessions (token, learner_id) VALUES ($1, $2)
     ON CONFLICT (token) DO UPDATE SET learner_id = $2`,
    [cookieToken, learnerId]
  )
}

export async function createSessionCookie(): Promise<string> {
  return randomToken() + randomToken()
}

export async function callerFromCookie(token: string | undefined): Promise<Caller> {
  if (!token) return { kind: 'none' }
  const teacherAnswer = await pool.query(
    `SELECT t.id, t.email, t.display_name, t.world_id FROM teacher_sessions s
     JOIN teachers t ON t.id = s.teacher_id WHERE s.token = $1`,
    [token]
  )
  if (teacherAnswer.rows.length > 0) {
    const row = teacherAnswer.rows[0]
    return {
      kind: 'teacher',
      teacher: { id: row.id, email: row.email, displayName: row.display_name, worldId: row.world_id }
    }
  }
  const learnerAnswer = await pool.query(
    `SELECT l.id, l.display_name, l.world_id FROM learner_sessions s
     JOIN learners l ON l.id = s.learner_id WHERE s.token = $1`,
    [token]
  )
  if (learnerAnswer.rows.length > 0) {
    const row = learnerAnswer.rows[0]
    return {
      kind: 'learner',
      learner: { id: row.id, displayName: row.display_name, worldId: row.world_id }
    }
  }
  return { kind: 'none' }
}

export async function deleteSessionCookie(token: string): Promise<void> {
  await pool.query(`DELETE FROM teacher_sessions WHERE token = $1`, [token])
  await pool.query(`DELETE FROM learner_sessions WHERE token = $1`, [token])
}

export function newTeacherId(): string {
  return id('tch')
}

export function newLearnerId(): string {
  return id('lrn')
}
