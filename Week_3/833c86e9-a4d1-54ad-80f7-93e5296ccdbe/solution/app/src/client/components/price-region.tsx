import type { ReactNode } from 'react'
import '../styles/property.css'
import { rnd } from '../../shared/rules'
import { SEARCH_KEYS, encode } from '../../shared/search-link'
import type { Quote } from '../../shared/types'
import { navigate, useLocation } from '../router'
import { useApp } from '../state'
import { Money } from '../ui'
import { Choice } from './choice'

/** The query with some keys replaced or (null) removed, in the published parameter order. */
export function withParams(search: string, changes: Record<string, string | null>): string {
  const params = new URLSearchParams(search)
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) params.delete(key)
    else params.set(key, value)
  }
  const known = SEARCH_KEYS.filter((key) => params.has(key))
  const others = [...params.keys()].filter((key) => !(SEARCH_KEYS as readonly string[]).includes(key))
  return [...known, ...others].map((key) => `${key}=${encode(params.get(key) as string)}`).join('&')
}

type Display = 'total' | 'night'

/** The price display settings kept in the URL; each change pushes one history entry. */
export function usePriceDisplay(): { display: Display; taxes: boolean; setDisplay: (next: Display) => void; setTaxes: (next: boolean) => void } {
  const loc = useLocation()
  const params = new URLSearchParams(loc.search)
  const go = (changes: Record<string, string | null>): void => navigate(`${loc.path}?${withParams(loc.search, changes)}`)
  return {
    display: params.get('display') === 'night' ? 'night' : 'total',
    taxes: params.get('tax') !== '0',
    setDisplay: (next) => go({ display: next === 'night' ? 'night' : null }),
    setTaxes: (next) => go({ tax: next ? null : '0' }),
  }
}

/** The figure the price region shows: the stay total (or its taxable part), or that divided by the nights, half up. */
function shownAmount(quote: Quote, display: Display, taxes: boolean): number {
  const total = taxes ? quote.converted_total_minor : quote.converted_taxable_minor
  return display === 'night' ? rnd(total, quote.nights_count) : total
}

export function PriceDisplayControls() {
  const app = useApp()
  const { display, taxes, setDisplay, setTaxes } = usePriceDisplay()
  return (
    <div className="price-controls">
      <div role="radiogroup" aria-label={app.t('ui.priceDisplay')} className="choices">
        <Choice type="radio" name="display" checked={display === 'night'} onChange={() => setDisplay('night')}>{app.t('ui.perNight')}</Choice>
        <Choice type="radio" name="display" checked={display === 'total'} onChange={() => setDisplay('total')}>{app.t('ui.total')}</Choice>
      </div>
      <button type="button" role="switch" aria-checked={taxes} className="switch" onClick={() => setTaxes(!taxes)}>{app.t('ui.includeTaxes')}</button>
    </div>
  )
}

/** The `Price and reserve` region: the figure, and the action (Reserve) as its child. */
export function PriceRegion({ quote, children }: { quote: Quote; children?: ReactNode }) {
  const app = useApp()
  const { display, taxes } = usePriceDisplay()
  return (
    <section aria-label={app.t('ui.priceReserve')} className="price-region">
      <p className="price-caption">{app.t(display === 'night' ? 'ui.perNight' : 'ui.total')}</p>
      <Money minor={shownAmount(quote, display, taxes)} currency={quote.currency} className="price-total" />
      {children}
    </section>
  )
}
