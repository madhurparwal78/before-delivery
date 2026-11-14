import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'

interface Navigation {
  path: string
  navigate: (to: string) => void
}

const NavigationContext = createContext<Navigation>({ path: '/', navigate: () => undefined })

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = (to: string): void => {
    const target = new URL(to, window.location.origin)
    window.history.pushState(null, '', target.pathname + target.search + target.hash)
    setPath(target.pathname)
    if (target.hash) document.getElementById(target.hash.slice(1))?.scrollIntoView()
    else window.scrollTo(0, 0)
  }
  return <NavigationContext.Provider value={{ path, navigate }}>{children}</NavigationContext.Provider>
}

export const useNavigation = (): Navigation => useContext(NavigationContext)

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }

/** An in-app link: plain navigation for the browser, history navigation for the click. */
export function Link({ href, onClick, ...rest }: LinkProps) {
  const { navigate } = useNavigation()
  const click = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || rest.target === '_blank' || rest.download !== undefined) return
    if (href.startsWith('#') || href.startsWith('http')) return
    event.preventDefault()
    navigate(href)
  }
  return <a href={href} onClick={click} {...rest} />
}
