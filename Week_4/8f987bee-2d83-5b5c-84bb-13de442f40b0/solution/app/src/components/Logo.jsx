import { Link } from "react-router-dom";

// The Wayline mark: a looped ribbon in violet beside a black wordmark.
export function Mark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="wl-ribbon" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8f7bff" />
          <stop offset="1" stopColor="#5e3fd6" />
        </linearGradient>
      </defs>
      <path d="M5 21c0-6 4-10 8-10s5 4 3 7-6 3-6-1 5-9 11-9c3 0 6 2 6 6" fill="none" stroke="url(#wl-ribbon)" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

export default function Logo({ to = "/" }) {
  return (
    <Link to={to} className="logo" aria-label="Wayline home">
      <Mark />
      <span aria-hidden="true">Wayline</span>
    </Link>
  );
}
