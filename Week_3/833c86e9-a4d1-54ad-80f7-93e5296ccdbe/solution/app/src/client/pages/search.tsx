import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { MAX_ADULTS } from '../../shared/rules'
import { buildQuery, parseCanonical, SORTS, type SearchParams } from '../../shared/search-link'
import type { DestinationRow, SearchResponse } from '../../shared/types'
import { ApiFailure, get } from '../api'
import { Filters } from '../components/filters'
import { DEFAULT_ZOOM, MapPlane, type MapViewState } from '../components/map'
import { ResultRow } from '../components/result-row'
import { SearchForm, type SearchRequest } from '../components/search-form'
import { announce, useLive } from '../live'
import { navigate, replaceUrl, useLocation, type Loc } from '../router'
import { useApp } from '../state'
import { BigWord, Button, Dialog } from '../ui'
import '../styles/search.css'

type Layout = 'phone' | 'tablet' | 'desk'
type Saved = NonNullable<Loc['saved']>
type Job = { mode: 'restore'; saved: Saved } | { mode: 'top' } | null

const DESK = '(min-width: 1280px)'
const TABLET = '(min-width: 768px)'
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function readLayout(): Layout {
  return window.matchMedia(DESK).matches ? 'desk' : window.matchMedia(TABLET).matches ? 'tablet' : 'phone'
}

function useLayout(): Layout {
  const [layout, setLayout] = useState(readLayout)
  useEffect(() => {
    const queries = [window.matchMedia(DESK), window.matchMedia(TABLET)]
    const update = (): void => setLayout(readLayout())
    queries.forEach((query) => query.addEventListener('change', update))
    return () => queries.forEach((query) => query.removeEventListener('change', update))
  }, [])
  return layout
}

const readParams = (search: string): SearchParams => parseCanonical(search) as SearchParams
const withoutSel = (search: string): string => search.split('&').filter((pair) => !pair.startsWith('sel=')).join('&')
const searchUrl = (params: SearchParams): string => `/search?${buildQuery(params)}`

/** Scroll and focus of a finished load: restore what the entry had, or start at the top on `Results`. */
function settle(job: Job): void {
  const heading = document.getElementById('results-heading')
  if (!job) return
  if (job.mode === 'top') window.scrollTo(0, 0)
  else window.scrollTo(0, job.saved.scrollY)
  const key = job.mode === 'restore' ? job.saved.focusKey : null
  const target = key ? document.querySelector<HTMLElement>(`[data-focus-key="${key}"]`) : null
  ;(target ?? heading)?.focus({ preventScroll: true })
}

export function SearchPage(_props: { params: string[] }) {
  const app = useApp()
  const loc = useLocation()
  const layout = useLayout()
  const parsed = parseCanonical(loc.search)
  const params = parsed as SearchParams
  const runnable = Boolean(parsed.raw.dest && parsed.raw.in && parsed.raw.out)

  const [destinations, setDestinations] = useState<DestinationRow[]>([])
  const [data, setData] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [failure, setFailure] = useState<'missing' | 'limited' | null>(null)
  const [notice, setNotice] = useState('')
  const [sheet, setSheet] = useState<'filters' | 'map' | null>(null)

  const destination = destinations.find((candidate) => candidate.code === parsed.raw.dest)
  const urlView: MapViewState = params.view ?? { zoom: DEFAULT_ZOOM, cx: destination?.cx ?? 500, cy: destination?.cy ?? 500 }
  const urlViewKey = JSON.stringify(urlView)
  const [view, setView] = useState(urlView)

  const mounted = useRef(true)
  const destinationsReady = useRef<Promise<DestinationRow[]>>(Promise.resolve([]))
  const requestId = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const loadedKey = useRef<string | null>(null)
  const ownReplace = useRef(false)
  const force = useRef(false)
  const shown = useRef(false)
  const job = useRef<Job>(null)
  const refocus = useRef<string | null>(null)

  useEffect(() => {
    mounted.current = true
    destinationsReady.current = get<DestinationRow[]>('/api/destinations?q=').then((list) => {
      if (mounted.current) setDestinations(list)
      return list
    }, () => [])
    return () => {
      mounted.current = false
      controller.current?.abort()
      announce('notice', '')
    }
  }, [])

  useEffect(() => setView(urlView), [urlViewKey])
  useEffect(() => (layout !== 'phone' ? setSheet(null) : undefined), [layout])
  useEffect(() => {
    if (sheet || !refocus.current) return
    document.querySelector<HTMLElement>(`[data-focus-key="${refocus.current}"]`)?.focus()
    refocus.current = null
  }, [sheet])

  useLayoutEffect(() => {
    settle(job.current)
    job.current = null
  }, [data])

  const load = async (at: Loc, live: boolean): Promise<void> => {
    const id = ++requestId.current
    controller.current?.abort()
    const request = (controller.current = new AbortController())
    setLoading(true)
    try {
      const [list, answer] = await Promise.all([destinationsReady.current, get<SearchResponse>(`/api/search?${at.search}`, { signal: request.signal })])
      if (id !== requestId.current || !mounted.current) return
      const zone = list.find((candidate) => candidate.code === new URLSearchParams(answer.canonical).get('dest'))?.zone ?? 'UTC'
      const text = answer.notices
        .map((entry) => app.t(entry.key, { name: entry.name ?? '', date: entry.date ? app.fmt.longDate(entry.date, app.lang, zone) : '', n: entry.n ?? 0, value: entry.value ?? '' }))
        .join(' ')
      const first = !shown.current
      shown.current = true
      if (!live) {
        if (at.nav === 'pop' && at.saved) job.current = { mode: 'restore', saved: at.saved }
        else if (first || at.nav === 'load' || (at.nav === 'push' && typeof at.state.prev === 'string')) job.current = { mode: 'top' }
      }
      loadedKey.current = withoutSel(answer.canonical)
      setFailure(null)
      setData(answer)
      setNotice(text)
      announce('notice', text)
      announce('search', app.t('count.found', { 'count:property': answer.count }))
      if (answer.canonical !== at.search && window.location.pathname === '/search' && window.location.search === `?${at.search}`) {
        ownReplace.current = true
        replaceUrl(`/search?${answer.canonical}`)
      }
    } catch (error) {
      if (id !== requestId.current || !mounted.current) return
      loadedKey.current = null
      setData(null)
      setFailure(error instanceof ApiFailure && error.status === 429 ? 'limited' : 'missing')
    } finally {
      if (id === requestId.current && mounted.current) {
        setLoading(false)
        setSearching(false)
      }
    }
  }

  useEffect(() => {
    if (ownReplace.current) {
      ownReplace.current = false
      return
    }
    if (!runnable) {
      requestId.current += 1
      controller.current?.abort()
      loadedKey.current = null
      setData(null)
      setFailure(null)
      setLoading(false)
      setNotice('')
      announce('notice', '')
      return
    }
    if (!force.current && loadedKey.current === withoutSel(loc.search)) {
      if (loc.nav === 'pop' && loc.saved) settle({ mode: 'restore', saved: loc.saved })
      return
    }
    force.current = false
    void load(loc, false)
  }, [loc])

  useLive('availability', () => {
    if (runnable && loadedKey.current) void load(loc, true)
  })

  /* One history entry per user change, built from the URL as it is now. */
  const go = (patch: Partial<SearchParams>, state?: Record<string, unknown>): void => {
    const now = readParams(window.location.search.slice(1))
    navigate(searchUrl({ ...now, lang: app.lang, cur: app.cur, cursor: null, ...patch }), { state })
  }

  const search = (request: SearchRequest): void => {
    force.current = true
    setSearching(true)
    go({ ...request, view: null, sel: null })
  }

  const select = (code: string): void => {
    if (params.sel === code) return
    go({ sel: code, cursor: params.cursor })
    document.getElementById(`row-${code}`)?.scrollIntoView({ block: 'nearest' })
  }

  const showOnMap = (code: string): void => {
    const pin = data?.pins.find((candidate) => candidate.code === code)
    if (pin) setView((now) => ({ ...now, cx: Math.round(pin.x * 10) / 10, cy: Math.round(pin.y * 10) / 10 }))
    select(code)
  }

  const selectOnPlane = (code: string): void => {
    if (layout === 'phone' && sheet === 'map') {
      refocus.current = `show-${code}`
      setSheet(null)
    }
    select(code)
  }

  const open = (code: string): void => navigate(`/properties/${code}?${loc.search}`)

  const nextUrl = data?.next_cursor ? searchUrl({ ...params, cursor: data.next_cursor }) : null
  const previousUrl = typeof loc.state.prev === 'string' ? loc.state.prev : null
  const plain = (event: MouseEvent): boolean => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

  const initial = {
    text: destination?.name ?? '',
    in: ISO_DAY.test(parsed.raw.in ?? '') && ISO_DAY.test(parsed.raw.out ?? '') ? parsed.raw.in : null,
    out: ISO_DAY.test(parsed.raw.in ?? '') && ISO_DAY.test(parsed.raw.out ?? '') ? parsed.raw.out : null,
    adults: Math.min(MAX_ADULTS, Math.max(1, params.adults ?? 2)),
    ages: (params.ages ?? []).filter((age) => age >= 0 && age <= 17).slice(0, 8),
  }

  const map = (
    <MapPlane
      destination={params.dest} centre={{ x: destination?.cx ?? 500, y: destination?.cy ?? 500 }} pins={data?.pins ?? []} view={view}
      searched={urlView} selected={params.sel} onView={setView} onSelect={selectOnPlane} onOpen={open}
      onSearchArea={() => go({ view, cursor: null })}
    />
  )
  const filters = data && <Filters data={data} params={params} onChange={(patch) => go(patch)} />

  return (
    <div className="search" data-layout={layout}>
      <SearchForm initial={initial} destinations={destinations} busy={searching} onSearch={search} />
      <p className="notice-line" aria-hidden="true">{notice}</p>
      {runnable && layout === 'phone' && (
        <div className="sheet-openers">
          <Button className="quiet" data-focus-key="open-filters" onClick={() => setSheet('filters')}>{app.t('ui.filters')}</Button>
          <Button className="quiet" data-focus-key="open-map" onClick={() => setSheet('map')}>{app.t('ui.map')}</Button>
        </div>
      )}
      {runnable && (
        <div className="search-body">
          {layout !== 'phone' && <aside className="filters-column">{filters}</aside>}
          <section className="results-column">
            <h1 id="results-heading" className="results-heading" tabIndex={-1}>{app.t('ui.results')}</h1>
            {data && <p className="muted result-count">{app.t('count.found', { 'count:property': data.count })}</p>}
            <div className="results-bar">
              <label className="bar-field">
                <span className="field-label">{app.t('ui.sortBy')}</span>
                <select className="select" value={params.sort} data-focus-key="sort" onChange={(event) => go({ sort: event.target.value as SearchParams['sort'] })}>
                  {SORTS.map((sort) => <option key={sort} value={sort}>{app.t(`sort.${sort}`)}</option>)}
                </select>
              </label>
              <div role="radiogroup" aria-label={app.t('ui.priceDisplay')} className="bar-toggles">
                {(['night', 'total'] as const).map((display) => (
                  <label key={display} className="toggle" data-checked={params.display === display || undefined}>
                    <input type="radio" name="display" checked={params.display === display} data-focus-key={`display-${display}`} onChange={() => go({ display })} />
                    <span>{app.t(display === 'night' ? 'ui.perNight' : 'ui.total')}</span>
                  </label>
                ))}
              </div>
              <button
                type="button" role="switch" aria-checked={params.tax} className="toggle toggle-switch" data-checked={params.tax || undefined} data-focus-key="tax"
                onClick={() => go({ tax: !params.tax })}
              >
                {app.t('ui.includeTaxes')}
              </button>
            </div>
            {layout === 'tablet' && <div className="map-band">{map}</div>}
            <div className="rows" aria-busy={loading ? 'true' : undefined}>
              {failure === 'limited' && <p>{app.t('rate.limited')}</p>}
              {failure === 'missing' && <BigWord word={app.t('empty.results.word')} sentence={app.t('page.missing')} />}
              {!data && !failure && loading && [0, 1, 2].map((slot) => <div key={slot} className="skeleton" />)}
              {data && data.count === 0 && <BigWord word={app.t('empty.results.word')} sentence={app.t('empty.results')} />}
              {data?.results.map((result) => (
                <ResultRow
                  key={result.code} result={result} href={`/properties/${result.code}?${loc.search}`} selected={params.sel === result.code}
                  perNight={params.display === 'night'} onShow={() => showOnMap(result.code)}
                />
              ))}
              {data && (previousUrl || nextUrl) && (
                <div className="paging">
                  {previousUrl && (
                    <a
                      href={previousUrl} className="btn quiet" data-focus-key="previous"
                      onClick={(event) => {
                        if (!plain(event)) return
                        event.preventDefault()
                        history.back()
                      }}
                    >
                      {app.t('ui.prevPage')}
                    </a>
                  )}
                  {nextUrl && (
                    <a
                      href={nextUrl} className="btn quiet" data-focus-key="next"
                      onClick={(event) => {
                        if (!plain(event)) return
                        event.preventDefault()
                        navigate(nextUrl, { state: { prev: `/search?${loc.search}` } })
                      }}
                    >
                      {app.t('ui.nextPage')}
                    </a>
                  )}
                </div>
              )}
            </div>
          </section>
          {layout === 'desk' && <div className="map-column">{map}</div>}
        </div>
      )}
      {sheet === 'filters' && data && (
        <Dialog label={app.t('ui.filters')} sheet="filters" onClose={() => setSheet(null)}>
          <div className="sheet-head">
            <h2>{app.t('ui.filters')}</h2>
            <Button className="quiet" data-focus-key="close-filters" onClick={() => setSheet(null)}>{app.t('ui.close')}</Button>
          </div>
          {filters}
        </Dialog>
      )}
      {sheet === 'map' && (
        <Dialog label={app.t('ui.map')} sheet="map" onClose={() => setSheet(null)}>
          <div className="sheet-head">
            <h2>{app.t('ui.map')}</h2>
            <Button className="quiet" data-focus-key="close-map" onClick={() => setSheet(null)}>{app.t('ui.close')}</Button>
          </div>
          <div className="map-sheet">{map}</div>
        </Dialog>
      )}
    </div>
  )
}
