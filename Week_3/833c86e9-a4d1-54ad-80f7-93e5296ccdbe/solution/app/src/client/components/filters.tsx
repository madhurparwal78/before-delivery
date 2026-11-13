import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { extendMessages } from '../../shared/i18n'
import { EURO_MINOR } from '../../shared/rules'
import { AMENITIES, type SearchParams } from '../../shared/search-link'
import type { SearchResponse } from '../../shared/types'
import { useApp } from '../state'

extendMessages({ 'x.priceHeading': ['Price per night', 'Preis pro Nacht', 'السعر لكل ليلة'] })

const STARS = [3, 4, 5]
const STEP_EUROS = 10

function Toggle({ label, count, checked, focusKey, onChange }: { label: string; count: number; checked: boolean; focusKey: string; onChange: () => void }) {
  return (
    <label className="toggle" data-checked={checked || undefined}>
      <input type="checkbox" checked={checked} data-count={count} data-focus-key={focusKey} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}

/** A whole-euro price box that applies its value after the typing pause. */
function PriceBox({ label, value, focusKey, onCommit }: { label: string; value: number | null; focusKey: string; onCommit: (value: number | null) => void }) {
  const shown = value === null ? '' : String(value)
  const [text, setText] = useState(shown)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => setText(shown), [shown])
  useEffect(() => () => clearTimeout(timer.current), [])

  const change = (next: string): void => {
    setText(next)
    clearTimeout(timer.current)
    const trimmed = next.trim()
    if (trimmed !== '' && !/^\d+$/.test(trimmed)) return
    timer.current = setTimeout(() => onCommit(trimmed === '' ? null : Number(trimmed)), window.__KIP__.typeDebounceMs)
  }

  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const base = /^\d+$/.test(text.trim()) ? Number(text.trim()) : 0
    change(String(Math.max(0, base + (event.key === 'ArrowUp' ? STEP_EUROS : -STEP_EUROS))))
  }

  return (
    <label className="price-box">
      <span className="field-label">{label}</span>
      <input
        className="field" role="spinbutton" type="text" inputMode="numeric" autoComplete="off" aria-label={label} aria-valuemin={0}
        aria-valuenow={value ?? undefined} value={text} data-focus-key={focusKey} onChange={(event) => change(event.target.value)} onKeyDown={onKey}
      />
    </label>
  )
}

/** Filters as a column of text toggles with counts, the price histogram and the price range. */
export function Filters({ data, params, onChange }: { data: SearchResponse; params: SearchParams; onChange: (patch: Partial<SearchParams>) => void }) {
  const app = useApp()
  const toggled = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item])
  const tallest = Math.max(1, ...data.histogram.map((bucket) => bucket.count))

  return (
    <div className="filters">
      <fieldset className="filter-group">
        <legend>{app.t('ui.stars')}</legend>
        {STARS.map((stars) => (
          <Toggle
            key={stars} label={app.t('ui.starsOption', { n: stars, count: data.counts.stars[String(stars)] ?? 0 })} count={data.counts.stars[String(stars)] ?? 0}
            checked={params.stars.includes(stars)} focusKey={`stars-${stars}`} onChange={() => onChange({ stars: toggled(params.stars, stars) })}
          />
        ))}
      </fieldset>
      <fieldset className="filter-group">
        <legend>{app.t('ui.amenities')}</legend>
        {AMENITIES.map((amenity) => (
          <Toggle
            key={amenity} label={app.t('ui.optionCount', { label: app.t(`amen.${amenity}`), count: data.counts.amen[amenity] ?? 0 })} count={data.counts.amen[amenity] ?? 0}
            checked={params.amen.includes(amenity)} focusKey={`amen-${amenity}`} onChange={() => onChange({ amen: toggled(params.amen, amenity) })}
          />
        ))}
      </fieldset>
      <fieldset className="filter-group">
        <legend>{app.t('ui.cancellationGroup')}</legend>
        <Toggle
          label={app.t('ui.optionCount', { label: app.t('ui.freeCancellation'), count: data.counts.free })} count={data.counts.free}
          checked={params.free} focusKey="free" onChange={() => onChange({ free: !params.free })}
        />
      </fieldset>
      <div className="filter-group price-group">
        <p className="group-title">{app.t('x.priceHeading')}</p>
        <div className="histogram">
          {data.histogram.map((bucket) => {
            const from = bucket.from_minor / EURO_MINOR
            const label = bucket.to_minor === null
              ? app.t('ui.histLast', { from, 'count:property': bucket.count })
              : app.t('ui.histBar', { from, to: bucket.to_minor / EURO_MINOR, 'count:property': bucket.count })
            return (
              <div key={bucket.from_minor} role="img" aria-label={label} className="bar" data-from={bucket.from_minor} data-count={bucket.count}>
                <span style={{ height: `${(bucket.count / tallest) * 100}%` }} />
              </div>
            )
          })}
        </div>
        <div className="price-range">
          <PriceBox label={app.t('ui.lowestPrice')} value={params.min} focusKey="min" onCommit={(min) => onChange({ min })} />
          <PriceBox label={app.t('ui.highestPrice')} value={params.max} focusKey="max" onCommit={(max) => onChange({ max })} />
        </div>
      </div>
    </div>
  )
}
