/** Tiny DOM helpers: the page is plain elements, built and updated by hand. */

type Value = string | number | boolean | null | undefined | ((event: Event) => void) | Record<string, string>
type Props = Record<string, Value>
export type Child = Node | string | number | null | undefined | false | readonly Child[]

const PROPERTIES = new Set(['value', 'checked', 'disabled', 'hidden', 'tabIndex', 'selected', 'open'])

function apply(el: Element, props: Props): void {
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue
    if (typeof value === 'function' && key.startsWith('on')) {
      el.addEventListener(key.slice(2), value)
    } else if (key === 'class') {
      el.setAttribute('class', String(value))
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign((el as HTMLElement).style, value)
    } else if (PROPERTIES.has(key)) {
      ;(el as unknown as Record<string, unknown>)[key] = value
    } else {
      el.setAttribute(key, value === true ? '' : String(value))
    }
  }
}

function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    if (Array.isArray(child)) append(parent, child)
    else parent.appendChild(typeof child === 'object' ? (child as Node) : document.createTextNode(String(child)))
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (props) apply(el, props)
  append(el, children)
  return el
}

const SVG = 'http://www.w3.org/2000/svg'

export function svg(tag: string, props?: Props | null, ...children: Child[]): SVGElement {
  const el = document.createElementNS(SVG, tag)
  if (props) apply(el, props)
  append(el, children)
  return el
}

export function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Wraps each digit in a fixed-width cell so numbers keep equal-width digits in any face. */
export function digits(text: string): DocumentFragment {
  const out = document.createDocumentFragment()
  for (const ch of text) {
    out.appendChild(/[0-9]/.test(ch) ? h('span', { class: 'digit' }, ch) : document.createTextNode(ch))
  }
  return out
}

export function setDigits(el: Element, text: string): void {
  if (el.textContent === text) return
  el.replaceChildren(digits(text))
}
