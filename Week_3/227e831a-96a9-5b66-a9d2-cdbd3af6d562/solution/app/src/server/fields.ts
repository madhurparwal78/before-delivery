import type { CarryMode, Category, DisplayUnit, ListState, PaperSize, RetireReason } from '../shared/api-types'
import { isCategory } from '../shared/categories'
import { isListState } from '../shared/list-state'
import { JsonNumber, wholeNumber } from '../shared/numbers'
import { isTimeZone } from '../shared/share'
import { isCarryMode } from '../shared/sync-rules'
import { entryGrams } from '../shared/weights'
import { refuse, type HttpError } from './errors'

/** Facts about the target that some messages and limits depend on. */
export interface FieldContext {
  unitsOwned: number
}

type Accepted<T> = { value: T } | null
export type Rule<T> = (value: unknown, context: FieldContext) => Accepted<T>

interface FieldDecl<T, Required extends boolean = boolean> {
  rule: Rule<T>
  message: string | ((context: FieldContext) => string)
  required: Required
}

type Spec = Record<string, FieldDecl<unknown>>

export const required = <T>(rule: Rule<T>, message: FieldDecl<T>['message']): FieldDecl<T, true> => ({ rule, message, required: true })
export const optional = <T>(rule: Rule<T>, message: FieldDecl<T>['message']): FieldDecl<T, false> => ({ rule, message, required: false })

const accept = <T>(value: T): Accepted<T> => ({ value })

export const rules = {
  text: (min: number, max: number): Rule<string> => (value) =>
    typeof value === 'string' && value.trim().length >= min && value.trim().length <= max ? accept(value.trim()) : null,
  freeText: (max: number): Rule<string> => (value) => (typeof value === 'string' && value.length <= max ? accept(value) : null),
  whole: (min: number, max: number): Rule<number> => (value) => {
    const n = wholeNumber(value)
    return n !== null && n >= min && n <= max ? accept(n) : null
  },
  units: ((value, context) => {
    const n = wholeNumber(value)
    return n !== null && n >= 1 && n <= context.unitsOwned ? accept(n) : null
  }) as Rule<number>,
  category: ((value) => (isCategory(value) ? accept<Category>(value) : null)) as Rule<Category>,
  mode: ((value) => (isCarryMode(value) ? accept<CarryMode>(value) : null)) as Rule<CarryMode>,
  listState: ((value) => (isListState(value) ? accept<ListState>(value) : null)) as Rule<ListState>,
  unit: ((value) => (value === 'g' || value === 'oz' || value === 'lb' ? accept<DisplayUnit>(value) : null)) as Rule<DisplayUnit>,
  paper: ((value) => (value === 'A4' || value === 'Letter' ? accept<PaperSize>(value) : null)) as Rule<PaperSize>,
  retireReason: ((value) => (value === 'sold' || value === 'retired' || value === 'lost' ? accept<RetireReason>(value) : null)) as Rule<RetireReason>,
  timeZone: ((value) => (isTimeZone(value) ? accept(value) : null)) as Rule<string>,
  quantity: ((value) => {
    const n = wholeNumber(value)
    return n !== null && n >= 1 && n <= 100000 ? accept(n) : null
  }) as Rule<number>,
  string: ((value) => (typeof value === 'string' ? accept(value) : null)) as Rule<string>,
  price: ((value) => {
    if (value === null) return accept<number | null>(null)
    const n = wholeNumber(value)
    return n !== null && n >= 0 ? accept<number | null>(n) : null
  }) as Rule<number | null>,
  /** A `{value, unit}` weight input converted once to whole grams, no lower than `minimum`. */
  weight: (minimum: number): Rule<number> => (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || value instanceof JsonNumber) return null
    const input = value as Record<string, unknown>
    if (Object.keys(input).some((key) => key !== 'value' && key !== 'unit')) return null
    const grams = input.value instanceof JsonNumber ? entryGrams(input.value, input.unit, minimum) : null
    return grams === null ? null : accept(grams)
  },
}

/** The same published fields, every one of them optional. */
type Optionalised<S extends Spec> = { [K in keyof S]: S[K] extends FieldDecl<infer T> ? FieldDecl<T, false> : never }

export function optionalised<S extends Spec>(spec: S): Optionalised<S> {
  return Object.fromEntries(Object.entries(spec).map(([name, decl]) => [name, { ...decl, required: false }])) as Optionalised<S>
}

type RequiredKeys<S extends Spec> = { [K in keyof S]: S[K] extends FieldDecl<unknown, true> ? K : never }[keyof S]
type ValueOf<D> = D extends FieldDecl<infer T> ? T : never
/** Required fields are always present once a request has been settled; optional ones may be absent. */
type Values<S extends Spec> = { [K in RequiredKeys<S>]: ValueOf<S[K]> } & { [K in Exclude<keyof S, RequiredKeys<S>>]?: ValueOf<S[K]> }

interface Parsed<S extends Spec> {
  values: Values<S>
  /** Messages for values that were sent but are unacceptable, and for required fields that are missing. */
  invalid: Record<string, string>
  /** Fields sent that the route does not publish. */
  unknown: string[]
}

const UNPUBLISHED = "This field can't be set."

function messageOf(decl: FieldDecl<unknown>, context: FieldContext): string {
  return typeof decl.message === 'function' ? decl.message(context) : decl.message
}

/** The one declaration of a write route's published fields: validation and the unpublished-field refusal both read it. */
export function declare<S extends Spec>(spec: S) {
  return {
    read(body: Record<string, unknown>, context: FieldContext = { unitsOwned: 0 }): Parsed<S> {
      const values: Record<string, unknown> = {}
      const invalid: Record<string, string> = {}
      for (const [name, decl] of Object.entries(spec)) {
        if (!Object.hasOwn(body, name)) {
          if (decl.required) invalid[name] = messageOf(decl, context)
          continue
        }
        const accepted = decl.rule(body[name], context)
        if (accepted === null) invalid[name] = messageOf(decl, context)
        else values[name] = accepted.value
      }
      const unknown = Object.keys(body).filter((name) => !Object.hasOwn(spec, name))
      return { values: values as Values<S>, invalid, unknown }
    },
  }
}

/** Refuses unpublished fields first (one entry each, nothing else), then unacceptable values. */
export function settle<S extends Spec>(parsed: Parsed<S>): Values<S> {
  if (parsed.unknown.length > 0) {
    throw refuse.validation(Object.fromEntries(parsed.unknown.map((name) => [name, UNPUBLISHED])))
  }
  if (Object.keys(parsed.invalid).length > 0) throw refuse.validation(parsed.invalid)
  return parsed.values
}

/** A published request header: refused when missing (if it must be sent) or when its value fails `pattern`. */
interface HeaderDecl {
  whenMissing?: () => HttpError
  pattern?: RegExp
  message?: string
}

/** The one declaration of a write route's published headers; the handler reads values only through it. */
export function declareHeaders<S extends Record<string, HeaderDecl>>(spec: S) {
  return {
    read(header: (name: string) => string | undefined): { [K in keyof S]?: string } {
      const values: Record<string, string> = {}
      const invalid: Record<string, string> = {}
      for (const [name, decl] of Object.entries(spec)) {
        const value = header(name.toLowerCase())
        if (value === undefined) {
          if (decl.whenMissing) throw decl.whenMissing()
        } else if (decl.pattern && !decl.pattern.test(value)) {
          invalid[name] = decl.message ?? UNPUBLISHED
        } else {
          values[name] = value
        }
      }
      if (Object.keys(invalid).length > 0) throw refuse.validation(invalid)
      return values as { [K in keyof S]?: string }
    },
  }
}
