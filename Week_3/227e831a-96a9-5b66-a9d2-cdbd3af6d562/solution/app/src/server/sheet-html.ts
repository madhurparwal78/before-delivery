import type { Profile, TripList } from '../shared/api-types'
import { CATEGORIES } from '../shared/categories'
import type { Paper } from './gotenberg'

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

export function paperFor(size: Profile['paperSize']): Paper {
  return size === 'A4' ? { widthInches: '8.2677', heightInches: '11.6929' } : { widthInches: '8.5', heightInches: '11' }
}

const STYLE = `
body { font-family: Helvetica, Arial, sans-serif; color: #1b2620; font-size: 11pt; }
h1 { font-size: 22pt; margin: 0 0 4pt; }
.kicker { font-size: 11pt; font-weight: bold; margin: 0; }
.meta { margin: 0 0 14pt; }
h2 { font-size: 13pt; margin: 14pt 0 4pt; padding-bottom: 2pt; border-bottom: 1pt solid #1b2620; }
ul { list-style: none; margin: 0; padding: 0; }
li { display: flex; gap: 8pt; align-items: baseline; padding: 3pt 0; border-bottom: 0.5pt solid #bbb; }
.box { width: 9pt; height: 9pt; border: 1pt solid #1b2620; flex: none; }
.what { flex: 1; }
.note { font-style: italic; }
.weight { text-align: right; font-family: "Courier New", monospace; }
.totals { margin-top: 18pt; border-top: 2pt solid #1b2620; padding-top: 6pt; }
.totals p { margin: 2pt 0; }
`

/** The HTML Gotenberg turns into the pack sheet; the same list data the workspace shows. */
export function renderSheetHtml(list: TripList, hikerName: string): string {
  const sections = CATEGORIES.flatMap((category) => {
    const entry = list.categories.find((candidate) => candidate.category === category)
    if (!entry) return []
    const items = list.lines
      .filter((line) => line.inCloset && line.category === category)
      .map(
        (line) => `<li><span class="box"></span><span class="what">${line.quantity} × ${escapeHtml(line.name)}</span>` +
          `${line.carryNote ? `<span class="note">${escapeHtml(line.carryNote)}</span>` : ''}` +
          `<span class="weight">${escapeHtml(line.weightDisplay)}</span></li>`,
      )
      .join('')
    return [`<section><h2>${category} ${escapeHtml(entry.subtotalDisplay)}</h2><ul>${items}</ul></section>`]
  })
  const { display } = list.totals
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pack sheet</title><style>${STYLE}</style></head><body>
<p class="kicker">Pack sheet</p>
<h1>${escapeHtml(list.name)}</h1>
<p class="meta">${escapeHtml(hikerName)} · ${list.state}</p>
${sections.join('\n')}
<div class="totals">
<p>Base ${escapeHtml(display.base)}</p>
<p>Worn ${escapeHtml(display.worn)}</p>
<p>Consumable ${escapeHtml(display.consumable)}</p>
<p>Skin-out ${escapeHtml(display.skinOut)}</p>
<p>Goal ${escapeHtml(display.goal)}</p>
<p>${escapeHtml(display.delta)}</p>
</div></body></html>`
}
