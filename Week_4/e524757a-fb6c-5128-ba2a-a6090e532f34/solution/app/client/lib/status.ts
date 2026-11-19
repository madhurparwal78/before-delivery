/** Live regions: `role="status"` named by `aria-label`. They stay in the page, empty until something is said. */
import { h } from './dom'

export interface Status {
  el: HTMLElement
  /** Say a line. `error` shows it in a solid black band. */
  say(message: string, options?: { error?: boolean }): void
  clear(): void
  /** The text of the latest line, or ''. */
  latest(): string
}

/** `keep` lines are kept, oldest first, each as its own element; 1 shows only the latest message. */
export function status(name: string, keep = 1, extra: Record<string, string> = {}): Status {
  const el = h('div', { role: 'status', 'aria-label': name, class: 'status', ...extra })
  return {
    el,
    say(message, options = {}) {
      const line = h('p', { class: options.error ? 'status-line band-error' : 'status-line' }, message)
      el.appendChild(line)
      while (el.children.length > keep) el.firstElementChild?.remove()
    },
    clear: () => el.replaceChildren(),
    latest: () => el.lastElementChild?.textContent ?? '',
  }
}

/** The `Safari feed` log: appended to, never rebuilt. */
export function log(name: string): HTMLElement {
  return h('div', { role: 'log', 'aria-label': name, class: 'feed' })
}
