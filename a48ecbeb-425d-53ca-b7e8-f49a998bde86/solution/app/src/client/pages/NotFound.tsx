import { Link } from "../lib/router";

export function NotFound() {
  return (
    <div className="page page-narrow not-found">
      <div className="panel empty">
        <svg viewBox="0 0 160 110" width="160" height="110" aria-hidden="true" focusable="false">
          <path d="M20 96 C 50 80 110 80 140 96" stroke="#5a5040" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M80 14c14 12 20 24 20 36a20 20 0 0 1-40 0c0-12 6-24 20-36z" fill="#8cc47a" />
          <path d="M80 26v48" stroke="#386e2e" strokeWidth="3" strokeLinecap="round" />
          <circle cx="104" cy="70" r="8" fill="#ec5a6e" />
        </svg>
        <h1>We couldn't find that page.</h1>
        <p>The link may be old, or the page may have moved.</p>
        <Link href="/" className="btn btn-primary">
          Back to the shop
        </Link>
      </div>
    </div>
  );
}
