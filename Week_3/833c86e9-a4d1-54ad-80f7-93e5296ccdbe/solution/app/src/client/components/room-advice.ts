import type { Advice, Reason } from '../../shared/types'
import type { App } from '../state'

/** The sentence for a refused room choice. */
export function adviceText(app: App, advice: Advice, roomNames: Record<string, string>): string {
  return app.t(`advice.${advice.code}`, {
    n: 'n' in advice ? advice.n : 0, m: 'm' in advice ? advice.m : 0, name: 'room_type' in advice ? roomNames[advice.room_type] ?? '' : '',
  })
}

/** The sentence for a broken stay restriction. */
export function reasonText(app: App, reason: Reason, zone: string): string {
  const date = reason.date ? app.fmt.longDate(reason.date, app.lang, zone) : ''
  return app.t(`reason.${reason.code}`, { date, 'count:night': reason.n ?? 0, 'count:day': reason.n ?? 0 })
}
