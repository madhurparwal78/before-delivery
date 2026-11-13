// Turns the score's recorded operations into engraved systems and part pages through the engraver.

import type { Part, PartLayout, SystemSvg } from '../shared/protocol.js'
import { planSystems, renderPartPage, renderSystem, type EngraveRequest, type StaffSource, type SystemPlan } from './engrave/index.js'
import type { ScoreState } from './state.js'

const plans = new Map<string, { request: EngraveRequest; plans: SystemPlan[] }>()
const EMPTY_LAYOUT: PartLayout = { systemBreaks: [], pageBreaks: [] }

export function buildRequest(state: ScoreState, view: 'score' | 'part', part: { id: string; name: string; layout: PartLayout } | null): EngraveRequest {
  const staffIds = view === 'part' ? (state.parts.find((p) => p.id === part?.id)?.staffIds ?? []) : state.staves.map((s) => s.id)
  return {
    view,
    title: state.row.title,
    partName: part?.name ?? null,
    measureCount: state.row.measure_count,
    timeSignatures: state.row.time_signatures,
    tempos: state.row.tempos,
    staves: staffIds.flatMap((id) => {
      const staff = state.staff(id)
      if (!staff) return []
      const voices: StaffSource['voices'] = [state.voice(id, 1).events(state.grid), state.voice(id, 2).events(state.grid)]
      return [{ id, name: staff.name, clef: staff.clef, transpose: staff.transpose, voices }]
    }),
    layout: view === 'part' ? (part?.layout ?? EMPTY_LAYOUT) : EMPTY_LAYOUT,
  }
}

/** The systems of a view, planned once per score revision and layout. */
export function planFor(state: ScoreState, view: 'score' | 'part', part: Pick<Part, 'id' | 'name' | 'layout'> | null): { request: EngraveRequest; plans: SystemPlan[] } {
  const key = `${state.id}|${view}|${part?.id ?? ''}|${state.row.rev}|${JSON.stringify(part?.layout ?? '')}`
  const hit = plans.get(key)
  if (hit) return hit
  const request = buildRequest(state, view, part)
  const planned = { request, plans: planSystems(request) }
  if (plans.size > 24) plans.delete(plans.keys().next().value as string)
  plans.set(key, planned)
  return planned
}

export function systemsFrom(request: EngraveRequest, all: SystemPlan[], fromMeasure: number, limit: number): { systems: SystemSvg[]; next: number | null } {
  const start = Math.max(0, all.findIndex((p) => p.lastMeasure >= fromMeasure))
  const slice = all.slice(start, start + limit)
  const following = all[start + limit]
  return { systems: slice.map((plan) => ({ ...plan, svg: renderSystem(request, plan) })), next: following ? following.firstMeasure : null }
}

/** Every page of a part as portrait SVG, in order. */
export function partPages(request: EngraveRequest, all: SystemPlan[]): string[] {
  const pageCount = all.reduce((n, p) => Math.max(n, p.page), 0)
  return Array.from({ length: pageCount }, (_, i) => renderPartPage(request, all.filter((p) => p.page === i + 1), i + 1))
}
