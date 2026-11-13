import { SOMETHING_WRONG } from '../shared/copy.ts'
import type { ApiErrorBody, PublicConfig } from '../shared/types.ts'

export class ApiFailure extends Error {
  readonly status: number
  readonly body: ApiErrorBody

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.status = status
    this.body = body
  }
}

async function failure(response: Response): Promise<ApiFailure> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null
  return new ApiFailure(response.status, body ?? { error: 'invalid', message: SOMETHING_WRONG })
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!response.ok) throw await failure(response)
  return (await response.json()) as T
}

/** Sends raw bytes (an upload) and returns the parsed JSON answer. */
export async function upload<T>(path: string, body: Uint8Array<ArrayBuffer>): Promise<T> {
  const response = await fetch(path, { method: 'POST', body })
  if (!response.ok) throw await failure(response)
  return (await response.json()) as T
}

/** Fetches a file the app streams (an original, a solve record). */
export async function download(path: string): Promise<Blob> {
  const response = await fetch(path)
  if (!response.ok) throw await failure(response)
  return response.blob()
}

let publicConfig: Promise<PublicConfig> | null = null

export function config(): Promise<PublicConfig> {
  publicConfig ??= api<PublicConfig>('GET', '/api/config')
  return publicConfig
}

export function linkFor(code: string): string {
  const base = document.querySelector<HTMLMetaElement>('meta[name="overlap-link-base"]')?.content
  return `${base || location.origin}/g/${code}`
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
