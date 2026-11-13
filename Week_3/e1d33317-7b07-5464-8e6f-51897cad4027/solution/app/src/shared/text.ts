// Expression text and lyrics: the allowlist (only <i>, <b>, <br>) is decided here, once.
// Names and text lengths count user-perceived characters.

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })

export function graphemeCount(text: string): number {
  let n = 0
  for (const _ of segmenter.segment(text)) n++
  return n
}

interface FilteredText {
  /** Stored form: only <i>, <b>, <br>; `<`, `>` and `&` in the text are escaped. */
  html: string
  /** User-perceived characters of the text without tags. */
  length: number
}

const TAG = /^<(\/?)([A-Za-z][A-Za-z0-9]*)(?:\s[^>]*)?\/?>/

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function filterText(raw: string): FilteredText {
  let html = ''
  let visible = ''
  const open: ('i' | 'b')[] = []
  let at = 0
  while (at < raw.length) {
    const lt = raw.indexOf('<', at)
    if (lt === -1) {
      visible += raw.slice(at)
      html += escapeText(raw.slice(at))
      break
    }
    visible += raw.slice(at, lt)
    html += escapeText(raw.slice(at, lt))
    const tag = TAG.exec(raw.slice(lt))
    if (!tag) {
      visible += '<'
      html += '&lt;'
      at = lt + 1
      continue
    }
    const name = (tag[2] as string).toLowerCase()
    const closing = tag[1] === '/'
    at = lt + tag[0].length
    if (!closing && (name === 'script' || name === 'style')) {
      const close = new RegExp(`</${name}\\s*>`, 'i').exec(raw.slice(at))
      at = close ? at + close.index + close[0].length : raw.length
    } else if (name === 'br') {
      if (!closing) html += '<br>'
    } else if (name === 'i' || name === 'b') {
      if (!closing) {
        open.push(name)
        html += `<${name}>`
      } else if (open.includes(name)) {
        for (let top = open.pop(); top !== undefined; top = open.pop()) {
          html += `</${top}>`
          if (top === name) break
        }
      }
    }
  }
  for (let top = open.pop(); top !== undefined; top = open.pop()) html += `</${top}>`
  return { html, length: graphemeCount(visible) }
}

export interface TextRun {
  text: string
  italic: boolean
  bold: boolean
  /** A line break comes before this run. */
  breakBefore: boolean
}

function unescapeText(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** Splits stored (already filtered) text into styled runs for drawing. */
export function textRuns(stored: string): TextRun[] {
  const runs: TextRun[] = []
  let italic = false
  let bold = false
  let pendingBreak = false
  for (const part of stored.split(/(<\/?(?:i|b|br)>)/)) {
    if (part === '<i>') italic = true
    else if (part === '</i>') italic = false
    else if (part === '<b>') bold = true
    else if (part === '</b>') bold = false
    else if (part === '<br>') pendingBreak = true
    else if (part) {
      runs.push({ text: unescapeText(part), italic, bold, breakBefore: pendingBreak })
      pendingBreak = false
    }
  }
  return runs
}
