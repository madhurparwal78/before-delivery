import { useEffect, useState } from 'react'
import { Wordmark } from './Wordmark'

// The white loading screen: the wordmark and the layout load pill, whose fill grows only with real progress.
export function Splash({ needed, progress }: { needed: boolean; progress: number }) {
  const [mounted, setMounted] = useState(true)
  useEffect(() => {
    if (needed) {
      setMounted(true)
      return undefined
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMounted(false)
      return undefined
    }
    const timer = window.setTimeout(() => setMounted(false), 700)
    return () => window.clearTimeout(timer)
  }, [needed])
  if (!mounted) return null
  return (
    <div className={`splash${needed ? '' : ' leaving'}`}>
      <Wordmark />
      <div className="pill" role="progressbar" aria-label="Loading layout" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} data-testid="layout-load-pill">
        <div className="pill-track">
          <div className="pill-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  )
}
