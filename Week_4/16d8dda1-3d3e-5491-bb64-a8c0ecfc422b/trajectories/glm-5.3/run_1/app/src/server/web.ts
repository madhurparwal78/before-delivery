// Request plumbing shared by every route module: body parsing, cookies,
// caller lookup and the response helpers.

import type { Request, Response } from 'express'
import { config } from './config.js'
import { TOO_LARGE, SEND_JSON } from './apiError.js'
import { COOKIE_NAME, callerFromCookie, type Caller } from './auth.js'

const bodyMap = new WeakMap<object, unknown>()

export function attach(req: Request, body: unknown): void {
  bodyMap.set(req, body)
}

export function body<T>(req: Request): T {
  return (bodyMap.get(req) ?? {}) as T
}

export function rawBody(req: Request): Buffer | undefined {
  const stored = bodyMap.get(req) as { __body?: Buffer } | undefined
  return stored?.__body
}

export function cookieToken(req: Request): string | undefined {
  const header = req.headers.cookie ?? ''
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

export async function caller(req: Request): Promise<Caller> {
  return callerFromCookie(cookieToken(req))
}

export interface AuthedTeacher {
  kind: 'teacher'
  teacherId: string
  worldId: string
  email: string
  displayName: string
}

export async function teacherOnly(req: Request, res: Response): Promise<AuthedTeacher | null> {
  const who = await caller(req)
  if (who.kind !== 'teacher') {
    fail(res, 401, 'Sign in first.')
    return null
  }
  return {
    kind: 'teacher',
    teacherId: who.teacher.id,
    worldId: who.teacher.worldId,
    email: who.teacher.email,
    displayName: who.teacher.displayName
  }
}

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`)
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
}

export function fail(res: Response, status: number, text: string): void {
  res.status(status).json({ error: text })
}

export function isJsonRequest(req: Request): boolean {
  const type = req.headers['content-type'] ?? ''
  if (type.includes('application/json')) return true
  if (type.includes('multipart/form-data')) return false
  if (type === '' && (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE')) return true
  return false
}

export function readJsonBody(req: Request, res: Response, next: () => void): void {
  const chunks: Buffer[] = []
  let size = 0
  req.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > config.jsonMaxBytes) {
      fail(res, 413, TOO_LARGE.message)
      req.destroy()
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    if (chunks.length === 0) {
      attach(req, {})
      next()
      return
    }
    try {
      attach(req, JSON.parse(Buffer.concat(chunks).toString('utf8')))
      next()
    } catch {
      fail(res, 415, SEND_JSON.message)
    }
  })
  req.on('error', () => {
    fail(res, 415, SEND_JSON.message)
  })
}

export function readUploadBody(req: Request, res: Response, next: () => void): void {
  const declared = Number(req.headers['content-length'] ?? '0')
  if (declared > config.uploadMaxBytes) {
    fail(res, 413, TOO_LARGE.message)
    req.destroy()
    return
  }
  const chunks: Buffer[] = []
  let size = 0
  req.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > config.uploadMaxBytes) {
      fail(res, 413, TOO_LARGE.message)
      req.destroy()
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    attach(req, { __body: Buffer.concat(chunks) })
    next()
  })
}
