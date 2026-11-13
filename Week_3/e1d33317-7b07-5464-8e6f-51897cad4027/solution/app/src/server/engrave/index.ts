// The server-side music engraver. A request describes one view (the whole score at concert pitch or
// one part at written pitch); planSystems decides every system, renderSystem and renderPartPage draw them.
//
// Reuse one EngraveRequest object for planSystems and every render of the same view: the bucketed
// measure index is cached on the request object and is built once.

import { drawSystem, escapeXml, fmt } from './draw.js'
import { metricsFor, PART_METRICS, PART_PAGE, partPageCapacity, planSystems } from './plan.js'
import { indexOf } from './model.js'
import { DISPLAY_FONT, INK, MUTED, NUMBER_FONT, PAPER } from './smufl.js'
import type { EngraveRequest, SystemPlan } from './types.js'

export type { EngraveRequest, StaffSource, SystemPlan } from './types.js'

const ROOT_ATTRS = 'xmlns="http://www.w3.org/2000/svg"'
const HEADING_SIZE = 20
const HEADING_BASELINE = 62
const SYSTEMS_TOP = 96
const FOOTER_BASELINE = PART_PAGE.height - 40

export { planSystems }

/** One system as a standalone svg. Its viewBox is `0 0 W H`: W is 1000 (score) or 756 (part); H depends on the content. */
export function renderSystem(req: EngraveRequest, plan: SystemPlan): string {
  indexOf(req)
  const metrics = metricsFor(req)
  const drawn = drawSystem(req, plan, metrics)
  return (
    `<svg ${ROOT_ATTRS} viewBox="0 0 ${fmt(drawn.width)} ${fmt(drawn.height)}" aria-hidden="true" preserveAspectRatio="xMidYMin meet" ` +
    `data-first-measure="${plan.firstMeasure}" data-last-measure="${plan.lastMeasure}" fill="${INK}">${drawn.content}</svg>`
  )
}

function heading(req: EngraveRequest): string {
  const text = req.partName === null ? req.title : `${req.title} — ${req.partName}`
  const room = PART_METRICS.width
  const fit = text.length * HEADING_SIZE * 0.55 > room ? ` textLength="${room}" lengthAdjust="spacingAndGlyphs"` : ''
  return `<text font-family="${DISPLAY_FONT}" font-size="${HEADING_SIZE}" fill="${INK}" x="${PART_PAGE.margin}" y="${HEADING_BASELINE}"${fit}>${escapeXml(text)}</text>`
}

/** A full portrait page (9 by 12 inches at 96 dpi) holding the given systems of a part. */
export function renderPartPage(req: EngraveRequest, plans: SystemPlan[], pageNumber: number): string {
  indexOf(req)
  const capacity = partPageCapacity(req.staves.length)
  const slot = (FOOTER_BASELINE - 24 - SYSTEMS_TOP) / capacity
  const first = plans[0]
  const last = plans[plans.length - 1]
  const parts: string[] = [
    `<svg ${ROOT_ATTRS} viewBox="0 0 ${PART_PAGE.width} ${PART_PAGE.height}" aria-hidden="true" preserveAspectRatio="xMidYMin meet" data-page="${pageNumber}"` +
      `${first && last ? ` data-first-measure="${first.firstMeasure}" data-last-measure="${last.lastMeasure}"` : ''} fill="${INK}">`,
    `<rect width="${PART_PAGE.width}" height="${PART_PAGE.height}" fill="${PAPER}"/>`,
    heading(req),
    `<path d="M${PART_PAGE.margin} ${HEADING_BASELINE + 12}H${PART_PAGE.width - PART_PAGE.margin}" fill="none" stroke="${MUTED}" stroke-width="0.75"/>`,
  ]
  plans.forEach((plan, k) => {
    const drawn = drawSystem(req, plan, PART_METRICS)
    const scale = drawn.height > slot ? slot / drawn.height : 1
    const y = SYSTEMS_TOP + k * slot
    const transform = scale < 1 ? `translate(${PART_PAGE.margin} ${fmt(y)}) scale(${fmt(scale)})` : `translate(${PART_PAGE.margin} ${fmt(y)})`
    parts.push(`<g transform="${transform}" data-first-measure="${plan.firstMeasure}" data-last-measure="${plan.lastMeasure}">${drawn.content}</g>`)
  })
  parts.push(
    `<text font-family="${NUMBER_FONT}" font-size="11" fill="${MUTED}" x="${PART_PAGE.width / 2}" y="${FOOTER_BASELINE}" text-anchor="middle">Page ${pageNumber}</text>`,
    '</svg>',
  )
  return parts.join('')
}
