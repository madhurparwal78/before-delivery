import { useEffect, useRef, useState } from 'react'
import '../styles/night-strip.css'
import type { Currency } from '../../shared/i18n'
import type { QuoteNight } from '../../shared/types'
import { announce } from '../live'
import { useApp } from '../state'
import { Money, Tag, prefersReducedMotion } from '../ui'

const TAGS = { base: 'sage', discount: 'orange', held: 'acid', closed: 'black' } as const

/** Night Strip: one column per night with a roving tab stop; Enter opens the price lines of a night in EUR. */
export function NightStrip({ nights, currency, taxes = true, zone }: { nights: QuoteNight[]; currency: Currency; taxes?: boolean; zone: string }) {
  const app = useApp()
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const refs = useRef<Map<string, HTMLLIElement>>(new Map())
  const buttons = useRef<Map<string, HTMLButtonElement>>(new Map())
  const rtl = app.dir === 'rtl'

  useEffect(() => setActive((index) => Math.min(index, Math.max(0, nights.length - 1))), [nights.length])

  const amountOf = (night: QuoteNight): number => (taxes ? night.converted_minor : night.converted_taxable_minor)
  const nameOf = (night: QuoteNight): string => app.t('ui.nightButton', { 'weekday day month': app.fmt.weekdayDayMonth(night.date, app.lang, zone), amount: app.money(amountOf(night), currency) })

  const animate = (date: string, from: number, to: number): void => {
    const column = refs.current.get(date)
    if (!column || prefersReducedMotion()) return
    const animation = column.animate([{ flexGrow: from }, { flexGrow: to }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' })
    animation.id = 'night-expand'
  }

  const toggle = (night: QuoteNight): void => {
    if (open === night.date) {
      animate(night.date, 3, 1)
      setOpen(null)
      return
    }
    if (open) animate(open, 3, 1)
    animate(night.date, 1, 3)
    setOpen(night.date)
  }

  const focusAt = (index: number): void => {
    const target = Math.max(0, Math.min(nights.length - 1, index))
    setActive(target)
    buttons.current.get(nights[target].date)?.focus()
    announce('search', nameOf(nights[target]))
  }

  const onKey = (event: React.KeyboardEvent, index: number, night: QuoteNight): void => {
    const next = rtl ? 'ArrowLeft' : 'ArrowRight'
    const previous = rtl ? 'ArrowRight' : 'ArrowLeft'
    if (event.key === next) focusAt(index + 1)
    else if (event.key === previous) focusAt(index - 1)
    else if (event.key === 'Home') focusAt(0)
    else if (event.key === 'End') focusAt(nights.length - 1)
    else if (event.key === 'Enter') toggle(night)
    else if (event.key === 'Escape' && open) {
      animate(open, 3, 1)
      setOpen(null)
      buttons.current.get(night.date)?.focus()
      event.stopPropagation()
    } else return
    event.preventDefault()
  }

  return (
    <div role="group" aria-label={app.t('ui.nightStrip')} className="night-strip">
      <ul className="nights">
        {nights.map((night, index) => (
          <li key={night.date} ref={(element) => void (element ? refs.current.set(night.date, element) : refs.current.delete(night.date))} className={`night night-${night.state}`} data-open={open === night.date || undefined}>
            <button
              type="button" ref={(element) => void (element ? buttons.current.set(night.date, element) : buttons.current.delete(night.date))}
              data-date={night.date} data-state={night.state} aria-label={nameOf(night)} aria-expanded={open === night.date}
              tabIndex={index === active ? 0 : -1} className="night-button"
              onFocus={() => setActive(index)} onKeyDown={(event) => onKey(event, index, night)} onClick={() => { setActive(index); toggle(night) }}
            >
              <span className="night-day">{app.fmt.weekdayDayMonth(night.date, app.lang, zone)}</span>
              <Money minor={amountOf(night)} currency={currency} className="night-amount" />
            </button>
            <Tag kind={TAGS[night.state]}>{app.t(`state.${night.state}`)}</Tag>
            {open === night.date && (
              <ul role="list" aria-label={app.t('ui.priceLines')} className="price-lines">
                {night.lines.map((line) => (
                  <li key={line.key} data-minor={line.minor} data-currency="EUR" aria-label={app.t('ui.lineItem', { label: app.t(`line.${line.key}`), amount: app.money(line.minor, 'EUR') })}>
                    <span>{app.t(`line.${line.key}`)}</span>
                    <Money minor={line.minor} currency="EUR" />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
