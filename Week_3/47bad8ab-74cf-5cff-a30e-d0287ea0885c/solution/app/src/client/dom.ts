type Value = string | number | boolean | null | undefined
type Handler = (event: never) => void
type Props = Record<string, Value | Handler>
export type Child = Node | string | number | null | undefined | false

const PROPERTIES = new Set(['value', 'checked', 'disabled', 'readOnly', 'hidden'])

/** Builds an element: `on*` props are listeners, `class` and `data-*` are attributes, `false` and nullish props are skipped. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue
    if (typeof value === 'function') element.addEventListener(name.slice(2).toLowerCase(), value as EventListener)
    else if (PROPERTIES.has(name)) Object.assign(element, { [name]: value })
    else element.setAttribute(name, value === true ? '' : String(value))
  }
  element.append(...children.filter((child): child is Node | string | number => child !== null && child !== undefined && child !== false).map((child) => (typeof child === 'number' ? String(child) : child)))
  return element
}

const SVG = 'http://www.w3.org/2000/svg'

/** Inline line drawings made for the product. */
const ICONS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  previous: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  switch: 'M4 9h13l-3-3M20 15H7l3 3',
  backspace: 'M9 6h11v12H9L3 12l6-6zM12 10l4 4M16 10l-4 4',
  pencil: 'M4 20l1-5L16 4l4 4L9 19l-5 1zM14 6l4 4',
  rebus: 'M5 6h14M5 12h14M5 18h9',
  check: 'M4 12l5 5L20 6',
  share: 'M12 4v11M7 9l5-5 5 5M5 14v6h14v-6',
  clear: 'M5 6h14M9 6V4h6v2M7 6l1 14h8l1-14',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M13 5v4M7 15v4',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  pause: 'M8 5v14M16 5v14',
} as const

type IconName = keyof typeof ICONS

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '24')
  svg.setAttribute('height', '24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', 'icon')
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', ICONS[name])
  svg.append(path)
  return svg
}
