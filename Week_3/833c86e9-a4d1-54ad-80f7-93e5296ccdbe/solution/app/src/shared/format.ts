import { DECIMALS, LOCALES, type Currency, type Lang } from './i18n'
import { rnd } from './rules'

/** Integer minor units as an exact decimal string, e.g. 12345 with 2 decimals is "123.45". */
function decimalString(minor: number, decimals: number): string {
  const sign = minor < 0 ? '-' : ''
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0')
  return decimals === 0 ? sign + digits : `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
}

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>()

function numberFormat(lang: Lang, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `n|${lang}|${JSON.stringify(options)}`
  let format = cache.get(key) as Intl.NumberFormat | undefined
  if (!format) cache.set(key, (format = new Intl.NumberFormat(LOCALES[lang], { ...options, numberingSystem: 'latn' })))
  return format
}

function dateFormat(lang: Lang, zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d|${lang}|${zone}|${JSON.stringify(options)}`
  let format = cache.get(key) as Intl.DateTimeFormat | undefined
  if (!format) cache.set(key, (format = new Intl.DateTimeFormat(LOCALES[lang], { ...options, timeZone: zone, numberingSystem: 'latn' })))
  return format
}

export function money(minor: number, currency: Currency, lang: Lang): string {
  const exact = decimalString(minor, DECIMALS[currency]) as `${number}`
  return numberFormat(lang, { style: 'currency', currency }).format(exact)
}

/** Whole major units, half up, digits only (the `{n}` of a date label). */
export function wholeMajor(minor: number, currency: Currency): string {
  return String(rnd(minor, 10 ** DECIMALS[currency]))
}

export const num1 = (value: number, lang: Lang): string => numberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)

const noon = (iso: string): Date => new Date(`${iso}T12:00:00Z`)

export const longDate = (iso: string, lang: Lang, zone: string): string =>
  dateFormat(lang, zone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(noon(iso))
export const dayMonth = (iso: string, lang: Lang, zone: string): string => dateFormat(lang, zone, { day: 'numeric', month: 'long' }).format(noon(iso))
export const weekdayDayMonth = (iso: string, lang: Lang, zone: string): string => dateFormat(lang, zone, { weekday: 'long', day: 'numeric', month: 'long' }).format(noon(iso))
export const monthYear = (iso: string, lang: Lang, zone: string): string => dateFormat(lang, zone, { month: 'long', year: 'numeric' }).format(noon(iso))
export const weekdayName = (iso: string, lang: Lang): string => dateFormat(lang, 'UTC', { weekday: 'long' }).format(noon(iso))

export const moment = (instant: string, zone: string, lang: Lang): string =>
  dateFormat(lang, zone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant))
