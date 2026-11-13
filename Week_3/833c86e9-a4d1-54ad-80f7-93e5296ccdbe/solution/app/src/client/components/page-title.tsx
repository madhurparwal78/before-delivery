import { useEffect, useRef, type ReactNode } from 'react'

/** The page's `h1`; focus moves to it when the page opens. */
export function PageTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => ref.current?.focus({ preventScroll: true }), [])
  return <h1 ref={ref} tabIndex={-1} className={`page-title ${className}`}>{children}</h1>
}

/** Where a dialog sends focus when its opener is gone. */
export const titleElement = (): HTMLElement | null => document.querySelector<HTMLElement>('.page-title')
