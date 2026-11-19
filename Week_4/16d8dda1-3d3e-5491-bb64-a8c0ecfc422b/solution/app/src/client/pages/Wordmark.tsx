export function Wordmark() {
  return (
    <div className="wordmark">
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <rect width="32" height="32" rx="6" fill="currentColor" />
        <rect x="7" y="9" width="18" height="11" rx="1.5" fill="#f6f0e4" />
        <rect x="7" y="23" width="18" height="2.5" rx="1" fill="#f6f0e4" />
      </svg>
      <span>Slatehall</span>
      <span className="wordmark-by">by Corbel &amp; Slate</span>
    </div>
  );
}
