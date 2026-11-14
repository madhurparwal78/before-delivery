import { useLayoutEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import type { MortiseError } from '../../shared/mortise.ts'
import type { CaretRequest } from './store.ts'

const INDENT = '  '
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta'])

export interface GhostCaret {
  line: number
  column: number
}

interface CodeEditorProps {
  label: string
  text: string
  readOnly: boolean
  errors: MortiseError[]
  onChange: (text: string) => void
  caret: CaretRequest | null
  /** A drawn caret for a demo that types into the editor by itself. */
  ghost?: GhostCaret | null
  /** Whether the drawn caret blinks (three times, then stays solid). */
  blinking?: boolean
  /** Called before the first pointer or key press reaches the text, so a running demo can stop. */
  onInteract?: () => void
}

/** Where an offset in the old text sits in the new text, keeping it attached to the characters around it. */
function mapOffset(before: string, after: string, offset: number): number {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before.charAt(prefix) === after.charAt(prefix)) prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix && before.charAt(before.length - 1 - suffix) === after.charAt(after.length - 1 - suffix)) suffix++
  if (offset <= prefix) return offset
  if (offset >= before.length - suffix) return offset + (after.length - before.length)
  return prefix
}

function insertAtCaret(area: HTMLTextAreaElement, text: string): void {
  if (!document.execCommand('insertText', false, text)) {
    area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end')
    area.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

function outdent(area: HTMLTextAreaElement): void {
  const { value, selectionStart, selectionEnd } = area
  const from = value.lastIndexOf('\n', selectionStart - 1) + 1
  const lastChar = selectionEnd > selectionStart && value.charAt(selectionEnd - 1) === '\n' ? selectionEnd - 1 : selectionEnd
  const newline = value.indexOf('\n', lastChar)
  const to = newline === -1 ? value.length : newline
  const lines = value.slice(from, to).split('\n')
  let removedFirst = 0
  let removedTotal = 0
  const changed = lines.map((line, i) => {
    const spaces = Math.min(INDENT.length, /^ */.exec(line)?.[0].length ?? 0)
    if (i === 0) removedFirst = spaces
    removedTotal += spaces
    return line.slice(spaces)
  })
  if (!removedTotal) return
  area.setSelectionRange(from, to)
  insertAtCaret(area, changed.join('\n'))
  area.setSelectionRange(Math.max(from, selectionStart - removedFirst), selectionEnd - removedTotal)
}

/** The text pane: a plain textarea with a line-number gutter and a marker on every line that has an error. */
export function CodeEditor({ label, text, readOnly, errors, onChange, caret, ghost, blinking, onInteract }: CodeEditorProps) {
  const area = useRef<HTMLTextAreaElement>(null)
  const gutter = useRef<HTMLDivElement>(null)
  const released = useRef(false)

  useLayoutEffect(() => {
    const element = area.current as HTMLTextAreaElement
    if (element.value === text) return
    const before = element.value
    const { selectionStart, selectionEnd } = element
    element.value = text
    element.setSelectionRange(mapOffset(before, text, selectionStart), mapOffset(before, text, selectionEnd))
  }, [text])

  useLayoutEffect(() => {
    if (!caret) return
    const element = area.current as HTMLTextAreaElement
    const limit = element.value.length
    if (caret.focus) element.focus()
    element.setSelectionRange(Math.min(caret.start, limit), Math.min(caret.end, limit))
  }, [caret])

  const lineCount = useMemo(() => text.split('\n').length, [text])
  const firstErrors = useMemo(() => {
    const byLine = new Map<number, string>()
    for (const error of errors) if (!byLine.has(error.line)) byLine.set(error.line, error.message)
    return byLine
  }, [errors])

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    onInteract?.()
    const element = event.currentTarget
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (released.current) {
        released.current = false
        return
      }
      event.preventDefault()
      if (readOnly) return
      if (event.shiftKey) outdent(element)
      else insertAtCaret(element, INDENT)
      return
    }
    if (event.key === 'Escape') released.current = true
    else if (!MODIFIER_KEYS.has(event.key)) released.current = false
  }

  const rows = Array.from({ length: lineCount }, (_, i) => i + 1)
  return (
    <div className="code-editor">
      <div className="code-gutter">
        <div className="code-gutter-inner" ref={gutter}>
          {rows.map((line) => {
            const message = firstErrors.get(line)
            return (
              <div className="code-gutter-row" key={line}>
                <span aria-hidden="true">{line}</span>
                {message !== undefined ? <span role="img" className="gutter-marker" aria-label={`Error on line ${line}: ${message}`} /> : null}
              </div>
            )
          })}
        </div>
      </div>
      <div className="code-scroll">
        <textarea
          ref={area}
          className="code-area"
          aria-label={label}
          aria-readonly={readOnly ? 'true' : undefined}
          readOnly={readOnly}
          defaultValue={text}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          onInput={(event) => onChange(event.currentTarget.value)}
          onKeyDown={keyDown}
          onPointerDown={() => onInteract?.()}
          onBlur={() => {
            released.current = false
          }}
          onScroll={(event) => {
            if (gutter.current) gutter.current.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`
          }}
        />
        {ghost ? (
          <span
            className={`ghost-caret${blinking ? ' ghost-caret-blink' : ''}`}
            aria-hidden="true"
            style={{ top: `calc(var(--code-pad) + ${ghost.line} * var(--code-line))`, left: `calc(var(--code-pad) + ${ghost.column}ch)` }}
          />
        ) : null}
      </div>
    </div>
  )
}
