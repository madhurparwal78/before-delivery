import { useEffect, type ReactNode } from 'react'
import { AppState, useApp } from './state'
import { LiveRegions, connectLive } from './live'
import { Header } from './components/header'
import { BigWord } from './ui'
import { useLocation } from './router'
import { HomePage } from './pages/home'
import { SearchPage } from './pages/search'
import { PropertyPage } from './pages/property'
import { CheckoutPage } from './pages/checkout'
import { BookingPage } from './pages/booking'
import { FindPage } from './pages/find'
import { ReviewPage } from './pages/review'
import { InboxPage } from './pages/inbox'
import { AccountPage } from './pages/account'
import { SignInPage } from './pages/signin'
import { SignUpPage } from './pages/signup'
import { ModerationPage } from './pages/moderation'
import { ManagePage } from './pages/manage'

type Page = (props: { params: string[] }) => ReactNode

const ROUTES: [RegExp, Page][] = [
  [/^\/$/, HomePage],
  [/^\/search$/, SearchPage],
  [/^\/properties\/([^/]+)$/, PropertyPage],
  [/^\/checkout\/([^/]+)$/, CheckoutPage],
  [/^\/bookings\/([^/]+)$/, BookingPage],
  [/^\/find$/, FindPage],
  [/^\/reviews\/([^/]+)$/, ReviewPage],
  [/^\/inbox$/, InboxPage],
  [/^\/account$/, AccountPage],
  [/^\/signin$/, SignInPage],
  [/^\/signup$/, SignUpPage],
  [/^\/moderation$/, ModerationPage],
  [/^\/manage\/([^/]+)\/(calendar|reservations|import|statements)$/, ManagePage],
]

/** The not-found page: the huge word and one sentence. */
export function NotFound({ forbidden = false }: { forbidden?: boolean }) {
  const app = useApp()
  return <BigWord word={app.t('empty.results.word')} sentence={app.t(forbidden ? 'page.forbidden' : 'page.missing')} />
}

function Routes() {
  const loc = useLocation()
  const app = useApp()
  const found = ROUTES.map(([pattern, page]) => ({ match: pattern.exec(loc.path), page })).find((candidate) => candidate.match)
  const Current = found?.page
  return (
    <>
      <Header />
      <main id="main" key={loc.path} data-lang={app.lang}>
        {Current ? <Current params={(found?.match as RegExpExecArray).slice(1)} /> : <NotFound />}
      </main>
    </>
  )
}

export function App() {
  useEffect(() => connectLive(), [])
  return (
    <AppState>
      <Shell />
    </AppState>
  )
}

function Shell() {
  const app = useApp()
  return (
    <>
      <Routes />
      <LiveRegions labels={{ search: app.t('ui.searchAnnouncements'), notice: app.t('ui.linkNotice'), hold: app.t('ui.holdAnnouncements'), toast: app.t('ui.toast') }} />
    </>
  )
}
