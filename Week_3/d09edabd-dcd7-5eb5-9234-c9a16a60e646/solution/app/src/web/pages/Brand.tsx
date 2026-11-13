export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect className="logo-plate" width="32" height="32" rx="7" />
      <rect className="logo-frame" x="6" y="6" width="20" height="20" rx="3" />
      <rect className="logo-pin" x="13" y="9" width="6" height="14" rx="1.5" />
    </svg>
  );
}

/** The Tumbler & Pin mark with the "Keyway bench" wordmark. */
export function Brand() {
  return (
    <span className="brand">
      <LogoMark />
      <span className="wordmark">
        <strong>Keyway</strong> <span>bench</span>
      </span>
    </span>
  );
}
