import { config } from './config'
import { refuse } from './errors'

const TIME_LIMIT_MS = 10000

export interface Paper {
  widthInches: string
  heightInches: string
}

/** Renders an HTML document to PDF with Gotenberg's Chromium conversion. */
export async function renderPdf(html: string, paper: Paper): Promise<Buffer> {
  const form = new FormData()
  form.set('files', new Blob([html], { type: 'text/html' }), 'index.html')
  form.set('paperWidth', paper.widthInches)
  form.set('paperHeight', paper.heightInches)
  form.set('marginTop', '0.6')
  form.set('marginBottom', '0.6')
  form.set('marginLeft', '0.6')
  form.set('marginRight', '0.6')
  form.set('printBackground', 'true')
  try {
    const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TIME_LIMIT_MS),
    })
    if (!response.ok) throw refuse.printingUnavailable()
    return Buffer.from(await response.arrayBuffer())
  } catch {
    throw refuse.printingUnavailable()
  }
}
