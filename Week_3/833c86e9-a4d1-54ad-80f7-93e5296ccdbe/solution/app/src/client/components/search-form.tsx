import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { DestinationRow } from '../../shared/types'
import { daysBetween } from '../../shared/dates'
import { MAX_ADULTS } from '../../shared/rules'
import { useApp } from '../state'
import { Button, Spinbutton } from '../ui'
import { DatePicker } from './date-picker'
import { DestinationCombobox } from './destination-combobox'

interface FormValues { text: string; in: string | null; out: string | null; adults: number; ages: number[] }
export interface SearchRequest { dest: string; in: string; out: string; adults: number; ages: number[] }

const DEFAULT_AGE = 8

/** The search box: destination, Dates, party and the Search button. Nothing runs until Search is pressed. */
export function SearchForm({ initial, destinations, busy, onSearch }: { initial: FormValues; destinations: DestinationRow[]; busy: boolean; onSearch: (request: SearchRequest) => void }) {
  const app = useApp()
  const [values, setValues] = useState(initial)
  const [picking, setPicking] = useState(false)
  const combo = useRef<HTMLInputElement>(null)
  const keepFocus = useRef(false)
  const start = JSON.stringify(initial)

  useEffect(() => setValues(initial), [start])

  /* The disabled Search button drops focus while it works; give it back when the results arrive. */
  useEffect(() => {
    if (busy || !keepFocus.current) return
    keepFocus.current = false
    if (document.activeElement === document.body) document.querySelector<HTMLElement>('[data-focus-key="search"]')?.focus()
  }, [busy])

  const dest = destinations.find((candidate) => candidate.name.toLowerCase() === values.text.trim().toLowerCase())
  const zone = dest?.zone ?? 'UTC'
  const nights = values.in && values.out ? daysBetween(values.in, values.out) : 0
  const datesLabel = values.in && values.out
    ? app.t('ui.datesRange', { in: app.fmt.dayMonth(values.in, app.lang, zone), out: app.fmt.dayMonth(values.out, app.lang, zone), 'count:night': nights })
    : app.t('ui.dates')

  const setChildren = (count: number): void =>
    setValues((current) => ({ ...current, ages: Array.from({ length: count }, (_, index) => current.ages[index] ?? DEFAULT_AGE) }))

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!dest) return combo.current?.focus()
    if (!values.in || !values.out) return setPicking(true)
    keepFocus.current = (event.nativeEvent as SubmitEvent).submitter === document.activeElement
    onSearch({ dest: dest.code, in: values.in, out: values.out, adults: values.adults, ages: values.ages })
  }

  return (
    <form className="search-form" onSubmit={submit}>
      <div className="form-field form-dest">
        <span className="field-label" aria-hidden="true">{app.t('ui.destination')}</span>
        <DestinationCombobox
          ref={combo} text={values.text}
          onText={(text) => setValues((current) => ({ ...current, text }))}
          onPick={(destination) => setValues((current) => ({ ...current, text: destination.name }))}
        />
      </div>
      <div className="form-field form-dates">
        <span className="field-label" aria-hidden="true">{app.t('ui.dates')}</span>
        <Button className="quiet date-button" data-focus-key="dates" onClick={() => (dest ? setPicking(true) : combo.current?.focus())}>{datesLabel}</Button>
      </div>
      <div className="form-field form-count">
        <span className="field-label" aria-hidden="true">{app.t('ui.adults')}</span>
        <Spinbutton label={app.t('ui.adults')} value={values.adults} min={1} max={MAX_ADULTS} data-focus-key="adults" onChange={(adults) => setValues((current) => ({ ...current, adults }))} />
      </div>
      <div className="form-field form-count">
        <span className="field-label" aria-hidden="true">{app.t('ui.children')}</span>
        <Spinbutton label={app.t('ui.children')} value={values.ages.length} min={0} max={8} data-focus-key="children" onChange={setChildren} />
      </div>
      {values.ages.map((age, index) => (
        <div key={index} className="form-field form-age">
          <span className="field-label" aria-hidden="true">{app.t('ui.ageOfChild', { n: index + 1 })}</span>
          <select
            className="select" aria-label={app.t('ui.ageOfChild', { n: index + 1 })} value={age} data-focus-key={`age-${index + 1}`}
            onChange={(event) => setValues((current) => ({ ...current, ages: current.ages.map((value, at) => (at === index ? Number(event.target.value) : value)) }))}
          >
            {Array.from({ length: 18 }, (_, option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
      ))}
      <Button type="submit" busy={busy} className="form-submit" data-focus-key="search">{app.t('ui.search')}</Button>
      <DatePicker
        open={picking} onClose={() => setPicking(false)} target={{ dest: dest?.code }} zone={zone} value={{ in: values.in, out: values.out }}
        onPick={(range) => setValues((current) => ({ ...current, ...range }))}
      />
    </form>
  )
}
