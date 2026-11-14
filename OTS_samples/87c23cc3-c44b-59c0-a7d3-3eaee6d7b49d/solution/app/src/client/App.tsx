import { useEffect, type ReactNode } from 'react'
import { AlertProvider } from './alerts.tsx'
import { AnnounceProvider } from './announce.tsx'
import { boot } from './boot.ts'
import { Dashboard } from './pages/Dashboard.tsx'
import { Landing } from './pages/Landing.tsx'
import { NotFound } from './pages/NotFound.tsx'
import { SharedPage } from './pages/SharedPage.tsx'
import { SignIn } from './pages/SignIn.tsx'
import { Studio } from './pages/Studio.tsx'
import { RouterProvider, useNavigation } from './router.tsx'
import { SessionProvider, useSession } from './session.tsx'
import { NavBar } from './ui/NavBar.tsx'
import { StatusStrip } from './ui/StatusStrip.tsx'

/** Shows the page only to a signed-in person; a signed-out visitor is sent to sign in and back. */
function RequireUser({ children }: { children: ReactNode }) {
  const { user } = useSession()
  const { path, navigate } = useNavigation()
  useEffect(() => {
    if (user === null) navigate(`/signin?next=${encodeURIComponent(path)}`)
  }, [user, path, navigate])
  return user ? <>{children}</> : <p className="loading">Loading...</p>
}

type Screen = { node: ReactNode; bleed: boolean }

/** The address the server answered with a 404, if it did. Later in-app navigation is not affected. */
const notFoundPath = boot.notFound ? window.location.pathname : null

function screenFor(path: string): Screen {
  const project = /^\/projects\/([^/]+)$/.exec(path)
  const shared = /^\/s\/([^/]+)$/.exec(path)
  if (path === notFoundPath) return { node: <NotFound />, bleed: false }
  if (path === '/') return { node: <Landing />, bleed: true }
  if (path === '/signin') return { node: <SignIn />, bleed: false }
  if (path === '/projects') return { node: <RequireUser><Dashboard /></RequireUser>, bleed: false }
  if (project) return { node: <RequireUser><Studio projectId={project[1] as string} /></RequireUser>, bleed: true }
  if (shared) return { node: <SharedPage token={shared[1] as string} />, bleed: true }
  return { node: <NotFound />, bleed: false }
}

function Shell() {
  const { path } = useNavigation()
  const screen = screenFor(path)
  return (
    <>
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <header className="chrome">
        <StatusStrip />
        <NavBar />
      </header>
      <main id="content" tabIndex={-1} className={screen.bleed ? 'page-bleed' : 'page'}>
        {screen.node}
      </main>
    </>
  )
}

export function App() {
  return (
    <RouterProvider>
      <SessionProvider>
        <AnnounceProvider>
          <AlertProvider>
            <Shell />
          </AlertProvider>
        </AnnounceProvider>
      </SessionProvider>
    </RouterProvider>
  )
}
