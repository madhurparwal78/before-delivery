import { GlyphSprite } from './components/Glyph.tsx'
import { Home, Invite, NotFound, SettingsPage, Signin, Signup, Verify } from './pages/Account.tsx'
import { Compare } from './pages/Compare.tsx'
import { Designer } from './pages/Designer.tsx'
import { Follow } from './pages/Follow.tsx'
import { Public } from './pages/Public.tsx'
import { useLocation } from './router.ts'
import { useSession } from './session.tsx'

export function App() {
  const { ready } = useSession()
  const { path } = useLocation()
  if (!ready) return null
  const part = path.split('/').filter(Boolean)
  let page = <NotFound />
  if (path === '/') page = <Home />
  else if (path === '/signin') page = <Signin />
  else if (path === '/signup') page = <Signup />
  else if (path === '/verify') page = <Verify />
  else if (path === '/settings') page = <SettingsPage />
  else if (part[0] === 'invite' && part.length === 2) page = <Invite token={part[1]} />
  else if (part[0] === 'patterns' && part.length === 2) page = <Designer key={part[1]} id={part[1]} />
  else if (part[0] === 'patterns' && part.length === 3 && part[2] === 'compare') page = <Compare key={part[1]} id={part[1]} />
  else if (part[0] === 'follow' && part.length === 2) page = <Follow key={part[1]} id={part[1]} />
  else if (part[0] === 'p' && part.length === 2) page = <Public id={part[1]} />
  return <><GlyphSprite />{page}</>
}
