import { Link } from '../router.tsx'

/** Every unknown or unavailable project or link address: it never names a project. */
export function NotFound() {
  return (
    <section className="not-found">
      <span className="empty-badge" aria-hidden="true">
        <svg viewBox="0 0 40 40" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="9" width="28" height="22" rx="3" />
          <path d="M6 16h28M15 16v15" />
          <path d="M24 23l6 6M30 23l-6 6" />
        </svg>
      </span>
      <h1>Nothing here</h1>
      <p className="hint">This link or project isn't available. It may have been turned off, or the address may be wrong.</p>
      <Link href="/projects" className="btn btn-primary">
        Go to your projects
      </Link>
    </section>
  )
}
