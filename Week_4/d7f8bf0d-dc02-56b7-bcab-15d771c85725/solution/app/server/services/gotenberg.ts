import { request } from 'node:http'

// Gotenberg renders the crew packet PDFs; its health is probed at most every five seconds.

const RENDER_TIMEOUT_MS = 20_000
const PROBE_TIMEOUT_MS = 2000
const PROBE_MS = 5000

interface Answer { ok: boolean; bytes: Buffer }

// node:http rather than fetch: fetch refuses the WHATWG blocked ports without connecting, so a Gotenberg on one of them
// would read as down for ever. Each exchange takes its own connection, so none outlives a Gotenberg restart.
function exchange(url: string, timeoutMs: number, form?: { contentType: string; body: Buffer }): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const headers = form === undefined ? {} : { 'content-type': form.contentType, 'content-length': form.body.length }
    const outgoing = request(url, { method: form === undefined ? 'GET' : 'POST', headers, agent: false, signal: AbortSignal.timeout(timeoutMs) }, incoming => {
      const chunks: Buffer[] = []
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
      incoming.on('error', reject)
      incoming.on('end', () => {
        const status = incoming.statusCode ?? 0
        resolve({ ok: status >= 200 && status < 300, bytes: Buffer.concat(chunks) })
      })
    })
    outgoing.on('error', reject)
    outgoing.end(form?.body)
  })
}

export class Gotenberg {
  up = false

  constructor(private readonly baseUrl: string) {}

  watch(): void {
    const probe = async (): Promise<void> => {
      try {
        this.up = (await exchange(`${this.baseUrl}/health`, PROBE_TIMEOUT_MS)).ok
      } catch {
        this.up = false
      }
      setTimeout(() => void probe(), PROBE_MS)
    }
    void probe()
  }

  async render(html: string, footerHtml: string): Promise<Buffer> {
    const form = new FormData()
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
    form.append('files', new Blob([footerHtml], { type: 'text/html' }), 'footer.html')
    form.append('paperWidth', '8.27')
    form.append('paperHeight', '11.7')
    form.append('marginTop', '0.6')
    form.append('marginBottom', '0.8')
    const encoded = new Response(form)
    try {
      const answer = await exchange(`${this.baseUrl}/forms/chromium/convert/html`, RENDER_TIMEOUT_MS, {
        contentType: encoded.headers.get('content-type') as string,
        body: Buffer.from(await encoded.arrayBuffer()),
      })
      if (!answer.ok) throw new Error('Gotenberg refused the render')
      if (answer.bytes.length === 0) throw new Error('Gotenberg returned no bytes')
      this.up = true
      return answer.bytes
    } catch (error) {
      this.up = false
      throw error
    }
  }
}
