import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CURRENCIES, LANGS, t as translate, type Currency, type Lang, type Params } from '../shared/i18n'
import { dayMonth, longDate, moment, money, monthYear, num1, weekdayDayMonth, weekdayName, wholeMajor } from '../shared/format'
import { encode } from '../shared/search-link'
import type { Me } from '../shared/types'
import { api, get } from './api'
import { announce, useLive } from './live'
import { navigate, navigationCommitted, replaceUrl, useLocation } from './router'

const fmt = { dayMonth, longDate, moment, money, monthYear, num1, weekdayDayMonth, weekdayName, wholeMajor }

export interface App {
  lang: Lang
  cur: Currency
  dir: 'ltr' | 'rtl'
  me: Me | null
  /** Looks up a published string in the page's language. */
  t: (key: string, params?: Params) => string
  money: (minor: number, currency?: Currency) => string
  refreshMe: () => Promise<void>
  /** Stores a new language through the Language combobox and shows it once stored. */
  chooseLang: (lang: Lang) => Promise<void>
  chooseCur: (cur: Currency) => Promise<void>
  fmt: typeof fmt
}

const Context = createContext<App | null>(null)

export function useApp(): App {
  const app = useContext(Context)
  if (!app) throw new Error('useApp is used outside AppState')
  return app
}

const isLang = (value: string | null): value is Lang => LANGS.includes(value as Lang)
const isCur = (value: string | null): value is Currency => CURRENCIES.includes(value as Currency)

/** The page URL with its lang and cur updated, only when the URL already carries them. */
function withPrefs(path: string, search: string, next: { lang?: Lang; cur?: Currency }): string | null {
  const params = new URLSearchParams(search)
  if (!params.has('lang') && !params.has('cur')) return null
  const pairs: string[] = []
  let placed = false
  for (const [key, value] of params) {
    if (key === 'lang' && next.lang) pairs.push(`lang=${next.lang}`)
    else if (key === 'cur' && next.cur) pairs.push(`cur=${next.cur}`)
    else pairs.push(`${key}=${encode(value)}`)
    placed = true
  }
  return placed ? `${path}?${pairs.join('&')}` : null
}

export function AppState({ children }: { children: ReactNode }) {
  const loc = useLocation()
  const [me, setMe] = useState<Me | null>(null)
  const [lang, setLang] = useState<Lang>('en')
  const [cur, setCur] = useState<Currency>('EUR')
  const stored = useRef<{ lang: Lang; cur: Currency }>({ lang: 'en', cur: 'EUR' })
  const loaded = useRef(false)
  const [ready, setReady] = useState(false)

  /* The first render needs a language: the URL's, else the stored one, else the defaults. */
  const start = useCallback((next: Me | null) => {
    loaded.current = true
    const params = new URLSearchParams(window.location.search)
    setLang(isLang(params.get('lang')) ? (params.get('lang') as Lang) : next?.lang ?? 'en')
    setCur(isCur(params.get('cur')) ? (params.get('cur') as Currency) : next?.cur ?? 'EUR')
    setReady(true)
  }, [])

  const refreshMe = useCallback(async () => {
    const next = await get<Me>('/api/me')
    setMe(next)
    stored.current = { lang: next.lang, cur: next.cur }
    if (!loaded.current) start(next)
  }, [start])

  /* A failed first read still shows the page; the stored values are read again a second later. */
  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined
    const load = () => {
      refreshMe().catch(() => {
        if (!loaded.current) start(null)
        retry = setTimeout(load, 1000)
      })
    }
    load()
    return () => clearTimeout(retry)
  }, [refreshMe, start])

  /* The URL's lang and cur win for the page they are on, without changing what is stored. */
  useEffect(() => {
    if (!loaded.current) return
    const params = new URLSearchParams(loc.search)
    const urlLang = params.get('lang')
    const urlCur = params.get('cur')
    if (isLang(urlLang)) setLang(urlLang)
    if (isCur(urlCur)) setCur(urlCur)
  }, [loc.search, loc.path])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }, [lang])

  useLive('account.changed', (event) => {
    if (event.signed_out) {
      setMe((current) => (current ? { ...current, user: null } : current))
      navigate('/signin')
      announce('toast', translate(lang, 'signed.out'))
      return
    }
    const nextLang = isLang(event.lang) ? event.lang : undefined
    const nextCur = isCur(event.cur) ? event.cur : undefined
    if (nextLang || nextCur) {
      if (nextLang) setLang(nextLang)
      if (nextCur) setCur(nextCur)
      const url = withPrefs(window.location.pathname, window.location.search.slice(1), { lang: nextLang, cur: nextCur })
      if (url) replaceUrl(url)
    }
    void refreshMe()
  })

  /* The page switches once the server has stored the choice, the same moment other tabs hear of it. */
  const choose = useCallback(async (next: { lang?: Lang; cur?: Currency }) => {
    await api('PATCH', '/api/me/preferences', next)
    if (next.lang) setLang(next.lang)
    if (next.cur) setCur(next.cur)
    const url = withPrefs(window.location.pathname, window.location.search.slice(1), next)
    if (url) navigate(url)
  }, [])

  const value = useMemo<App>(() => ({
    lang, cur, dir: lang === 'ar' ? 'rtl' : 'ltr', me,
    t: (key, params) => translate(lang, key, params),
    money: (minor, currency = cur) => money(minor, currency, lang),
    refreshMe,
    chooseLang: (next) => choose({ lang: next }),
    chooseCur: (next) => choose({ cur: next }),
    fmt,
  }), [lang, cur, me, refreshMe, choose])

  /* Children mount once the stored language is known; the navigation hold is released after their effects have started requests. */
  useEffect(() => {
    if (ready) navigationCommitted()
  }, [ready, loc])

  return <Context.Provider value={value}>{ready ? children : null}</Context.Provider>
}
