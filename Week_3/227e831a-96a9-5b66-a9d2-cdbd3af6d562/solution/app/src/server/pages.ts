import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { SharedList } from '../shared/api-types'

const CLIENT_DIR = resolve(import.meta.dirname, '../client')

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
}

/** Pages may not be framed by another site. Same-origin loading is the server's own rule (it serves or proxies every
 *  asset), so the policy does not restrict scripts: accessibility and audit tools inject their own. */
export const CSP = "frame-ancestors 'none'"

let shell: string | null = null

export async function appShell(): Promise<string> {
  shell ??= await readFile(resolve(CLIENT_DIR, 'index.html'), 'utf8')
  return shell
}

/** A built browser asset, or null for anything the app does not serve as a file. */
export async function staticFile(path: string): Promise<{ data: Buffer; contentType: string; cache: string } | null> {
  if (!path.startsWith('/assets/') && path !== '/sw.js') return null
  const file = resolve(CLIENT_DIR, `.${path}`)
  if (!file.startsWith(CLIENT_DIR + sep)) return null
  const extension = file.slice(file.lastIndexOf('.'))
  try {
    return {
      data: await readFile(file),
      contentType: TYPES[extension] ?? 'application/octet-stream',
      cache: path === '/sw.js' ? 'no-cache' : 'public, max-age=31536000, immutable',
    }
  } catch {
    return null
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

const UNAVAILABLE = 'This shared list is no longer available.'

async function head(title: string): Promise<string> {
  const built = await appShell()
  const links = [...built.matchAll(/<(?:link|script)[^>]+(?:href|src)="\/assets\/[^"]+"[^>]*>(?:<\/script>)?/g)].map((match) => match[0])
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><link rel="icon" href="data:,">${links.join('')}</head>`
}

export async function notFoundPage(): Promise<string> {
  return `${await head('Skinout')}<body class="shared-page"><main class="shared-sheet"><h1>Skinout</h1><p>There is nothing at this address.</p></main></body></html>`
}

/** The public page of a shared list: server-rendered, read-only, no controls and no navigation. */
export async function sharedPage(shared: SharedList | null): Promise<string> {
  if (!shared) {
    return `${await head('Skinout')}<body class="shared-page"><main class="shared-sheet"><h1>Skinout</h1><p>${UNAVAILABLE}</p></main></body></html>`
  }
  const { display } = shared.totals
  const groups = shared.categories.map((entry) => {
    const lines = shared.lines
      .filter((line) => line.category === entry.category)
      .map((line) => `<tr><td class="num">${line.quantity}</td><td>${escapeHtml(line.name)}${line.carryNote ? `<span class="carry-note">${escapeHtml(line.carryNote)}</span>` : ''}</td><td class="weight">${escapeHtml(line.weightDisplay)}</td></tr>`)
      .join('')
    return `<tr class="group"><th colspan="3" scope="colgroup"><h3>${entry.category} ${escapeHtml(entry.subtotalDisplay)}</h3></th></tr>${lines}`
  })
  return `${await head(`${shared.listName} — Skinout`)}<body class="shared-page"><main class="shared-sheet">
<h1>${escapeHtml(shared.listName)}</h1>
<p class="shared-by">Shared by ${escapeHtml(shared.hikerName)}</p>
<p class="list-state">${shared.state}</p>
<section aria-label="Pack totals" class="totals"><dl>
<div><dt>Base</dt><dd class="weight">${escapeHtml(display.base)}</dd></div>
<div><dt>Worn</dt><dd class="weight">${escapeHtml(display.worn)}</dd></div>
<div><dt>Consumable</dt><dd class="weight">${escapeHtml(display.consumable)}</dd></div>
<div><dt>Skin-out</dt><dd class="weight">${escapeHtml(display.skinOut)}</dd></div>
</dl><div class="goal-figure"><span class="figure-label">Goal ${escapeHtml(display.goal)}</span><p class="delta">${escapeHtml(display.delta)}</p></div></section>
<table aria-label="Shared pack list" class="ledger"><tbody>${groups.join('')}</tbody></table>
</main></body></html>`
}
