import { useEffect } from 'react'
import { api, setUnauthenticatedHandler } from './api'
import { cache } from './cache'
import { Closet } from './pages-closet'
import { Imports } from './pages-imports'
import { SessionDialog, Settings, SignIn } from './pages-account'
import { Trips } from './pages-trips'
import { navigate, routeOf, usePath } from './router'
import { OFFLINE_COPY, online, useStore } from './status'
import { Link, Status } from './ui'
import { Workspace } from './workspace/Workspace'
import { flushQueue } from './workspace/sync-queue'

const NAV = [
  { to: '/closet', label: 'Closet' },
  { to: '/trips', label: 'Trips' },
  { to: '/imports', label: 'Imports' },
  { to: '/settings', label: 'Settings' },
]

function Masthead({ path }: { path: string }) {
  async function signOut() {
    await api.signOut().catch(() => undefined)
    cache.clearReads()
    navigate('/sign-in')
  }
  return (
    <header className="masthead">
      <span className="brand">Skinout</span>
      <nav aria-label="Main">
        {NAV.map((entry) => (
          <Link key={entry.to} to={entry.to} current={path === entry.to || (entry.to === '/trips' && path.startsWith('/lists/'))}>{entry.label}</Link>
        ))}
      </nav>
      <button type="button" onClick={() => void signOut()}>Sign out</button>
    </header>
  )
}

function NotFound() {
  return (
    <main className="page">
      <h1 tabIndex={-1}>Page not found</h1>
      <p className="empty">There is nothing at this address. <Link to="/trips">Back to Trips</Link></p>
    </main>
  )
}

export function App() {
  const path = usePath()
  const route = routeOf(path)
  const isOnline = useStore(online)

  useEffect(() => {
    setUnauthenticatedHandler(() => navigate('/sign-in'))
    return online.subscribe(() => {
      if (online.get()) void flushQueue()
    })
  }, [])

  let page
  if (route.page === 'sign-in') page = <SignIn />
  else {
    page = (
      <>
        <Masthead path={path} />
        {route.page === 'closet' && <Closet />}
        {route.page === 'trips' && <Trips />}
        {route.page === 'imports' && <Imports />}
        {route.page === 'settings' && <Settings />}
        {route.page === 'list' && <Workspace key={route.id} id={route.id} arrivedByCreate={window.history.state?.arrivedByCreate === true} />}
        {route.page === 'missing' && <NotFound />}
      </>
    )
  }

  return (
    <>
      <Status name="Connection" text={isOnline ? '' : OFFLINE_COPY} className="connection" />
      {page}
      <SessionDialog />
    </>
  )
}
