export function Masthead({ staffLink = true }: { staffLink?: boolean }) {
  return (
    <header className="masthead">
      <span className="company">Vellichor Holdings</span>
      <p className="wordmark">Tracewell</p>
      <span className="ticker">Nasdaq: VLCH</span>
      <span className="spacer" />
      {staffLink && <a className="staff-link" href="/staff">Staff sign in</a>}
    </header>
  );
}
